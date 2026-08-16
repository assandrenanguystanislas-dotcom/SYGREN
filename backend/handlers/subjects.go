package handlers

import (
	"encoding/json"
	"net/http"

	"sygren-api/database"
	"sygren-api/models"

	"github.com/go-chi/chi/v5"
)

// ListSubjects returns all configured subjects (matières).
// Accessible to any authenticated user (cahier des charges §3 Module 1).
func ListSubjects(w http.ResponseWriter, r *http.Request) {
	var subjects []models.Subject
	if err := database.DB.Order("name ASC").Find(&subjects).Error; err != nil {
		middlewareJSONError(w, "erreur récupération matières", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"subjects": subjects,
		"count":    len(subjects),
	})
}

// CreateSubjectRequest — payload pour créer une matière
type CreateSubjectRequest struct {
	Name        string  `json:"name"`
	Coefficient float64 `json:"coefficient"`
}

// CreateSubject creates a new subject (admin/director only).
func CreateSubject(w http.ResponseWriter, r *http.Request) {
	var req CreateSubjectRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		middlewareJSONError(w, "payload invalide", http.StatusBadRequest)
		return
	}
	if req.Name == "" {
		middlewareJSONError(w, "le nom est requis", http.StatusBadRequest)
		return
	}
	// Coefficient par défaut = 1 (cahier des charges §3)
	if req.Coefficient == 0 {
		req.Coefficient = 1
	}
	subject := models.Subject{
		Name:        req.Name,
		Coefficient: req.Coefficient,
	}
	if err := database.DB.Create(&subject).Error; err != nil {
		middlewareJSONError(w, "erreur création matière (nom déjà utilisé ?)", http.StatusInternalServerError)
		return
	}
	jsonResponse(w, http.StatusCreated, subject)
}

// UpdateSubject updates an existing subject.
func UpdateSubject(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req CreateSubjectRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		middlewareJSONError(w, "payload invalide", http.StatusBadRequest)
		return
	}
	var subject models.Subject
	if err := database.DB.First(&subject, "id = ?", id).Error; err != nil {
		middlewareJSONError(w, "matière introuvable", http.StatusNotFound)
		return
	}
	if req.Name != "" {
		subject.Name = req.Name
	}
	if req.Coefficient > 0 {
		subject.Coefficient = req.Coefficient
	}
	if err := database.DB.Save(&subject).Error; err != nil {
		middlewareJSONError(w, "erreur mise à jour", http.StatusInternalServerError)
		return
	}
	jsonResponse(w, http.StatusOK, subject)
}

// DeleteSubject removes a subject.
func DeleteSubject(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := database.DB.Delete(&models.Subject{}, "id = ?", id).Error; err != nil {
		middlewareJSONError(w, "erreur suppression", http.StatusInternalServerError)
		return
	}
	jsonResponse(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// middlewareJSONError is a local helper to avoid an import cycle in this file.
func middlewareJSONError(w http.ResponseWriter, message string, code int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	w.Write([]byte(`{"error":"` + message + `"}`))
}
