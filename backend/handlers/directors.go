package handlers

import (
	"encoding/json"
	"net/http"

	"sygren-api/database"
	"sygren-api/middleware"
	"sygren-api/models"
	"sygren-api/utils"

	"github.com/go-chi/chi/v5"
)

// === Directors — Gestion des directeurs d'école (comptes utilisateurs + affectation) ===
// Accès :
//   - admin : tous les directeurs (CRUD)
//   - inspector : directeurs des écoles de son IEP (lecture seule)
//
// Un directeur est un User avec role=director et school_id pointant vers
// l'école qu'il dirige (relation 1-1 : un directeur par école).

// DirectorWithDetails — directeur enrichi
type DirectorWithDetails struct {
	models.User
	SchoolName string `json:"school_name,omitempty"`
	IEPName    string `json:"iep_name,omitempty"`
}

// ListDirectors returns directors (role=director) filtered by scope.
func ListDirectors(w http.ResponseWriter, r *http.Request) {
	role := ctxRole(r)
	query := database.DB.Model(&models.User{}).Where("role = ?", models.RoleDirector)

	switch role {
	}

	var directors []models.User
	if err := query.Order("full_name ASC").Find(&directors).Error; err != nil {
		middleware.JSONError(w, "erreur récupération directeurs", http.StatusInternalServerError)
		return
	}

	result := make([]DirectorWithDetails, 0, len(directors))
	for _, d := range directors {
		var det DirectorWithDetails
		det.User = d
		// Nom de l'école + IEP
		if d.SchoolID != nil {
			var school models.School
			if err := database.DB.First(&school, "id = ?", *d.SchoolID).Error; err == nil {
				det.SchoolName = school.Name
				var iep models.IEP
				if err := database.DB.First(&iep, "id = ?", school.IEPID).Error; err == nil {
					det.IEPName = iep.Name
				}
			}
		}
		result = append(result, det)
	}

	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"directors": result,
		"count":     len(result),
	})
}

// CreateDirectorRequest — payload pour créer un compte directeur
type CreateDirectorRequest struct {
	FullName string  `json:"full_name"`
	Phone    *string `json:"phone,omitempty"`
	Email    *string `json:"email,omitempty"`
	Password string  `json:"password"`
	SchoolID *string `json:"school_id,omitempty"` // école dirigée (optionnel à la création, mais recommandé)
	// Dossier personnel (état nominatif) — optionnel, voir personnel.go
	Personnel *PersonnelDossierInput `json:"personnel,omitempty"`
}

// CreateDirector creates a director account.
func CreateDirector(w http.ResponseWriter, r *http.Request) {
	var req CreateDirectorRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		middleware.JSONError(w, "payload invalide", http.StatusBadRequest)
		return
	}
	if req.FullName == "" || req.Password == "" {
		middleware.JSONError(w, "full_name et password requis", http.StatusBadRequest)
		return
	}
	// Au moins un identifiant de connexion (téléphone OU email — cahier des charges §4.1)
	if (req.Phone == nil || *req.Phone == "") && (req.Email == nil || *req.Email == "") {
		middleware.JSONError(w, "au moins un email ou téléphone est requis", http.StatusBadRequest)
		return
	}

	// Vérifier l'unicité du téléphone/email
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

	// Vérifier que l'école existe si school_id fourni (évite directeur orphelin)
	if req.SchoolID != nil && *req.SchoolID != "" {
		var school models.School
		if err := database.DB.First(&school, "id = ?", *req.SchoolID).Error; err != nil {
			middleware.JSONError(w, "école introuvable — créez l'école avant d'y affecter un directeur", http.StatusBadRequest)
			return
		}
		// Vérifier qu'aucun autre directeur n'est déjà affecté à cette école
		var existing int64
		database.DB.Model(&models.User{}).
			Where("role = ? AND school_id = ? AND active = ?", models.RoleDirector, *req.SchoolID, true).
			Count(&existing)
		if existing > 0 {
			middleware.JSONError(w, "cette école a déjà un directeur actif — désactivez-le ou modifiez-le avant d'en affecter un nouveau", http.StatusConflict)
			return
		}
	}

	hashed, err := utils.HashPassword(req.Password)
	if err != nil {
		middleware.JSONError(w, "erreur hashage mot de passe", http.StatusInternalServerError)
		return
	}

	director := models.User{
		FullName: req.FullName,
		Phone:    req.Phone,
		Email:    req.Email,
		Password: hashed,
		Role:     models.RoleDirector,
		SchoolID: req.SchoolID,
		Active:   true,
	}
	if req.Personnel != nil {
		if err := req.Personnel.applyTo(&director); err != nil {
			middleware.JSONError(w, err.Error(), http.StatusBadRequest)
			return
		}
	}
	if err := database.DB.Create(&director).Error; err != nil {
		middleware.JSONError(w, "erreur création directeur", http.StatusInternalServerError)
		return
	}
	director.Password = ""
	jsonResponse(w, http.StatusCreated, director)
}

// UpdateDirector updates a director account.
func UpdateDirector(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req struct {
		FullName string  `json:"full_name,omitempty"`
		Phone    *string `json:"phone,omitempty"`
		Email    *string `json:"email,omitempty"`
		Password string  `json:"password,omitempty"`
		SchoolID *string `json:"school_id,omitempty"`
		Active   *bool   `json:"active,omitempty"`
		// Dossier personnel (état nominatif) — nil = non touché,
		// non-nil = mise à jour complète (voir personnel.go)
		Personnel *PersonnelDossierInput `json:"personnel,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		middleware.JSONError(w, "payload invalide", http.StatusBadRequest)
		return
	}
	var director models.User
	if err := database.DB.First(&director, "id = ?", id).Error; err != nil {
		middleware.JSONError(w, "directeur introuvable", http.StatusNotFound)
		return
	}
	if req.Personnel != nil {
		if err := req.Personnel.applyTo(&director); err != nil {
			middleware.JSONError(w, err.Error(), http.StatusBadRequest)
			return
		}
	}
	if req.FullName != "" {
		director.FullName = req.FullName
	}
	if req.Phone != nil {
		director.Phone = req.Phone
	}
	if req.Email != nil {
		director.Email = req.Email
	}
	if req.Password != "" {
		hashed, err := utils.HashPassword(req.Password)
		if err != nil {
			middleware.JSONError(w, "erreur hashage mot de passe", http.StatusInternalServerError)
			return
		}
		director.Password = hashed
	}
	if req.SchoolID != nil {
		// Vérifier qu'aucun autre directeur n'est déjà affecté à cette école
		if *req.SchoolID != "" {
			var existing int64
			database.DB.Model(&models.User{}).
				Where("role = ? AND school_id = ? AND id != ? AND active = ?", models.RoleDirector, *req.SchoolID, id, true).
				Count(&existing)
			if existing > 0 {
				middleware.JSONError(w, "cette école a déjà un autre directeur actif", http.StatusConflict)
				return
			}
		}
		director.SchoolID = req.SchoolID
	}
	if req.Active != nil {
		director.Active = *req.Active
	}
	if err := database.DB.Save(&director).Error; err != nil {
		middleware.JSONError(w, "erreur mise à jour", http.StatusInternalServerError)
		return
	}
	director.Password = ""
	jsonResponse(w, http.StatusOK, director)
}

// DeleteDirector removes a director account.
func DeleteDirector(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := database.DB.Delete(&models.User{}, "id = ?", id).Error; err != nil {
		middleware.JSONError(w, "erreur suppression", http.StatusInternalServerError)
		return
	}
	jsonResponse(w, http.StatusOK, map[string]string{"status": "deleted"})
}
