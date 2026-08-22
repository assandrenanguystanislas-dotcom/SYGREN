package handlers

import (
	"encoding/json"
	"net/http"

	"sygren-api/config"
	"sygren-api/database"
	"sygren-api/middleware"
	"sygren-api/models"
	"sygren-api/utils"
)

// LoginRequest — connexion via téléphone OU email (cahier des charges §4.1)
type LoginRequest struct {
	Identifier string `json:"identifier"` // phone OR email
	Password   string `json:"password"`
}

// LoginResponse
type LoginResponse struct {
	Token              string      `json:"token"`
	User               models.User `json:"user"`
	MustChangePassword bool        `json:"must_change_password"`
}

// Login authenticates a user and returns a JWT.
func Login(cfg *config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req LoginRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			middleware.JSONError(w, "payload invalide", http.StatusBadRequest)
			return
		}
		if req.Identifier == "" || req.Password == "" {
			middleware.JSONError(w, "identifiant et mot de passe requis", http.StatusBadRequest)
			return
		}

		// === Recherche multi-méthode de l'utilisateur ===
		// 1. Email OU téléphone (admin, inspector, director avec email, teacher)
		var user models.User
		result := database.DB.Where(
			"phone = ? OR email = ?", req.Identifier, req.Identifier,
		).First(&user)

		// 2. Si pas trouvé, essayer le code école (login director par code établissement)
		if result.Error != nil {
			var school models.School
			if err := database.DB.Where("code = ?", req.Identifier).First(&school).Error; err != nil {
				// Ni email, ni téléphone, ni code école → identifiants invalides
				middleware.JSONError(w, "identifiants invalides", http.StatusUnauthorized)
				return
			}
			// École trouvée → chercher le directeur de cette école
			if err := database.DB.Where("school_id = ? AND role = ?", school.ID, models.RoleDirector).First(&user).Error; err != nil {
				middleware.JSONError(w, "aucun directeur rattaché à cette école", http.StatusUnauthorized)
				return
			}
			// Directeur trouvé → continuer le flow (password check ci-dessous)
		}
		if !user.Active {
			middleware.JSONError(w, "compte désactivé", http.StatusForbidden)
			return
		}
		if err := utils.CheckPassword(req.Password, user.Password); err != nil {
			middleware.JSONError(w, "identifiants invalides", http.StatusUnauthorized)
			return
		}

		// Generate JWT
		schoolID := ""
		if user.SchoolID != nil {
			schoolID = *user.SchoolID
		}
		iepID := ""
		if user.IEPID != nil {
			iepID = *user.IEPID
		}
		token, err := utils.GenerateToken(cfg.JWTSecret, user.ID, user.Role, schoolID, iepID)
		if err != nil {
			middleware.JSONError(w, "erreur génération token", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(LoginResponse{Token: token, User: user, MustChangePassword: user.MustChangePassword})
	}
}

// Me returns the profile of the currently authenticated user.
func Me(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value(middleware.CtxUserID).(string)
	var user models.User
	if err := database.DB.First(&user, "id = ?", userID).Error; err != nil {
		middleware.JSONError(w, "utilisateur introuvable", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(user)
}

// Health returns the API health status (used by the frontend to check connectivity).
func Health(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":  "ok",
		"service": "sygren-api",
		"version": "0.1.0",
	})
}
