package handlers

import (
	"encoding/json"
	"net/http"
	"strings"

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

// UserProfileResponse — profil utilisateur ENRICHI des informations de SON
// établissement (code + nom de l'école) pour les comptes rattachés à une
// école (directeur, enseignant). Demande utilisateur : dans les pages
// Directeur / Enseignant, le CODE ÉCOLE est écrit EN HAUT ET À DROITE de
// la page (menu déroulant « Modifier votre mot de passe / Déconnexion »).
// L'embedding conserve TOUS les champs existants du profil (aucune
// rupture de contrat pour le frontend) ; les deux champs additionnels ne
// sont sérialisés que si l'utilisateur est rattaché à une école.
type UserProfileResponse struct {
	models.User
	SchoolCode *string `json:"school_code,omitempty"`
	SchoolName *string `json:"school_name,omitempty"`
}

// enrichUserWithSchool résout le code et le nom de l'école rattachée au
// profil. Aucune erreur bloquante : si l'école a disparu entre-temps, le
// profil de base est renvoyé tel quel (le reste du flow ne dépend pas de
// ces champs d'affichage).
func enrichUserWithSchool(user models.User) UserProfileResponse {
	resp := UserProfileResponse{User: user}
	if user.SchoolID == nil || *user.SchoolID == "" {
		return resp
	}
	var school models.School
	if err := database.DB.First(&school, "id = ?", *user.SchoolID).Error; err == nil {
		resp.SchoolCode = &school.Code
		resp.SchoolName = &school.Name
	}
	return resp
}

// LoginResponse
type LoginResponse struct {
	Token              string              `json:"token"`
	User               UserProfileResponse `json:"user"`
	MustChangePassword bool                `json:"must_change_password"`
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

		// 2. Si pas trouvé, essayer le code école (login directeur OU
		//    enseignant par code établissement — Task 25 : chacun via
		//    le code école dédié à SON école).
		if result.Error != nil {
			var school models.School
			// Normalisation : les codes écoles sont stockés en MAJUSCULES
			// (format officiel : lettre E + chiffres, ex : E001103) — la
			// saisie en minuscules est acceptée.
			if err := database.DB.Where("code = ?", strings.ToUpper(req.Identifier)).First(&school).Error; err != nil {
				// Ni email, ni téléphone, ni code école → identifiants invalides
				middleware.JSONError(w, "identifiants invalides", http.StatusUnauthorized)
				return
			}
			// École trouvée → candidats = directeur + enseignants de
			// CETTE école. Le mot de passe (standard = numéro de
			// téléphone, unique par utilisateur) désigne le compte.
			var candidates []models.User
			if err := database.DB.Where(
				"school_id = ? AND role IN ?",
				school.ID,
				[]string{models.RoleDirector, models.RoleTeacher},
			).Find(&candidates).Error; err != nil || len(candidates) == 0 {
				middleware.JSONError(w, "aucun utilisateur rattaché à cette école", http.StatusUnauthorized)
				return
			}
			// Priorité au directeur (comportement historique), puis
			// aux enseignants : le premier dont le mot de passe
			// correspond est authentifié.
			matched := -1
			for pass := 0; pass < 2 && matched < 0; pass++ {
				wantRole := models.RoleTeacher
				if pass == 0 {
					wantRole = models.RoleDirector
				}
				for _, u := range candidates {
					if u.Role != wantRole {
						continue
					}
					if err := utils.CheckPassword(req.Password, u.Password); err == nil {
						matched = 1
						user = u
						break
					}
				}
			}
			if matched < 0 {
				middleware.JSONError(w, "identifiants invalides", http.StatusUnauthorized)
				return
			}
			// Utilisateur trouvé → continuer le flow (active check ci-dessous)
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

		// === Architecture D — audit login ===
		// Note : on ne peut pas utiliser LogAction(r, ...) car à ce stade
		// le contexte de la requête ne contient pas encore l'utilisateur
		// (le middleware Auth n'a pas tourné — c'est une route publique).
		// On insère directement l'AuditLog.
		uid := user.ID
		ip := getClientIP(r)
		ua := r.UserAgent()
		_ = database.DB.Create(&models.AuditLog{
			ActorID:    &uid,
			ActorRole:  user.Role,
			Action:     "auth.login",
			EntityType: "user",
			EntityID:   &uid,
			Details:    `{"method":"email_or_phone_or_school_code"}`,
			IP:         ip,
			UserAgent:  ua,
		}).Error

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(LoginResponse{
			Token:              token,
			User:               enrichUserWithSchool(user),
			MustChangePassword: user.MustChangePassword,
		})
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
	// Task 30 — profil enrichi : school_code + school_name (affichage du
	// code école en haut à droite des pages Directeur / Enseignant).
	json.NewEncoder(w).Encode(enrichUserWithSchool(user))
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
