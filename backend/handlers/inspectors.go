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

// === Inspectors — Gestion des inspecteurs IEP (comptes utilisateurs + affectation) ===
// Accès :
//   - admin : tous les inspecteurs (CRUD)
//
// Un inspecteur est un User avec role=inspector et iep_id pointant vers
// l'IEP qu'il supervise (relation 1-1 : un inspecteur par IEP).

// InspectorWithDetails — inspecteur enrichi
type InspectorWithDetails struct {
	models.User
	IEPName string `json:"iep_name,omitempty"`
}

// ListInspectors returns inspectors (role=inspector).
func ListInspectors(w http.ResponseWriter, r *http.Request) {
	var inspectors []models.User
	if err := database.DB.Model(&models.User{}).
		Where("role = ?", models.RoleInspector).
		Order("full_name ASC").
		Find(&inspectors).Error; err != nil {
		middleware.JSONError(w, "erreur récupération inspecteurs", http.StatusInternalServerError)
		return
	}

	result := make([]InspectorWithDetails, 0, len(inspectors))
	for _, i := range inspectors {
		var det InspectorWithDetails
		det.User = i
		// Nom de l'IEP supervisé
		if i.IEPID != nil {
			var iep models.IEP
			if err := database.DB.First(&iep, "id = ?", *i.IEPID).Error; err == nil {
				det.IEPName = iep.Name
			}
		}
		result = append(result, det)
	}

	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"inspectors": result,
		"count":      len(result),
	})
}

// CreateInspectorRequest — payload pour créer un compte Admin IEP
type CreateInspectorRequest struct {
	FullName string  `json:"full_name"`
	Phone    *string `json:"phone,omitempty"`
	Email    *string `json:"email,omitempty"`
	Password string  `json:"password"`
	IEPID    *string `json:"iep_id,omitempty"`  // IEP supervisé
	Service  string  `json:"service,omitempty"` // service au sein de l'IEP (ex: "Examen & Concours")
}

// CreateInspector creates an inspector account.
func CreateInspector(w http.ResponseWriter, r *http.Request) {
	var req CreateInspectorRequest
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

	// Vérifier que l'IEP existe si iep_id fourni
	if req.IEPID != nil && *req.IEPID != "" {
		var iep models.IEP
		if err := database.DB.First(&iep, "id = ?", *req.IEPID).Error; err != nil {
			middleware.JSONError(w, "IEP introuvable — créez l'inspection avant d'y affecter un Admin IEP", http.StatusBadRequest)
			return
		}
		// Plusieurs Admins IEP par IEP sont autorisés (service différencié).
		// Pas de vérification d'unicité par IEP.
	}

	hashed, err := utils.HashPassword(req.Password)
	if err != nil {
		middleware.JSONError(w, "erreur hashage mot de passe", http.StatusInternalServerError)
		return
	}

	inspector := models.User{
		FullName: req.FullName,
		Phone:    req.Phone,
		Email:    req.Email,
		Password: hashed,
		Role:     models.RoleInspector,
		IEPID:    req.IEPID,
		Service:  req.Service,
		Active:   true,
	}
	if err := database.DB.Create(&inspector).Error; err != nil {
		middleware.JSONError(w, "erreur création Admin IEP", http.StatusInternalServerError)
		return
	}
	inspector.Password = ""
	jsonResponse(w, http.StatusCreated, inspector)
}

// UpdateInspector updates an inspector account.
func UpdateInspector(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req struct {
		FullName string  `json:"full_name,omitempty"`
		Phone    *string `json:"phone,omitempty"`
		Email    *string `json:"email,omitempty"`
		Password string  `json:"password,omitempty"`
		IEPID    *string `json:"iep_id,omitempty"`
		Service  *string `json:"service,omitempty"`
		Active   *bool   `json:"active,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		middleware.JSONError(w, "payload invalide", http.StatusBadRequest)
		return
	}
	var inspector models.User
	if err := database.DB.First(&inspector, "id = ?", id).Error; err != nil {
		middleware.JSONError(w, "Admin IEP introuvable", http.StatusNotFound)
		return
	}
	if req.FullName != "" {
		inspector.FullName = req.FullName
	}
	if req.Phone != nil {
		inspector.Phone = req.Phone
	}
	if req.Email != nil {
		inspector.Email = req.Email
	}
	if req.Password != "" {
		hashed, err := utils.HashPassword(req.Password)
		if err != nil {
			middleware.JSONError(w, "erreur hashage mot de passe", http.StatusInternalServerError)
			return
		}
		inspector.Password = hashed
	}
	if req.IEPID != nil {
		// Plusieurs Admins IEP par IEP autorisés — pas de vérification d'unicité.
		inspector.IEPID = req.IEPID
	}
	if req.Service != nil {
		inspector.Service = *req.Service
	}
	if req.Active != nil {
		inspector.Active = *req.Active
	}
	if err := database.DB.Save(&inspector).Error; err != nil {
		middleware.JSONError(w, "erreur mise à jour", http.StatusInternalServerError)
		return
	}
	inspector.Password = ""
	jsonResponse(w, http.StatusOK, inspector)
}

// DeleteInspector removes an inspector account.
func DeleteInspector(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := database.DB.Delete(&models.User{}, "id = ?", id).Error; err != nil {
		middleware.JSONError(w, "erreur suppression", http.StatusInternalServerError)
		return
	}
	jsonResponse(w, http.StatusOK, map[string]string{"status": "deleted"})
}
