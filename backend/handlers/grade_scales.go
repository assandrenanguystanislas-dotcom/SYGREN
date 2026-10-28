package handlers

import (
	"encoding/json"
	"net/http"
	"strings"

	"sygren-api/database"
	"sygren-api/middleware"
	"sygren-api/models"

	"github.com/go-chi/chi/v5"
)

// === GradeScales — Barèmes de notation (cahier des charges §3 Module 2) ===
// Définit le barème d'une matière pour un niveau donné : note minimale
// (MinScore — plancher) et maximale (MaxScore — plafond).
// Si SubjectID est NULL → barème par défaut du niveau (toutes matières).
// Si SubjectID est défini → exception spécifique (ex: Dictée CE à 2–20).
//
// Accès :
//   - admin : CRUD complet
//   - director : lecture + édition (son école)
//   - inspector/teacher : lecture seule

// GradeScaleWithSubject — barème enrichi avec le nom de la matière
type GradeScaleWithSubject struct {
	models.GradeScale
	SubjectName string `json:"subject_name,omitempty"`
}

// ListGradeScales returns all grade scales, optionally filtered by level.
// Query param: level (optional: "CP" | "CE" | "CM")
func ListGradeScales(w http.ResponseWriter, r *http.Request) {
	query := database.DB.Model(&models.GradeScale{})

	if level := r.URL.Query().Get("level"); level != "" {
		level = strings.ToUpper(strings.TrimSpace(level))
		query = query.Where("level = ?", level)
	}

	var scales []models.GradeScale
	if err := query.Order("level ASC, subject_id ASC").Find(&scales).Error; err != nil {
		middleware.JSONError(w, "erreur récupération barèmes", http.StatusInternalServerError)
		return
	}

	// Enrichir avec le nom de la matière
	result := make([]GradeScaleWithSubject, 0, len(scales))
	for _, s := range scales {
		var d GradeScaleWithSubject
		d.GradeScale = s
		if s.SubjectID != nil {
			var subj models.Subject
			if err := database.DB.First(&subj, "id = ?", *s.SubjectID).Error; err == nil {
				d.SubjectName = subj.Name
			}
		}
		result = append(result, d)
	}

	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"grade_scales": result,
		"count":        len(result),
	})
}

// CreateGradeScaleRequest — payload pour créer / modifier un barème.
// MinScore est un pointeur : nil = valeur par défaut (0 à la création,
// inchangé à la modification) — permet de remettre le plancher à 0.
type CreateGradeScaleRequest struct {
	Level     string  `json:"level"`      // "CP" | "CE" | "CM"
	SubjectID *string `json:"subject_id"` // NULL = défaut du niveau
	MinScore  *int    `json:"min_score"`  // plancher (0 = pas de minimum)
	MaxScore  int     `json:"max_score"`  // 10, 20, 30, 50...
}

// CreateGradeScale creates a new grade scale (admin only).
func CreateGradeScale(w http.ResponseWriter, r *http.Request) {
	var req CreateGradeScaleRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		middleware.JSONError(w, "payload invalide", http.StatusBadRequest)
		return
	}
	req.Level = strings.ToUpper(strings.TrimSpace(req.Level))
	if req.Level != "CP" && req.Level != "CE" && req.Level != "CM" {
		middleware.JSONError(w, "level doit être CP, CE ou CM", http.StatusBadRequest)
		return
	}
	if req.MaxScore <= 0 {
		middleware.JSONError(w, "max_score doit être > 0", http.StatusBadRequest)
		return
	}
	minScore := 0
	if req.MinScore != nil {
		minScore = *req.MinScore
	}
	if minScore < 0 {
		middleware.JSONError(w, "min_score doit être >= 0", http.StatusBadRequest)
		return
	}
	if minScore > req.MaxScore {
		middleware.JSONError(w, "min_score doit être <= max_score", http.StatusBadRequest)
		return
	}
	// Vérifier que le sujet existe si fourni
	if req.SubjectID != nil && *req.SubjectID != "" {
		var subj models.Subject
		if err := database.DB.First(&subj, "id = ?", *req.SubjectID).Error; err != nil {
			middleware.JSONError(w, "matière introuvable", http.StatusBadRequest)
			return
		}
	}
	// Vérifier l'unicité (level + subject_id)
	query := database.DB.Model(&models.GradeScale{}).Where("level = ?", req.Level)
	if req.SubjectID != nil && *req.SubjectID != "" {
		query = query.Where("subject_id = ?", *req.SubjectID)
	} else {
		query = query.Where("subject_id IS NULL")
	}
	var existing int64
	query.Count(&existing)
	if existing > 0 {
		middleware.JSONError(w, "un barème existe déjà pour ce niveau/matière", http.StatusConflict)
		return
	}

	gs := models.GradeScale{
		Level:     req.Level,
		SubjectID: req.SubjectID,
		MinScore:  minScore,
		MaxScore:  req.MaxScore,
	}
	if err := database.DB.Create(&gs).Error; err != nil {
		middleware.JSONError(w, "erreur création barème", http.StatusInternalServerError)
		return
	}
	jsonResponse(w, http.StatusCreated, gs)
}

// UpdateGradeScale updates an existing grade scale.
func UpdateGradeScale(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req CreateGradeScaleRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		middleware.JSONError(w, "payload invalide", http.StatusBadRequest)
		return
	}
	var gs models.GradeScale
	if err := database.DB.First(&gs, "id = ?", id).Error; err != nil {
		middleware.JSONError(w, "barème introuvable", http.StatusNotFound)
		return
	}
	if req.Level != "" {
		req.Level = strings.ToUpper(strings.TrimSpace(req.Level))
		if req.Level != "CP" && req.Level != "CE" && req.Level != "CM" {
			middleware.JSONError(w, "level doit être CP, CE ou CM", http.StatusBadRequest)
			return
		}
		gs.Level = req.Level
	}
	if req.MaxScore > 0 {
		gs.MaxScore = req.MaxScore
	}
	if req.MinScore != nil {
		if *req.MinScore < 0 {
			middleware.JSONError(w, "min_score doit être >= 0", http.StatusBadRequest)
			return
		}
		if *req.MinScore > gs.MaxScore {
			middleware.JSONError(w, "min_score doit être <= max_score", http.StatusBadRequest)
			return
		}
		gs.MinScore = *req.MinScore
	}
	if gs.MinScore > gs.MaxScore {
		middleware.JSONError(w, "min_score doit être <= max_score", http.StatusBadRequest)
		return
	}
	if req.SubjectID != nil {
		gs.SubjectID = req.SubjectID
	}
	if err := database.DB.Save(&gs).Error; err != nil {
		middleware.JSONError(w, "erreur mise à jour", http.StatusInternalServerError)
		return
	}
	jsonResponse(w, http.StatusOK, gs)
}

// DeleteGradeScale removes a grade scale.
func DeleteGradeScale(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := database.DB.Delete(&models.GradeScale{}, "id = ?", id).Error; err != nil {
		middleware.JSONError(w, "erreur suppression", http.StatusInternalServerError)
		return
	}
	jsonResponse(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// === Helper : getGradeScale / getMaxScore ===
// getGradeScale retourne le barème (plancher, plafond) pour un niveau +
// matière donné. Logique de lookup :
//  1. Chercher (level, subjectID) exact → si trouvé, retourner (Min, Max)
//  2. Sinon chercher (level, NULL) → défaut du niveau
//  3. Sinon → (0, 20) (sécurité)
//
// Ex : getGradeScale("CE", "dictée-id") → (2, 20) (exception)
//
//	getGradeScale("CE", "math-id")   → (1, 30) (défaut CE)
//	getGradeScale("CP", "math-id")   → (1, 10) (défaut CP)
func getGradeScale(level, subjectID string) (int, int) {
	// 1. Exception spécifique (level + subject_id)
	if subjectID != "" {
		var gs models.GradeScale
		if err := database.DB.Where("level = ? AND subject_id = ?", level, subjectID).First(&gs).Error; err == nil {
			return gs.MinScore, gs.MaxScore
		}
	}
	// 2. Défaut du niveau (level + subject_id IS NULL)
	var def models.GradeScale
	if err := database.DB.Where("level = ? AND subject_id IS NULL", level).First(&def).Error; err == nil {
		return def.MinScore, def.MaxScore
	}
	// 3. Sécurité : 0–20
	return 0, 20
}

// getMaxScore retourne le plafond du barème pour un niveau + matière donné
// (conservé pour les appels existants — PDA, computation, palmarès…).
func getMaxScore(level, subjectID string) int {
	_, maxScore := getGradeScale(level, subjectID)
	return maxScore
}
