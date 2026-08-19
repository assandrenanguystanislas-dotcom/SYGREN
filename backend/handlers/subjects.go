package handlers

import (
        "encoding/json"
        "net/http"
        "strings"

        "sygren-api/database"
        "sygren-api/models"

        "github.com/go-chi/chi/v5"
)

// ValidClasses — classes autorisées (cahier des charges §3 Module 1)
var ValidClasses = map[string]bool{
        "CP1": true, "CP2": true,
        "CE1": true, "CE2": true,
        "CM1": true, "CM2": true,
}

// levelToClasses — map niveau → classes composantes (pour migration ancien format)
var levelToClasses = map[string][]string{
        "CP": {"CP1", "CP2"},
        "CE": {"CE1", "CE2"},
        "CM": {"CM1", "CM2"},
}

// normalizeClasses valide et normalise une liste de classes.
// Accepte les noms de classes (CP1, CP2, CE1, CE2, CM1, CM2) ET les anciens
// niveaux (CP, CE, CM — convertis en leurs classes composantes pour rétrocompat).
// Entrée : "CP1,CM2" ou "CP,CE,CM" → sortie : "CP1,CP2,CE1,CE2,CM1,CM2" (sans doublons).
// Si vide ou invalide → toutes les classes (CP1,CP2,CE1,CE2,CM1,CM2).
func normalizeClasses(input string) string {
        if input == "" {
                return "CP1,CP2,CE1,CE2,CM1,CM2"
        }
        parts := strings.Split(input, ",")
        seen := map[string]bool{}
        var valid []string
        for _, p := range parts {
                p = strings.TrimSpace(strings.ToUpper(p))
                // Si c'est un niveau (CP/CE/CM), l'étendre en ses classes
                if classes, ok := levelToClasses[p]; ok {
                        for _, c := range classes {
                                if !seen[c] {
                                        seen[c] = true
                                        valid = append(valid, c)
                                }
                        }
                } else if ValidClasses[p] && !seen[p] {
                        seen[p] = true
                        valid = append(valid, p)
                }
        }
        if len(valid) == 0 {
                return "CP1,CP2,CE1,CE2,CM1,CM2"
        }
        return strings.Join(valid, ",")
}

// ListSubjects returns all configured subjects (matières).
// Accessible to any authenticated user (cahier des charges §3 Module 1).
// Paramètre optionnel ?class=CM2 pour filtrer par classe spécifique.
func ListSubjects(w http.ResponseWriter, r *http.Request) {
        var subjects []models.Subject
        query := database.DB.Order("name ASC")

        // Filtre optionnel par classe
        if class := r.URL.Query().Get("class"); class != "" {
                class = strings.ToUpper(strings.TrimSpace(class))
                if ValidClasses[class] {
                        query = query.Where("levels LIKE ?", "%"+class+"%")
                }
        }

        if err := query.Find(&subjects).Error; err != nil {
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
        Levels      string  `json:"levels"` // "CP1,CP2,CE1,CE2,CM1,CM2" | "CM2" | "CP1,CM2" etc.
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
        levels := normalizeClasses(req.Levels)
        subject := models.Subject{
                Name:        req.Name,
                Coefficient: req.Coefficient,
                Levels:      levels,
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
        if req.Levels != "" {
                subject.Levels = normalizeClasses(req.Levels)
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
