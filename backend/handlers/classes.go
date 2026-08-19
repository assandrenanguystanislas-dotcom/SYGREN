package handlers

import (
        "encoding/json"
        "net/http"

        "sygren-api/database"
        "sygren-api/middleware"
        "sygren-api/models"

        "github.com/go-chi/chi/v5"
)

// === Classes — Gestion des classes (CP1, CP2, CE1, CE2, CM1, CM2) ===
// Accès :
//   - admin : toutes les classes
//   - inspector : classes des écoles de son IEP
//   - director : classes de son école
//   - teacher : sa classe uniquement

// ClassWithDetails — classe enrichie
type ClassWithDetails struct {
        models.Class
        SchoolName   string  `json:"school_name,omitempty"`
        TeacherName  *string `json:"teacher_name,omitempty"`
        StudentCount int64   `json:"student_count"`
}

// ListClasses returns classes filtered by scope.
// Par défaut, ne retourne que les classes actives. Passer ?include_inactive=true
// pour inclure les classes désactivées (utile à l'admin/directeur pour la gestion).
func ListClasses(w http.ResponseWriter, r *http.Request) {
        role := ctxRole(r)
        query := database.DB.Model(&models.Class{})

        // Filtre active par défaut (sauf si ?include_inactive=true)
        includeInactive := r.URL.Query().Get("include_inactive") == "true"
        if !includeInactive {
                query = query.Where("active = ?", true)
        }

        // Filtre optionnel par school_id (query param)
        if schoolID := r.URL.Query().Get("school_id"); schoolID != "" {
                query = query.Where("classes.school_id = ?", schoolID)
        }

        switch role {
        case "inspector":
                iepID := ctxIEPID(r)
                if iepID == "" {
                        jsonResponse(w, http.StatusOK, map[string]interface{}{"classes": []interface{}{}, "count": 0})
                        return
                }
                query = query.Joins("JOIN schools ON schools.id = classes.school_id").
                        Where("schools.iep_id = ?", iepID)
        case "director":
                schoolID := ctxSchoolID(r)
                if schoolID == "" {
                        jsonResponse(w, http.StatusOK, map[string]interface{}{"classes": []interface{}{}, "count": 0})
                        return
                }
                query = query.Where("school_id = ?", schoolID)
        case "teacher":
                // L'enseignant ne voit que sa classe
                userID := ctxUserID(r)
                query = query.Where("teacher_id = ?", userID)
        }

        var classes []models.Class
        if err := query.Order("name ASC").Find(&classes).Error; err != nil {
                middleware.JSONError(w, "erreur récupération classes", http.StatusInternalServerError)
                return
        }

        result := make([]ClassWithDetails, 0, len(classes))
        for _, c := range classes {
                var d ClassWithDetails
                d.Class = c
                // Nom de l'école
                var school models.School
                if err := database.DB.First(&school, "id = ?", c.SchoolID).Error; err == nil {
                        d.SchoolName = school.Name
                }
                // Nom de l'enseignant
                if c.TeacherID != nil {
                        var teacher models.User
                        if err := database.DB.First(&teacher, "id = ?", *c.TeacherID).Error; err == nil {
                                n := teacher.FullName
                                d.TeacherName = &n
                        }
                }
                // Nombre d'élèves
                database.DB.Model(&models.Student{}).Where("class_id = ?", c.ID).Count(&d.StudentCount)
                result = append(result, d)
        }

        jsonResponse(w, http.StatusOK, map[string]interface{}{
                "classes": result,
                "count":   len(result),
        })
}

// CreateClassRequest — payload pour créer une classe
type CreateClassRequest struct {
        SchoolID  string  `json:"school_id"`
        Name      string  `json:"name"`      // CP1, CP2, CE1, CE2, CM1, CM2
        Level     string  `json:"level"`    // CP, CE, CM
        TeacherID *string `json:"teacher_id"`
        Active    *bool   `json:"active,omitempty"` // soft-delete toggle
}

// ValidClassNames — classes autorisées (cahier des charges §3 Module 1)
var ValidClassNames = map[string]string{
        "CP1": "CP", "CP2": "CP",
        "CE1": "CE", "CE2": "CE",
        "CM1": "CM", "CM2": "CM",
}

// CreateClass creates a new class.
func CreateClass(w http.ResponseWriter, r *http.Request) {
        var req CreateClassRequest
        if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
                middleware.JSONError(w, "payload invalide", http.StatusBadRequest)
                return
        }
        if req.SchoolID == "" || req.Name == "" {
                middleware.JSONError(w, "school_id et name requis", http.StatusBadRequest)
                return
        }
        // Valide le nom de classe
        level, ok := ValidClassNames[req.Name]
        if !ok {
                middleware.JSONError(w, "nom de classe invalide (CP1, CP2, CE1, CE2, CM1, CM2)", http.StatusBadRequest)
                return
        }
        // Vérifier que l'école existe réellement en base (évite les classes orphelines)
        var school models.School
        if err := database.DB.First(&school, "id = ?", req.SchoolID).Error; err != nil {
                middleware.JSONError(w, "école introuvable — créez l'école avant d'y ajouter une classe", http.StatusBadRequest)
                return
        }
        if req.Level == "" {
                req.Level = level
        }
        cls := models.Class{
                SchoolID:  req.SchoolID,
                Name:      req.Name,
                Level:     req.Level,
                TeacherID: req.TeacherID,
        }
        if err := database.DB.Create(&cls).Error; err != nil {
                middleware.JSONError(w, "erreur création classe", http.StatusInternalServerError)
                return
        }
        jsonResponse(w, http.StatusCreated, cls)
}

// UpdateClass updates a class (notamment affectation enseignant + toggle active).
// Garde-fou : on ne peut pas désactiver une classe qui a des élèves actifs
// (il faut d'abord déplacer les élèves vers une autre classe active).
func UpdateClass(w http.ResponseWriter, r *http.Request) {
        id := chi.URLParam(r, "id")
        var req CreateClassRequest
        if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
                middleware.JSONError(w, "payload invalide", http.StatusBadRequest)
                return
        }
        var cls models.Class
        if err := database.DB.First(&cls, "id = ?", id).Error; err != nil {
                middleware.JSONError(w, "classe introuvable", http.StatusNotFound)
                return
        }
        if req.Name != "" {
                if _, ok := ValidClassNames[req.Name]; !ok {
                        middleware.JSONError(w, "nom de classe invalide", http.StatusBadRequest)
                        return
                }
                cls.Name = req.Name
                cls.Level = ValidClassNames[req.Name]
        }
        // Affectation dynamique enseignant (cahier des charges §3 Module 1)
        cls.TeacherID = req.TeacherID
        // Toggle active (soft-delete) avec garde-fou élèves
        if req.Active != nil {
                // Si on tente de désactiver (active=false) alors qu'il y a des élèves
                if !*req.Active {
                        var studentCount int64
                        database.DB.Model(&models.Student{}).Where("class_id = ?", id).Count(&studentCount)
                        if studentCount > 0 {
                                middleware.JSONError(w, "impossible de désactiver : déplacez d'abord les élèves vers une autre classe active", http.StatusConflict)
                                return
                        }
                }
                cls.Active = *req.Active
        }
        if err := database.DB.Save(&cls).Error; err != nil {
                middleware.JSONError(w, "erreur mise à jour", http.StatusInternalServerError)
                return
        }
        jsonResponse(w, http.StatusOK, cls)
}

// DeleteClass removes a class (must have no students).
func DeleteClass(w http.ResponseWriter, r *http.Request) {
        id := chi.URLParam(r, "id")
        var count int64
        database.DB.Model(&models.Student{}).Where("class_id = ?", id).Count(&count)
        if count > 0 {
                middleware.JSONError(w, "impossible de supprimer : des élèves sont inscrits dans cette classe", http.StatusConflict)
                return
        }
        if err := database.DB.Delete(&models.Class{}, "id = ?", id).Error; err != nil {
                middleware.JSONError(w, "erreur suppression", http.StatusInternalServerError)
                return
        }
        jsonResponse(w, http.StatusOK, map[string]string{"status": "deleted"})
}
