package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"gorm.io/gorm"

	"sygren-api/database"
	"sygren-api/middleware"
	"sygren-api/models"
	"sygren-api/utils"
)

// === Parents — Gestion des comptes parents (module Utilisateurs) ===
//
// Le compte PARENT (v2 — Portail Parent) permet au parent d'un élève de
// consulter et d'imprimer LE BULLETIN INDIVIDUEL de son enfant :
//   - bulletin individuel « RESULTATS DE FIN D'ANNEE » (module Résultats) ;
//   - bulletins individuels de période (module Bulletins).
// La recherche se fait AVEC LE MATRICULE DE L'ENFANT (le parent saisit le
// matricule dans le portail ; le champ child_matricule du compte pré-remplit
// la recherche).
//
// Accès (module "users.parents") : admin + inspector. Les parents ne sont
// pas rattachés à une école (portail global par matricule) — le directeur
// n'en gère pas.
//
// RBAC : routes protégées par RequireModule(models.ModuleUsersParents, ...).

// ListParents retourne les comptes parents (role=parent).
// Query : ?q=recherche (nom, email ou téléphone — filtrage côté Go).
func ListParents(w http.ResponseWriter, r *http.Request) {
	var parents []models.User
	query := database.DB.Model(&models.User{}).Where("role = ?", models.RoleParent)
	if q := r.URL.Query().Get("q"); q != "" {
		pattern := "%" + q + "%"
		// LOWER() : compatible SQLite (dev) ET PostgreSQL (prod).
		query = query.Where(
			"LOWER(full_name) LIKE ? OR LOWER(email) LIKE ? OR LOWER(phone) LIKE ? OR LOWER(child_matricule) LIKE ?",
			pattern, pattern, pattern, pattern,
		)
	}
	if err := query.Order("full_name ASC").Find(&parents).Error; err != nil {
		middleware.JSONError(w, "erreur récupération parents", http.StatusInternalServerError)
		return
	}
	// Purger les hash avant sérialisation
	for i := range parents {
		parents[i].Password = ""
	}
	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"parents": parents,
		"count":   len(parents),
	})
}

// CreateParentRequest — payload de création d'un compte parent.
type CreateParentRequest struct {
	FullName string  `json:"full_name"`
	Phone    *string `json:"phone,omitempty"`
	Email    *string `json:"email,omitempty"`
	Password string  `json:"password"`
	// Matricule de l'enfant (optionnel — pré-remplit le portail parent).
	ChildMatricule *string `json:"child_matricule,omitempty"`
}

// CreateParent crée un compte parent (role=parent).
func CreateParent(w http.ResponseWriter, r *http.Request) {
	var req CreateParentRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		middleware.JSONError(w, "payload invalide", http.StatusBadRequest)
		return
	}
	if req.FullName == "" || req.Password == "" {
		middleware.JSONError(w, "full_name et password requis", http.StatusBadRequest)
		return
	}
	// Au moins un identifiant de connexion (téléphone OU email)
	if (req.Phone == nil || *req.Phone == "") && (req.Email == nil || *req.Email == "") {
		middleware.JSONError(w, "au moins un email ou téléphone est requis", http.StatusBadRequest)
		return
	}

	// Unicité téléphone/email
	if req.Email != nil && *req.Email != "" {
		var count int64
		database.DB.Model(&models.User{}).Where("email = ?", *req.Email).Count(&count)
		if count > 0 {
			middleware.JSONError(w, "cet email est déjà utilisé", http.StatusConflict)
			return
		}
	}
	if req.Phone != nil && *req.Phone != "" {
		var count int64
		database.DB.Model(&models.User{}).Where("phone = ?", *req.Phone).Count(&count)
		if count > 0 {
			middleware.JSONError(w, "ce numéro de téléphone est déjà utilisé", http.StatusConflict)
			return
		}
	}

	hashed, err := utils.HashPassword(req.Password)
	if err != nil {
		middleware.JSONError(w, "erreur hashage mot de passe", http.StatusInternalServerError)
		return
	}

	parent := models.User{
		FullName:       req.FullName,
		Phone:          req.Phone,
		Email:          req.Email,
		Password:       hashed,
		Role:           models.RoleParent,
		Active:         true,
		ChildMatricule: req.ChildMatricule,
	}
	if err := database.DB.Create(&parent).Error; err != nil {
		middleware.JSONError(w, "erreur création parent", http.StatusInternalServerError)
		return
	}
	parent.Password = ""
	jsonResponse(w, http.StatusCreated, parent)
}

// UpdateParent met à jour un compte parent.
func UpdateParent(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req struct {
		FullName       string  `json:"full_name,omitempty"`
		Phone          *string `json:"phone,omitempty"`
		Email          *string `json:"email,omitempty"`
		Password       string  `json:"password,omitempty"`
		Active         *bool   `json:"active,omitempty"`
		ChildMatricule *string `json:"child_matricule,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		middleware.JSONError(w, "payload invalide", http.StatusBadRequest)
		return
	}
	var parent models.User
	if err := database.DB.Where("role = ?", models.RoleParent).First(&parent, "id = ?", id).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			middleware.JSONError(w, "parent introuvable", http.StatusNotFound)
			return
		}
		middleware.JSONError(w, "erreur récupération", http.StatusInternalServerError)
		return
	}
	if req.FullName != "" {
		parent.FullName = req.FullName
	}
	if req.Phone != nil {
		parent.Phone = req.Phone
	}
	if req.Email != nil {
		parent.Email = req.Email
	}
	if req.ChildMatricule != nil {
		parent.ChildMatricule = req.ChildMatricule
	}
	if req.Password != "" {
		hashed, err := utils.HashPassword(req.Password)
		if err != nil {
			middleware.JSONError(w, "erreur hashage mot de passe", http.StatusInternalServerError)
			return
		}
		parent.Password = hashed
	}
	if req.Active != nil {
		parent.Active = *req.Active
	}
	if err := database.DB.Save(&parent).Error; err != nil {
		middleware.JSONError(w, "erreur mise à jour", http.StatusInternalServerError)
		return
	}
	parent.Password = ""
	jsonResponse(w, http.StatusOK, parent)
}

// DeleteParent supprime un compte parent.
func DeleteParent(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	res := database.DB.Where("role = ?", models.RoleParent).Delete(&models.User{}, "id = ?", id)
	if res.Error != nil {
		middleware.JSONError(w, "erreur suppression", http.StatusInternalServerError)
		return
	}
	if res.RowsAffected == 0 {
		middleware.JSONError(w, "parent introuvable", http.StatusNotFound)
		return
	}
	jsonResponse(w, http.StatusOK, map[string]string{"status": "deleted"})
}
