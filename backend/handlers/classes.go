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

	// === Fix A : batch des student_count (1 query GROUP BY au lieu de N COUNT) ===
	// Avant : 582 COUNT séparés (1 par classe) → 2.75s. Maintenant : 1 query.
	countMap := make(map[string]int64, len(classes))
	if len(classes) > 0 {
		classIDs := make([]string, len(classes))
		for i, c := range classes {
			classIDs[i] = c.ID
		}
		type countRow struct {
			ClassID string
			Count   int64
		}
		var counts []countRow
		database.DB.Model(&models.Student{}).
			Select("class_id, count(*) as count").
			Where("class_id IN ?", classIDs).
			Group("class_id").
			Find(&counts)
		for _, cr := range counts {
			countMap[cr.ClassID] = cr.Count
		}
	}

	// === Fix A suite : batch des school + teacher lookups (était 1 query/classe = N+1) ===
	// Collecte des IDs uniques (schools + teachers non-nil).
	schoolIDSet := make(map[string]bool)
	teacherIDSet := make(map[string]bool)
	for _, c := range classes {
		schoolIDSet[c.SchoolID] = true
		if c.TeacherID != nil {
			teacherIDSet[*c.TeacherID] = true
		}
	}
	// 1 query pour toutes les écoles
	schoolMap := make(map[string]string, len(schoolIDSet))
	if len(schoolIDSet) > 0 {
		ids := make([]string, 0, len(schoolIDSet))
		for id := range schoolIDSet {
			ids = append(ids, id)
		}
		var schools []models.School
		database.DB.Where("id IN ?", ids).Find(&schools)
		for _, s := range schools {
			schoolMap[s.ID] = s.Name
		}
	}
	// 1 query pour tous les enseignants
	teacherMap := make(map[string]string, len(teacherIDSet))
	if len(teacherIDSet) > 0 {
		ids := make([]string, 0, len(teacherIDSet))
		for id := range teacherIDSet {
			ids = append(ids, id)
		}
		var teachers []models.User
		database.DB.Where("id IN ?", ids).Find(&teachers)
		for _, t := range teachers {
			teacherMap[t.ID] = t.FullName
		}
	}

	for _, c := range classes {
		var d ClassWithDetails
		d.Class = c
		// Nom de l'école (depuis schoolMap — pas de requête par classe)
		d.SchoolName = schoolMap[c.SchoolID]
		// Nom de l'enseignant (depuis teacherMap)
		if c.TeacherID != nil {
			if n, ok := teacherMap[*c.TeacherID]; ok {
				d.TeacherName = &n
			}
		}
		// Nombre d'élèves (depuis le batch countMap — pas de requête par classe)
		d.StudentCount = countMap[c.ID]
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
	Name      string  `json:"name"`  // CP1, CP2, CE1, CE2, CM1, CM2
	Level     string  `json:"level"` // CP, CE, CM
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
