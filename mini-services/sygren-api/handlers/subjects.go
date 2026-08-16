package handlers

import (
	"encoding/json"
	"net/http"

	"sygren-api/database"
	"sygren-api/models"
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

// middlewareJSONError is a local helper to avoid an import cycle in this file.
func middlewareJSONError(w http.ResponseWriter, message string, code int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	w.Write([]byte(`{"error":"` + message + `"}`))
}
