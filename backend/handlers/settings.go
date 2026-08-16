package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"

	"sygren-api/database"
	"sygren-api/middleware"
	"sygren-api/models"

	"github.com/go-chi/chi/v5"
)

// === Paramètres du système (cahier des charges §3 Module 5) ===
//
// Permet de configurer globalement :
//   - Les seuils de mentions (Très Bien, Bien, Assez Bien, etc.)
//   - Le coefficient par défaut des matières
//   - L'année scolaire en cours
//   - Les seuils de réussite/distinction
//
// Endpoints :
//   GET  /api/settings            → liste tous les settings
//   PUT  /api/settings/{key}      → met à jour un setting
//   GET  /api/settings/{key}     → récupère un setting précis
//
// Accès : admin uniquement (gestion globale du système)

// ListSettings retourne tous les paramètres, groupés par catégorie.
func ListSettings(w http.ResponseWriter, r *http.Request) {
	var settings []models.Setting
	if err := database.DB.Order("category ASC, key ASC").Find(&settings).Error; err != nil {
		middleware.JSONError(w, "erreur récupération paramètres", http.StatusInternalServerError)
		return
	}

	// Grouper par catégorie
	grouped := make(map[string][]models.Setting)
	for _, s := range settings {
		grouped[s.Category] = append(grouped[s.Category], s)
	}

	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"settings": grouped,
		"count":    len(settings),
	})
}

// GetSetting retourne un paramètre précis par sa clé.
func GetSetting(w http.ResponseWriter, r *http.Request) {
	key := chi.URLParam(r, "key")
	if key == "" {
		middleware.JSONError(w, "clé requise", http.StatusBadRequest)
		return
	}

	var setting models.Setting
	if err := database.DB.Where("key = ?", key).First(&setting).Error; err != nil {
		middleware.JSONError(w, "paramètre introuvable", http.StatusNotFound)
		return
	}

	jsonResponse(w, http.StatusOK, setting)
}

// UpdateSettingRequest — payload pour mettre à jour un setting
type UpdateSettingRequest struct {
	Value string `json:"value"`
}

// UpdateSetting met à jour la valeur d'un paramètre.
func UpdateSetting(w http.ResponseWriter, r *http.Request) {
	key := chi.URLParam(r, "key")
	var req UpdateSettingRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		middleware.JSONError(w, "payload invalide", http.StatusBadRequest)
		return
	}

	var setting models.Setting
	if err := database.DB.Where("key = ?", key).First(&setting).Error; err != nil {
		middleware.JSONError(w, "paramètre introuvable", http.StatusNotFound)
		return
	}

	// Validation selon la catégorie
	if setting.Category == "mention" || setting.Category == "system" || setting.Category == "coefficient" {
		val, err := strconv.ParseFloat(req.Value, 64)
		if err != nil {
			middleware.JSONError(w, "valeur numérique requise pour cette catégorie", http.StatusBadRequest)
			return
		}
		if val < 0 || val > 20 {
			middleware.JSONError(w, "valeur doit être entre 0 et 20", http.StatusBadRequest)
			return
		}
	}

	setting.Value = req.Value
	if err := database.DB.Save(&setting).Error; err != nil {
		middleware.JSONError(w, "erreur mise à jour", http.StatusInternalServerError)
		return
	}

	jsonResponse(w, http.StatusOK, setting)
}

// GetSettingsMap retourne les settings sous forme de map key→value (utilitaire interne).
// Fonction exportée pour être utilisée par computation.go.
func GetSettingsMap() map[string]string {
	var settings []models.Setting
	database.DB.Find(&settings)
	m := make(map[string]string, len(settings))
	for _, s := range settings {
		m[s.Key] = s.Value
	}
	return m
}

// GetMentionThresholds retourne les seuils de mentions depuis les settings
// (avec fallback sur les valeurs par défaut si non trouvés).
func GetMentionThresholds() (tresBien, bien, assezBien, passable, faible, insuffisant float64) {
	m := GetSettingsMap()
	tresBien = getSettingFloat(m, "mention.threshold.tres_bien", 16)
	bien = getSettingFloat(m, "mention.threshold.bien", 14)
	assezBien = getSettingFloat(m, "mention.threshold.assez_bien", 12)
	passable = getSettingFloat(m, "mention.threshold.passable", 10)
	faible = getSettingFloat(m, "mention.threshold.faible", 8)
	insuffisant = getSettingFloat(m, "mention.threshold.insuffisant", 5)
	return
}

// GetSystemSettings retourne les paramètres système clés.
func GetSystemSettings() (schoolYear int, passThreshold, distinctionThreshold float64) {
	m := GetSettingsMap()
	schoolYear = int(getSettingFloat(m, "system.school_year", 2026))
	passThreshold = getSettingFloat(m, "system.pass_rate_threshold", 10)
	distinctionThreshold = getSettingFloat(m, "system.distinction_threshold", 14)
	return
}

func getSettingFloat(m map[string]string, key string, defaultVal float64) float64 {
	if v, ok := m[key]; ok {
		if f, err := strconv.ParseFloat(v, 64); err == nil {
			return f
		}
	}
	return defaultVal
}
