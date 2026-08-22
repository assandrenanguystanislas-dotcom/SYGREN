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

// === Teachers — Gestion des enseignants (comptes utilisateurs + affectation) ===
// Accès :
//   - admin : tous les enseignants
//   - inspector : enseignants des écoles de son IEP
//   - director : enseignants de son école

// TeacherWithDetails — enseignant enrichi
type TeacherWithDetails struct {
	models.User
	SchoolName string  `json:"school_name,omitempty"`
	ClassName  *string `json:"class_name,omitempty"`
}

// ListTeachers returns teachers (role=teacher) filtered by scope.
func ListTeachers(w http.ResponseWriter, r *http.Request) {
	role := ctxRole(r)
	query := database.DB.Model(&models.User{}).Where("role = ?", models.RoleTeacher)

	switch role {
	case "director":
		schoolID := ctxSchoolID(r)
		if schoolID == "" {
			jsonResponse(w, http.StatusOK, map[string]interface{}{"teachers": []interface{}{}, "count": 0})
			return
		}
		query = query.Where("school_id = ?", schoolID)
	}

	var teachers []models.User
	if err := query.Order("full_name ASC").Find(&teachers).Error; err != nil {
		middleware.JSONError(w, "erreur récupération enseignants", http.StatusInternalServerError)
		return
	}

	result := make([]TeacherWithDetails, 0, len(teachers))
	for _, t := range teachers {
		var d TeacherWithDetails
		d.User = t
		// Nom de l'école
		if t.SchoolID != nil {
			var school models.School
			if err := database.DB.First(&school, "id = ?", *t.SchoolID).Error; err == nil {
				d.SchoolName = school.Name
			}
		}
		// Nom de la classe affectée
		var cls models.Class
		if err := database.DB.First(&cls, "teacher_id = ?", t.ID).Error; err == nil {
			n := cls.Name
			d.ClassName = &n
		}
		result = append(result, d)
	}

	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"teachers": result,
		"count":    len(result),
	})
}

// CreateTeacherRequest — payload pour créer un compte enseignant
type CreateTeacherRequest struct {
	FullName string  `json:"full_name"`
	Phone    *string `json:"phone,omitempty"`
	Email    *string `json:"email,omitempty"`
	Password string  `json:"password"`
	SchoolID *string `json:"school_id,omitempty"`
}

// CreateTeacher creates a teacher account (cahier des charges §3 Module 1).
func CreateTeacher(w http.ResponseWriter, r *http.Request) {
	var req CreateTeacherRequest
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

	// Vérifier que l'école a un directeur rattaché (cahier des charges).
	// On ne peut pas créer un enseignant dans une école sans directeur.
	if req.SchoolID != nil && *req.SchoolID != "" {
		var directorCount int64
		database.DB.Model(&models.User{}).
			Where("school_id = ? AND role = ?", *req.SchoolID, models.RoleDirector).
			Count(&directorCount)
		if directorCount == 0 {
			middleware.JSONError(w,
				"impossible de créer un enseignant : cette école n'a pas de directeur rattaché. "+
					"Veuillez d'abord créer le compte directeur de cette école.",
				http.StatusConflict)
			return
		}
	}

	hashed, err := utils.HashPassword(req.Password)
	if err != nil {
		middleware.JSONError(w, "erreur hashage mot de passe", http.StatusInternalServerError)
		return
	}

	teacher := models.User{
		FullName: req.FullName,
		Phone:    req.Phone,
		Email:    req.Email,
		Password: hashed,
		Role:     models.RoleTeacher,
		SchoolID: req.SchoolID,
		Active:   true,
	}
	if err := database.DB.Create(&teacher).Error; err != nil {
		middleware.JSONError(w, "erreur création enseignant", http.StatusInternalServerError)
		return
	}
	// Ne pas renvoyer le hash
	teacher.Password = ""
	jsonResponse(w, http.StatusCreated, teacher)
}

// UpdateTeacher updates a teacher account.
func UpdateTeacher(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req struct {
		FullName string  `json:"full_name,omitempty"`
		Phone    *string `json:"phone,omitempty"`
		Email    *string `json:"email,omitempty"`
		Password string  `json:"password,omitempty"`
		SchoolID *string `json:"school_id,omitempty"`
		Active   *bool   `json:"active,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		middleware.JSONError(w, "payload invalide", http.StatusBadRequest)
		return
	}
	var teacher models.User
	if err := database.DB.First(&teacher, "id = ?", id).Error; err != nil {
		middleware.JSONError(w, "enseignant introuvable", http.StatusNotFound)
		return
	}
	if req.FullName != "" {
		teacher.FullName = req.FullName
	}
	if req.Phone != nil {
		teacher.Phone = req.Phone
	}
	if req.Email != nil {
		teacher.Email = req.Email
	}
	if req.Password != "" {
		hashed, err := utils.HashPassword(req.Password)
		if err != nil {
			middleware.JSONError(w, "erreur hashage mot de passe", http.StatusInternalServerError)
			return
		}
		teacher.Password = hashed
	}
	if req.SchoolID != nil && *req.SchoolID != "" {
		// Vérifier que l'école a un directeur rattaché (cahier des charges).
		var directorCount int64
		database.DB.Model(&models.User{}).
			Where("school_id = ? AND role = ?", *req.SchoolID, models.RoleDirector).
			Count(&directorCount)
		if directorCount == 0 {
			middleware.JSONError(w,
				"impossible d'affecter cet enseignant : cette école n'a pas de directeur rattaché.",
				http.StatusConflict)
			return
		}
		teacher.SchoolID = req.SchoolID
	}
	if req.Active != nil {
		teacher.Active = *req.Active
	}
	if err := database.DB.Save(&teacher).Error; err != nil {
		middleware.JSONError(w, "erreur mise à jour", http.StatusInternalServerError)
		return
	}
	teacher.Password = ""
	jsonResponse(w, http.StatusOK, teacher)
}

// DeleteTeacher removes a teacher account (and unlinks its class).
func DeleteTeacher(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	// Délier les classes affectées
	database.DB.Model(&models.Class{}).Where("teacher_id = ?", id).Update("teacher_id", nil)
	if err := database.DB.Delete(&models.User{}, "id = ?", id).Error; err != nil {
		middleware.JSONError(w, "erreur suppression", http.StatusInternalServerError)
		return
	}
	jsonResponse(w, http.StatusOK, map[string]string{"status": "deleted"})
}
