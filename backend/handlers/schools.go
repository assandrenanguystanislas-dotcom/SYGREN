package handlers

import (
	"encoding/json"
	"log"
	"net/http"

	"sygren-api/database"
	"sygren-api/middleware"
	"sygren-api/models"

	"github.com/go-chi/chi/v5"
)

// === Schools — Gestion des établissements scolaires ===
// Accès :
//   - admin : toutes les écoles
//   - inspector : écoles de son IEP
//   - director/teacher : école de son école_id

// SchoolWithStats — école enrichie avec compteurs
type SchoolWithStats struct {
	models.School
	IEPName      string `json:"iep_name,omitempty"`
	ClassCount   int64  `json:"class_count"`
	StudentCount int64  `json:"student_count"`
}

// ListSchools returns schools filtered by the user's scope.
//
// Perf : 4 requêtes au TOTAL (écoles, IEPs, compteurs classes, compteurs
// élèves) au lieu de 3 requêtes PAR école (pattern N+1). Avec 97 écoles,
// l'ancienne version émettait ~291 requêtes séquentielles : invisible depuis
// Render (co-localisé avec Neon eu-central-1, ~2 ms/requête → 0,6 s) mais
// >2 min depuis un client éloigné du pooler (~400 ms/requête). Les agrégats
// GROUP BY rendent le coût constant quel que soit le nombre d'écoles.
func ListSchools(w http.ResponseWriter, r *http.Request) {
	role := ctxRole(r)
	query := database.DB.Model(&models.School{})

	switch role {
	case "director", "teacher":
		schoolID := ctxSchoolID(r)
		if schoolID == "" {
			jsonResponse(w, http.StatusOK, map[string]interface{}{"schools": []interface{}{}, "count": 0})
			return
		}
		query = query.Where("id = ?", schoolID)
	}

	var schools []models.School
	if err := query.Order("name ASC").Find(&schools).Error; err != nil {
		middleware.JSONError(w, "erreur récupération écoles", http.StatusInternalServerError)
		return
	}

	// IDs des écoles retournées (pour les 3 requêtes d'enrichissement en masse)
	schoolIDs := make([]string, len(schools))
	for i, s := range schools {
		schoolIDs[i] = s.ID
	}

	// Noms d'IEP : 1 requête IN (...) au lieu de 1 requête par école
	iepName := make(map[string]string)
	iepIDs := make([]string, 0, len(schools))
	seen := make(map[string]bool, len(schools))
	for _, s := range schools {
		if s.IEPID != "" && !seen[s.IEPID] {
			seen[s.IEPID] = true
			iepIDs = append(iepIDs, s.IEPID)
		}
	}
	if len(iepIDs) > 0 {
		var ieps []models.IEP
		if err := database.DB.Select("id", "name").Where("id IN ?", iepIDs).Find(&ieps).Error; err != nil {
			log.Println("[schools] enrichissement IEP:", err)
		}
		for _, i := range ieps {
			iepName[i.ID] = i.Name
		}
	}

	// Compteurs : 2 agrégats GROUP BY au lieu de 2 requêtes par école
	// NB : une slice DISTINCTE par Scan — gorm Scan RÉUTILISE la slice
	// passée en paramètre si sa capacité est non nulle (scan.go : « the
	// externally initialized slice is directly used here ») ; réutiliser la
	// même variable ferait persister les lignes de la 1re requête quand la
	// 2de en retourne moins (ex : école avec classes mais 0 élève).
	type idCount struct {
		SchoolID string `json:"school_id"`
		Count    int64  `json:"count"`
	}
	classCounts := make(map[string]int64, len(schools))
	studentCounts := make(map[string]int64, len(schools))
	if len(schoolIDs) > 0 {
		var classRows []idCount
		if err := database.DB.Model(&models.Class{}).
			Select("school_id", "COUNT(*) AS count").
			Where("school_id IN ?", schoolIDs).
			Group("school_id").
			Scan(&classRows).Error; err != nil {
			log.Println("[schools] compteur classes:", err)
		}
		for _, row := range classRows {
			classCounts[row.SchoolID] = row.Count
		}

		var studentRows []idCount
		if err := database.DB.Model(&models.Student{}).
			Joins("JOIN classes ON classes.id = students.class_id").
			Select("classes.school_id AS school_id", "COUNT(*) AS count").
			Where("classes.school_id IN ?", schoolIDs).
			Group("classes.school_id").
			Scan(&studentRows).Error; err != nil {
			log.Println("[schools] compteur élèves:", err)
		}
		for _, row := range studentRows {
			studentCounts[row.SchoolID] = row.Count
		}
	}

	// Assemblage en mémoire — plus aucune requête dans cette boucle
	result := make([]SchoolWithStats, 0, len(schools))
	for _, s := range schools {
		result = append(result, SchoolWithStats{
			School:       s,
			IEPName:      iepName[s.IEPID],
			ClassCount:   classCounts[s.ID],
			StudentCount: studentCounts[s.ID],
		})
	}

	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"schools": result,
		"count":   len(result),
	})
}

// ValidSchoolStatus — statuts autorisés pour une école
var ValidSchoolStatus = map[string]string{
	"public":    "Public",
	"private":   "Privé",
	"community": "Communautaire",
}

// CreateSchoolRequest — payload pour créer une école
type CreateSchoolRequest struct {
	IEPID   string `json:"iep_id"`
	Code    string `json:"code"` // code unique identifiant l'école dans le système IEP
	Name    string `json:"name"`
	Address string `json:"address"`
	Status  string `json:"status"` // public | private | community
}

// CreateSchool creates a new school (admin only).
// Auto-crée les 6 classes standard du primaire ivoirien (CP1, CP2, CE1, CE2, CM1, CM2)
// — cahier des charges §3 Module 1. Toutes actives par défaut.
func CreateSchool(w http.ResponseWriter, r *http.Request) {
	var req CreateSchoolRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		middleware.JSONError(w, "payload invalide", http.StatusBadRequest)
		return
	}
	if req.Name == "" || req.IEPID == "" || req.Code == "" {
		middleware.JSONError(w, "code, nom et iep_id requis", http.StatusBadRequest)
		return
	}
	// Valider le statut (défaut: public)
	if req.Status == "" {
		req.Status = "public"
	}
	if _, ok := ValidSchoolStatus[req.Status]; !ok {
		middleware.JSONError(w, "statut invalide (public, private, community)", http.StatusBadRequest)
		return
	}
	// Vérifier que l'IEP existe réellement en base (évite les écoles orphelines)
	var iep models.IEP
	if err := database.DB.First(&iep, "id = ?", req.IEPID).Error; err != nil {
		middleware.JSONError(w, "IEP introuvable — créez l'inspection avant d'y ajouter une école", http.StatusBadRequest)
		return
	}
	// Vérifier l'unicité du code école
	var existing int64
	database.DB.Model(&models.School{}).Where("code = ?", req.Code).Count(&existing)
	if existing > 0 {
		middleware.JSONError(w, "une école avec ce code existe déjà", http.StatusConflict)
		return
	}
	school := models.School{
		IEPID:   req.IEPID,
		Code:    req.Code,
		Name:    req.Name,
		Address: req.Address,
		Status:  req.Status,
	}
	if err := database.DB.Create(&school).Error; err != nil {
		middleware.JSONError(w, "erreur création école", http.StatusInternalServerError)
		return
	}

	// Auto-création des 6 classes standard (actives par défaut)
	for name, level := range ValidClassNames {
		cls := models.Class{
			SchoolID: school.ID,
			Name:     name,
			Level:    level,
			Active:   true,
		}
		if err := database.DB.Create(&cls).Error; err != nil {
			log.Printf("[DB] auto-create class %s for school %s: %v", name, school.ID, err)
		}
	}
	log.Printf("[DB] 6 classes auto-créées pour l'école %s", school.ID)

	jsonResponse(w, http.StatusCreated, school)
}

// UpdateSchool updates an existing school.
// Le code peut être modifié (avec vérification d'unicité) ainsi que le statut.
func UpdateSchool(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req CreateSchoolRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		middleware.JSONError(w, "payload invalide", http.StatusBadRequest)
		return
	}
	var school models.School
	if err := database.DB.First(&school, "id = ?", id).Error; err != nil {
		middleware.JSONError(w, "école introuvable", http.StatusNotFound)
		return
	}
	if req.Name != "" {
		school.Name = req.Name
	}
	if req.Address != "" {
		school.Address = req.Address
	}
	if req.IEPID != "" {
		school.IEPID = req.IEPID
	}
	if req.Code != "" && req.Code != school.Code {
		// Vérifier l'unicité du nouveau code
		var existing int64
		database.DB.Model(&models.School{}).Where("code = ? AND id != ?", req.Code, id).Count(&existing)
		if existing > 0 {
			middleware.JSONError(w, "une école avec ce code existe déjà", http.StatusConflict)
			return
		}
		school.Code = req.Code
	}
	if req.Status != "" {
		if _, ok := ValidSchoolStatus[req.Status]; !ok {
			middleware.JSONError(w, "statut invalide (public, private, community)", http.StatusBadRequest)
			return
		}
		school.Status = req.Status
	}
	if err := database.DB.Save(&school).Error; err != nil {
		middleware.JSONError(w, "erreur mise à jour", http.StatusInternalServerError)
		return
	}
	jsonResponse(w, http.StatusOK, school)
}

// DeleteSchool removes a school (cascade-check: must have no classes).
func DeleteSchool(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var classCount int64
	database.DB.Model(&models.Class{}).Where("school_id = ?", id).Count(&classCount)
	if classCount > 0 {
		middleware.JSONError(w, "impossible de supprimer : des classes existent dans cette école", http.StatusConflict)
		return
	}
	if err := database.DB.Delete(&models.School{}, "id = ?", id).Error; err != nil {
		middleware.JSONError(w, "erreur suppression", http.StatusInternalServerError)
		return
	}
	jsonResponse(w, http.StatusOK, map[string]string{"status": "deleted"})
}
