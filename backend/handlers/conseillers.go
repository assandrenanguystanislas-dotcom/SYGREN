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

// === Conseillers — Gestion des comptes conseillers pédagogiques (v5, session 26) ===
//
// Le conseiller suit les écoles de SON secteur (module Écoles > SECTEURS
// D'ECOLES) : il voit uniquement les directeurs et les adjoints au directeur
// des écoles de son secteur (vue « Mon Secteur »).
//
// Le compte conseiller est créé ici (module Utilisateurs > onglet
// Conseillers) ; l'AFFECTATION à un secteur se fait ensuite dans le module
// Écoles > Secteurs d'écoles (PUT /api/sectors/{id}/conseillers).
//
// Accès (module "users.conseillers") : admin + inspector. ISOLATION : le
// compte conseiller lui-même n'a PAS accès à cette liste (il ne voit que son
// périmètre — jamais les autres conseillers).

// ConseillerWithSector — conseiller enrichi du nom de son secteur.
type ConseillerWithSector struct {
	models.User
	SectorName string `json:"sector_name,omitempty"`
}

// ListConseillers retourne les comptes conseillers (role=conseiller).
// Query : ?q=recherche (nom, email ou téléphone — filtrage côté Go).
func ListConseillers(w http.ResponseWriter, r *http.Request) {
	// Isolation (demande utilisateur : le conseiller ne voit que SON
	// périmètre) : un conseiller ne peut pas lister les autres conseillers.
	if ctxRole(r) == models.RoleConseiller {
		middleware.JSONError(w, "accès refusé", http.StatusForbidden)
		return
	}
	var conseillers []models.User
	query := database.DB.Model(&models.User{}).Where("role = ?", models.RoleConseiller)
	if q := r.URL.Query().Get("q"); q != "" {
		pattern := "%" + q + "%"
		// LOWER() : compatible SQLite (dev) ET PostgreSQL (prod).
		query = query.Where(
			"LOWER(full_name) LIKE ? OR LOWER(email) LIKE ? OR LOWER(phone) LIKE ?",
			pattern, pattern, pattern,
		)
	}
	if err := query.Order("full_name ASC").Find(&conseillers).Error; err != nil {
		middleware.JSONError(w, "erreur récupération conseillers", http.StatusInternalServerError)
		return
	}
	// Noms des secteurs : résolution en masse (map anti-N+1).
	sectorName := make(map[string]string)
	sectorIDs := make([]string, 0, len(conseillers))
	seen := make(map[string]bool, len(conseillers))
	for _, c := range conseillers {
		if c.SectorID != nil && *c.SectorID != "" && !seen[*c.SectorID] {
			seen[*c.SectorID] = true
			sectorIDs = append(sectorIDs, *c.SectorID)
		}
	}
	if len(sectorIDs) > 0 {
		var sectors []models.Sector
		if err := database.DB.Select("id", "name").Where("id IN ?", sectorIDs).Find(&sectors).Error; err != nil {
			// Non bloquant : le champ sector_name restera vide.
			sectorIDs = nil
		}
		for _, s := range sectors {
			sectorName[s.ID] = s.Name
		}
	}
	result := make([]ConseillerWithSector, 0, len(conseillers))
	for _, c := range conseillers {
		m := ConseillerWithSector{User: c}
		if c.SectorID != nil && *c.SectorID != "" {
			m.SectorName = sectorName[*c.SectorID]
		}
		result = append(result, m)
	}
	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"conseillers": result,
		"count":       len(result),
	})
}

// CreateConseillerRequest — payload de création d'un compte conseiller.
// Mot de passe OPTIONNEL : vide → STANDARD = numéro de téléphone (convention
// SYGREN, cf. directeurs / parents).
type CreateConseillerRequest struct {
	FullName string  `json:"full_name"`
	Phone    *string `json:"phone,omitempty"`
	Email    *string `json:"email,omitempty"`
	Password string  `json:"password,omitempty"`
}

// CreateConseiller crée un compte conseiller (role=conseiller).
func CreateConseiller(w http.ResponseWriter, r *http.Request) {
	var req CreateConseillerRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		middleware.JSONError(w, "payload invalide", http.StatusBadRequest)
		return
	}
	if req.FullName == "" {
		middleware.JSONError(w, "full_name requis", http.StatusBadRequest)
		return
	}
	// Au moins un identifiant de connexion (téléphone OU email)
	if (req.Phone == nil || *req.Phone == "") && (req.Email == nil || *req.Email == "") {
		middleware.JSONError(w, "au moins un email ou téléphone est requis", http.StatusBadRequest)
		return
	}
	// Mot de passe STANDARD = numéro de téléphone : si aucun mot de passe
	// n'est fourni, on utilise le téléphone (modifiable à tout moment via
	// « Modifier votre mot de passe »).
	if req.Password == "" {
		if req.Phone == nil || *req.Phone == "" {
			middleware.JSONError(w,
				"mot de passe requis (ou renseignez un téléphone : le mot de passe standard est le numéro de téléphone)",
				http.StatusBadRequest)
			return
		}
		req.Password = *req.Phone
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

	// Restauration (correctif accès) : si un conseiller SUPPRIMÉ
	// (soft-delete) porte déjà ce téléphone/email, on le restaure.
	if restored, ok := restoreSoftDeletedUser(models.RoleConseiller, req.FullName, req.Phone, req.Email, nil, req.Password, nil); ok {
		restored.Password = ""
		jsonResponse(w, http.StatusCreated, restored)
		return
	}

	hashed, err := utils.HashPassword(req.Password)
	if err != nil {
		middleware.JSONError(w, "erreur hashage mot de passe", http.StatusInternalServerError)
		return
	}

	conseiller := models.User{
		FullName: req.FullName,
		Phone:    req.Phone,
		Email:    req.Email,
		Password: hashed,
		Role:     models.RoleConseiller,
		Active:   true,
	}
	if err := database.DB.Create(&conseiller).Error; err != nil {
		middleware.JSONError(w, "erreur création conseiller", http.StatusInternalServerError)
		return
	}
	LogAction(r, "user.created", "user", &conseiller.ID, map[string]interface{}{
		"role": models.RoleConseiller,
	})
	conseiller.Password = ""
	jsonResponse(w, http.StatusCreated, conseiller)
}

// UpdateConseiller met à jour un compte conseiller.
func UpdateConseiller(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req struct {
		FullName string  `json:"full_name,omitempty"`
		Phone    *string `json:"phone,omitempty"`
		Email    *string `json:"email,omitempty"`
		Password string  `json:"password,omitempty"`
		Active   *bool   `json:"active,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		middleware.JSONError(w, "payload invalide", http.StatusBadRequest)
		return
	}
	var conseiller models.User
	if err := database.DB.Where("role = ?", models.RoleConseiller).First(&conseiller, "id = ?", id).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			middleware.JSONError(w, "conseiller introuvable", http.StatusNotFound)
			return
		}
		middleware.JSONError(w, "erreur récupération", http.StatusInternalServerError)
		return
	}
	if req.FullName != "" {
		conseiller.FullName = req.FullName
	}
	if req.Phone != nil {
		conseiller.Phone = req.Phone
	}
	if req.Email != nil {
		conseiller.Email = req.Email
	}
	if req.Password != "" {
		hashed, err := utils.HashPassword(req.Password)
		if err != nil {
			middleware.JSONError(w, "erreur hashage mot de passe", http.StatusInternalServerError)
			return
		}
		conseiller.Password = hashed
	}
	if req.Active != nil {
		conseiller.Active = *req.Active
	}
	if err := database.DB.Save(&conseiller).Error; err != nil {
		middleware.JSONError(w, "erreur mise à jour", http.StatusInternalServerError)
		return
	}
	conseiller.Password = ""
	jsonResponse(w, http.StatusOK, conseiller)
}

// DeleteConseiller supprime un compte conseiller (soft-delete) et détache
// son secteur (users.sector_id = NULL) pour que le périmètre soit
// immédiatement libre.
func DeleteConseiller(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	res := database.DB.Where("role = ?", models.RoleConseiller).Delete(&models.User{}, "id = ?", id)
	if res.Error != nil {
		middleware.JSONError(w, "erreur suppression", http.StatusInternalServerError)
		return
	}
	if res.RowsAffected == 0 {
		middleware.JSONError(w, "conseiller introuvable", http.StatusNotFound)
		return
	}
	// Détacher le secteur (soft-delete : la ligne reste en base, on nettoie
	// l'affectation pour éviter tout périmètre fantôme).
	database.DB.Model(&models.User{}).Where("id = ?", id).Update("sector_id", nil)
	// Audit (Architecture D) — les suppressions sont tracées.
	LogAction(r, "user.deleted", "user", &id, map[string]interface{}{
		"role": models.RoleConseiller,
	})
	jsonResponse(w, http.StatusOK, map[string]string{"status": "deleted"})
}
