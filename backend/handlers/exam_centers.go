package handlers

import (
	"encoding/json"
	"log"
	"net/http"
	"strings"

	"sygren-api/database"
	"sygren-api/middleware"
	"sygren-api/models"

	"github.com/go-chi/chi/v5"
)

// === Exam Centers — Centres d'examen ===
//
// Lieux de regroupement des écoles dans les documents officiels du plan
// d'action pluriannuel de l'IEPP (colonne « CENTRES D'EXAMENS » : les lignes
// écoles y sont groupées par centre). Chaque centre appartient à une IEP ;
// l'affectation d'une école à un centre se fait via POST/PUT /api/schools
// (champ exam_center_id — voir handlers/schools.go).
//
// RBAC (aligné sur le module Écoles, dont le rattachement est une
// extension naturelle) :
//   - lecture  : tous les rôles authentifiés (scope dans le handler)
//   - écriture : RequireModule("schools", "write") — posé au routage

// ExamCenterWithStats — centre enrichi du nombre d'écoles rattachées.
type ExamCenterWithStats struct {
	models.ExamCenter
	SchoolCount int64 `json:"school_count"`
}

// ListExamCenters — GET /api/exam-centers
// Scope : admin = tous les centres ; inspector = ceux de son IEP ;
// director/teacher = le centre de leur école (peut être vide).
func ListExamCenters(w http.ResponseWriter, r *http.Request) {
	role := ctxRole(r)
	query := database.DB.Model(&models.ExamCenter{})

	switch role {
	case "inspector":
		query = query.Where("iep_id = ?", ctxIEPID(r))
	case "director", "teacher":
		// Le centre du user est celui de SON école (NULL = aucun).
		var sch models.School
		if err := database.DB.Select("exam_center_id").
			First(&sch, "id = ?", ctxSchoolID(r)).Error; err != nil {
			middleware.JSONError(w, "école introuvable", http.StatusNotFound)
			return
		}
		if sch.ExamCenterID == nil || *sch.ExamCenterID == "" {
			jsonResponse(w, http.StatusOK, map[string]interface{}{
				"exam_centers": []interface{}{}, "count": 0,
			})
			return
		}
		query = query.Where("id = ?", *sch.ExamCenterID)
	}

	var centers []models.ExamCenter
	if err := query.Order("position ASC, name ASC").Find(&centers).Error; err != nil {
		middleware.JSONError(w, "erreur récupération centres d'examen", http.StatusInternalServerError)
		return
	}

	// Compteur d'écoles rattachées : 1 agrégat GROUP BY (pattern anti-N+1).
	counts := make(map[string]int64, len(centers))
	if len(centers) > 0 {
		ids := make([]string, len(centers))
		for i, c := range centers {
			ids[i] = c.ID
		}
		// Slice distincte par Scan — gorm Scan réutilise la slice destination
		// si sa capacité est non nulle (voir commentaire détaillé dans
		// handlers/schools.go).
		var rows []struct {
			ExamCenterID string `json:"exam_center_id"`
			Count        int64  `json:"count"`
		}
		if err := database.DB.Model(&models.School{}).
			Select("exam_center_id", "COUNT(*) AS count").
			Where("exam_center_id IN ?", ids).
			Group("exam_center_id").
			Scan(&rows).Error; err != nil {
			log.Println("[exam-centers] compteur écoles:", err)
		}
		for _, row := range rows {
			counts[row.ExamCenterID] = row.Count
		}
	}

	result := make([]ExamCenterWithStats, 0, len(centers))
	for _, c := range centers {
		result = append(result, ExamCenterWithStats{ExamCenter: c, SchoolCount: counts[c.ID]})
	}

	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"exam_centers": result,
		"count":        len(result),
	})
}

// examCenterRequest — payload de création / modification.
type examCenterRequest struct {
	IEPID    string `json:"iep_id"`
	Name     string `json:"name"`
	Position *int   `json:"position,omitempty"` // pointeur : absent = inchangé
}

// CreateExamCenter — POST /api/exam-centers {iep_id, name, position?}.
func CreateExamCenter(w http.ResponseWriter, r *http.Request) {
	var req examCenterRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		middleware.JSONError(w, "payload invalide", http.StatusBadRequest)
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" || req.IEPID == "" {
		middleware.JSONError(w, "nom et iep_id requis", http.StatusBadRequest)
		return
	}
	// L'IEP doit exister (évite les centres orphelins).
	var iep models.IEP
	if err := database.DB.First(&iep, "id = ?", req.IEPID).Error; err != nil {
		middleware.JSONError(w, "IEP introuvable — créez l'inspection avant d'y ajouter un centre", http.StatusBadRequest)
		return
	}
	// Unicité du nom au sein de l'IEP (les documents affichent ce nom).
	var existing int64
	database.DB.Model(&models.ExamCenter{}).
		Where("iep_id = ? AND LOWER(name) = LOWER(?)", req.IEPID, req.Name).
		Count(&existing)
	if existing > 0 {
		middleware.JSONError(w, "un centre d'examen de ce nom existe déjà dans cette IEP", http.StatusConflict)
		return
	}
	position := 0
	if req.Position != nil {
		position = *req.Position
	}
	center := models.ExamCenter{IEPID: req.IEPID, Name: req.Name, Position: position}
	if err := database.DB.Create(&center).Error; err != nil {
		middleware.JSONError(w, "erreur création centre d'examen", http.StatusInternalServerError)
		return
	}
	jsonResponse(w, http.StatusCreated, center)
}

// UpdateExamCenter — PUT /api/exam-centers/{id} {name?, position?}.
func UpdateExamCenter(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req examCenterRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		middleware.JSONError(w, "payload invalide", http.StatusBadRequest)
		return
	}
	var center models.ExamCenter
	if err := database.DB.First(&center, "id = ?", id).Error; err != nil {
		middleware.JSONError(w, "centre d'examen introuvable", http.StatusNotFound)
		return
	}
	if name := strings.TrimSpace(req.Name); name != "" && name != center.Name {
		var existing int64
		database.DB.Model(&models.ExamCenter{}).
			Where("iep_id = ? AND LOWER(name) = LOWER(?) AND id != ?", center.IEPID, name, id).
			Count(&existing)
		if existing > 0 {
			middleware.JSONError(w, "un centre d'examen de ce nom existe déjà dans cette IEP", http.StatusConflict)
			return
		}
		center.Name = name
	}
	if req.Position != nil {
		center.Position = *req.Position
	}
	if err := database.DB.Save(&center).Error; err != nil {
		middleware.JSONError(w, "erreur mise à jour", http.StatusInternalServerError)
		return
	}
	jsonResponse(w, http.StatusOK, center)
}

// DeleteExamCenter — DELETE /api/exam-centers/{id}.
// Refusé (409) tant que des écoles y sont rattachées : supprimer un centre
// sans détacher ses écoles les ferait disparaître silencieusement des
// documents officiels groupés par centre.
func DeleteExamCenter(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var center models.ExamCenter
	if err := database.DB.First(&center, "id = ?", id).Error; err != nil {
		middleware.JSONError(w, "centre d'examen introuvable", http.StatusNotFound)
		return
	}
	var schoolCount int64
	database.DB.Model(&models.School{}).Where("exam_center_id = ?", id).Count(&schoolCount)
	if schoolCount > 0 {
		middleware.JSONError(w, "impossible de supprimer : des écoles sont rattachées à ce centre (détachez-les d'abord)", http.StatusConflict)
		return
	}
	if err := database.DB.Delete(&models.ExamCenter{}, "id = ?", id).Error; err != nil {
		middleware.JSONError(w, "erreur suppression", http.StatusInternalServerError)
		return
	}
	jsonResponse(w, http.StatusOK, map[string]string{"status": "deleted"})
}
