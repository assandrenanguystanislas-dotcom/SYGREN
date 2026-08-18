package handlers

import (
        "encoding/json"
        "net/http"
        "strings"
        "time"

        "sygren-api/database"
        "sygren-api/middleware"
        "sygren-api/models"

        "github.com/go-chi/chi/v5"
)

// === Students — Gestion des élèves ===
// Le matricule est fourni par le Ministère de l'Éducation (optionnel).
// Si non fourni à la saisie → NULL en base + affichage "N/A" côté frontend.
//
// Accès :
//   - admin : tous les élèves
//   - inspector : élèves des écoles de son IEP
//   - director : élèves de son école
//   - teacher : élèves de sa classe

// StudentWithClass — élève enrichi
type StudentWithClass struct {
        models.Student
        ClassName   string `json:"class_name,omitempty"`
        SchoolName  string `json:"school_name,omitempty"`
}

// ListStudents returns students filtered by scope.
func ListStudents(w http.ResponseWriter, r *http.Request) {
        role := ctxRole(r)
        classFilter := r.URL.Query().Get("class_id")
        query := database.DB.Model(&models.Student{}).
                Joins("JOIN classes ON classes.id = students.class_id")

        switch role {
        case "inspector":
                iepID := ctxIEPID(r)
                if iepID == "" {
                        jsonResponse(w, http.StatusOK, map[string]interface{}{"students": []interface{}{}, "count": 0})
                        return
                }
                query = query.Joins("JOIN schools ON schools.id = classes.school_id").
                        Where("schools.iep_id = ?", iepID)
        case "director":
                schoolID := ctxSchoolID(r)
                if schoolID == "" {
                        jsonResponse(w, http.StatusOK, map[string]interface{}{"students": []interface{}{}, "count": 0})
                        return
                }
                query = query.Where("classes.school_id = ?", schoolID)
        case "teacher":
                userID := ctxUserID(r)
                query = query.Where("classes.teacher_id = ?", userID)
        }

        if classFilter != "" {
                query = query.Where("students.class_id = ?", classFilter)
        }

        var students []models.Student
        if err := query.Order("last_name ASC, first_name ASC").Find(&students).Error; err != nil {
                middleware.JSONError(w, "erreur récupération élèves", http.StatusInternalServerError)
                return
        }

        result := make([]StudentWithClass, 0, len(students))
        for _, s := range students {
                var d StudentWithClass
                d.Student = s
                // Nom de la classe
                var cls models.Class
                if err := database.DB.First(&cls, "id = ?", s.ClassID).Error; err == nil {
                        d.ClassName = cls.Name
                        // Nom de l'école
                        var school models.School
                        if err := database.DB.First(&school, "id = ?", cls.SchoolID).Error; err == nil {
                                d.SchoolName = school.Name
                        }
                }
                result = append(result, d)
        }

        jsonResponse(w, http.StatusOK, map[string]interface{}{
                "students": result,
                "count":    len(result),
        })
}

// CreateStudentRequest — payload pour créer un élève
type CreateStudentRequest struct {
        Matricule *string `json:"matricule,omitempty"` // fourni par le Ministère de l'Éducation (optionnel)
        ClassID   string  `json:"class_id"`
        FirstName string  `json:"first_name"`
        LastName  string  `json:"last_name"`
        Gender    string  `json:"gender"` // M / F
        BirthDate *string `json:"birth_date,omitempty"` // ISO 8601
}

// normalizeMatricule retourne nil si la string est vide (→ NULL en base),
// sinon un pointeur vers la valeur trimée. Plusieurs NULL peuvent coexister
// dans un unique index PostgreSQL.
func normalizeMatricule(s string) *string {
        trimmed := strings.TrimSpace(s)
        if trimmed == "" {
                return nil
        }
        return &trimmed
}

// CreateStudent creates a new student.
// Le matricule est fourni par le Ministère de l'Éducation ; il est optionnel.
// Si absent → NULL en base (affiché "N/A" côté frontend).
func CreateStudent(w http.ResponseWriter, r *http.Request) {
        var req CreateStudentRequest
        if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
                middleware.JSONError(w, "payload invalide", http.StatusBadRequest)
                return
        }
        if req.FirstName == "" || req.LastName == "" || req.ClassID == "" {
                middleware.JSONError(w, "first_name, last_name et class_id requis", http.StatusBadRequest)
                return
        }
        if req.Gender != "M" && req.Gender != "F" {
                middleware.JSONError(w, "gender doit être 'M' ou 'F'", http.StatusBadRequest)
                return
        }
        // Vérifier que la classe existe réellement en base (évite les élèves orphelins)
        var cls models.Class
        if err := database.DB.First(&cls, "id = ?", req.ClassID).Error; err != nil {
                middleware.JSONError(w, "classe introuvable — créez la classe avant d'y inscrire un élève", http.StatusBadRequest)
                return
        }

        // Si le matricule est fourni dans le body, on l'utilise ; sinon nil (NULL).
        var matricule *string
        if req.Matricule != nil {
                matricule = normalizeMatricule(*req.Matricule)
                if matricule != nil {
                        // Vérifier l'unicité explicitement pour renvoyer un message clair
                        var existing int64
                        database.DB.Model(&models.Student{}).Where("matricule = ?", *matricule).Count(&existing)
                        if existing > 0 {
                                middleware.JSONError(w, "un élève avec ce matricule existe déjà", http.StatusConflict)
                                return
                        }
                }
        }

        student := models.Student{
                Matricule: matricule,
                ClassID:   req.ClassID,
                FirstName: req.FirstName,
                LastName:  req.LastName,
                Gender:    req.Gender,
        }

        // Date de naissance optionnelle
        if req.BirthDate != nil && *req.BirthDate != "" {
                t, err := time.Parse(time.RFC3339, *req.BirthDate)
                if err == nil {
                        student.BirthDate = &t
                }
        }

        if err := database.DB.Create(&student).Error; err != nil {
                middleware.JSONError(w, "erreur création élève: "+err.Error(), http.StatusInternalServerError)
                return
        }
        jsonResponse(w, http.StatusCreated, student)
}

// UpdateStudent updates a student.
// Le matricule peut être modifié (ou effacé en envoyant une string vide).
func UpdateStudent(w http.ResponseWriter, r *http.Request) {
        id := chi.URLParam(r, "id")
        var req CreateStudentRequest
        if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
                middleware.JSONError(w, "payload invalide", http.StatusBadRequest)
                return
        }
        var student models.Student
        if err := database.DB.First(&student, "id = ?", id).Error; err != nil {
                middleware.JSONError(w, "élève introuvable", http.StatusNotFound)
                return
        }
        if req.FirstName != "" {
                student.FirstName = req.FirstName
        }
        if req.LastName != "" {
                student.LastName = req.LastName
        }
        if req.Gender == "M" || req.Gender == "F" {
                student.Gender = req.Gender
        }
        if req.ClassID != "" {
                student.ClassID = req.ClassID
        }
        if req.Matricule != nil {
                newMat := normalizeMatricule(*req.Matricule)
                // Vérifier l'unicité si la nouvelle valeur est non vide
                if newMat != nil {
                        var existing int64
                        database.DB.Model(&models.Student{}).
                                Where("matricule = ? AND id != ?", *newMat, id).
                                Count(&existing)
                        if existing > 0 {
                                middleware.JSONError(w, "un élève avec ce matricule existe déjà", http.StatusConflict)
                                return
                        }
                }
                student.Matricule = newMat
        }
        if req.BirthDate != nil && *req.BirthDate != "" {
                t, err := time.Parse(time.RFC3339, *req.BirthDate)
                if err == nil {
                        student.BirthDate = &t
                }
        }
        if err := database.DB.Save(&student).Error; err != nil {
                middleware.JSONError(w, "erreur mise à jour", http.StatusInternalServerError)
                return
        }
        jsonResponse(w, http.StatusOK, student)
}

// DeleteStudent removes a student.
func DeleteStudent(w http.ResponseWriter, r *http.Request) {
        id := chi.URLParam(r, "id")
        if err := database.DB.Delete(&models.Student{}, "id = ?", id).Error; err != nil {
                middleware.JSONError(w, "erreur suppression", http.StatusInternalServerError)
                return
        }
        jsonResponse(w, http.StatusOK, map[string]string{"status": "deleted"})
}
