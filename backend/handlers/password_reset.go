package handlers

import (
	"encoding/json"
	"fmt"
	"math/rand"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"sygren-api/database"
	"sygren-api/middleware"
	"sygren-api/models"
	"sygren-api/utils"
)

// === Reset Password — Demandes de réinitialisation ===
//
// Workflow :
//   1. User (non authentifié) soumet une demande (identifier + role_hint).
//   2. Admin voit les demandes pending → approve (option 1: temp password,
//      option 2: reset link) OU reject.
//   3. User change son mot de passe (option 1: login avec temp password →
//      doit changer ; option 2: reset link avec token).

// --- Types ---

type ResetRequestInput struct {
	Identifier string `json:"identifier"` // email, téléphone, ou code école
	RoleHint   string `json:"role_hint"`  // "admin" | "inspector" | "director" | "teacher"
	Message    string `json:"message"`    // optionnel
}

type ApproveRequestInput struct {
	Method string `json:"method"` // "temp_password" | "reset_link"
	Note   string `json:"note"`   // optionnel
}

type RejectRequestInput struct {
	Note string `json:"note"`
}

type ChangePasswordInput struct {
	CurrentPassword string `json:"current_password"`
	NewPassword     string `json:"new_password"`
}

type ResetPasswordWithTokenInput struct {
	Token       string `json:"token"`
	NewPassword string `json:"new_password"`
}

// --- Helpers ---

// resolveUserByIdentifier trouve un user par email, téléphone, ou code école.
// Même logique que Login : email/phone d'abord, puis code école → director.
func resolveUserByIdentifier(identifier string) (*models.User, error) {
	var user models.User
	result := database.DB.Where("phone = ? OR email = ?", identifier, identifier).First(&user)
	if result.Error != nil {
		// Essayer code école → director
		var school models.School
		if err := database.DB.Where("code = ?", identifier).First(&school).Error; err == nil {
			if err := database.DB.Where("school_id = ? AND role = ?", school.ID, models.RoleDirector).First(&user).Error; err == nil {
				return &user, nil
			}
		}
		return nil, fmt.Errorf("user non trouvé")
	}
	return &user, nil
}

// generateTempPassword génère un mot de passe simple et mémorisable.
// Format : "SYGREN" + 4 chiffres aléatoires (ex: SYGREN4827).
func generateTempPassword() string {
	r := rand.New(rand.NewSource(time.Now().UnixNano()))
	return fmt.Sprintf("SYGREN%04d", r.Intn(10000))
}

// --- Endpoints ---

// ResetRequest (PUBLIC) — user soumet une demande de réinitialisation.
// POST /api/auth/reset-request
func ResetRequest(w http.ResponseWriter, r *http.Request) {
	var req ResetRequestInput
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		middleware.JSONError(w, "payload invalide", http.StatusBadRequest)
		return
	}
	if req.Identifier == "" {
		middleware.JSONError(w, "identifiant requis", http.StatusBadRequest)
		return
	}

	// Tenter de résoudre l'utilisateur (pour pré-remplir user_id + user_name).
	var userID *string
	var userName string
	if user, err := resolveUserByIdentifier(req.Identifier); err == nil {
		uid := user.ID
		userID = &uid
		userName = user.FullName
	}

	// Créer la demande (même si l'user n'est pas trouvé — l'admin enquêtera).
	resetReq := models.PasswordResetRequest{
		Identifier: req.Identifier,
		RoleHint:   req.RoleHint,
		UserID:     userID,
		UserName:   userName,
		Message:    strings.TrimSpace(req.Message),
		Status:     "pending",
	}
	if err := database.DB.Create(&resetReq).Error; err != nil {
		middleware.JSONError(w, "erreur création demande: "+err.Error(), http.StatusInternalServerError)
		return
	}

	jsonResponse(w, http.StatusCreated, map[string]interface{}{
		"status":  "pending",
		"message": "Demande envoyée. L'administrateur va traiter votre demande.",
		"id":      resetReq.ID,
	})
}

// ListResetRequests (ADMIN) — liste les demandes (pending par défaut).
// GET /api/auth/reset-requests?status=pending|approved|rejected|all
func ListResetRequests(w http.ResponseWriter, r *http.Request) {
	status := r.URL.Query().Get("status")
	if status == "" {
		status = "pending"
	}
	query := database.DB.Model(&models.PasswordResetRequest{}).Order("created_at DESC")
	if status != "all" {
		query = query.Where("status = ?", status)
	}
	var requests []models.PasswordResetRequest
	query.Find(&requests)
	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"requests": requests,
		"count":    len(requests),
	})
}

// ApproveResetRequest (ADMIN) — admin valide une demande.
// POST /api/auth/reset-requests/{id}/approve
// Body: { "method": "temp_password" | "reset_link", "note": "..." }
func ApproveResetRequest(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req ApproveRequestInput
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		middleware.JSONError(w, "payload invalide", http.StatusBadRequest)
		return
	}
	if req.Method != "temp_password" && req.Method != "reset_link" {
		middleware.JSONError(w, "method doit être 'temp_password' ou 'reset_link'", http.StatusBadRequest)
		return
	}

	// Charger la demande
	var resetReq models.PasswordResetRequest
	if err := database.DB.First(&resetReq, "id = ?", id).Error; err != nil {
		middleware.JSONError(w, "demande introuvable", http.StatusNotFound)
		return
	}
	if resetReq.Status != "pending" {
		middleware.JSONError(w, "demande déjà traitée (statut: "+resetReq.Status+")", http.StatusConflict)
		return
	}

	// Résoudre l'user (si pas déjà résolu)
	var user models.User
	if resetReq.UserID != nil {
		database.DB.First(&user, "id = ?", *resetReq.UserID)
	} else {
		u, err := resolveUserByIdentifier(resetReq.Identifier)
		if err != nil {
			middleware.JSONError(w, "user non trouvé pour cet identifiant", http.StatusNotFound)
			return
		}
		user = *u
		uid := user.ID
		resetReq.UserID = &uid
		resetReq.UserName = user.FullName
	}

	now := time.Now()
	adminID := ctxUserID(r)
	resetReq.Status = "approved"
	resetReq.ResolvedAt = &now
	resetReq.ResolvedBy = &adminID
	resetReq.AdminNote = strings.TrimSpace(req.Note)

	if req.Method == "temp_password" {
		// Option 1 : générer un mdp temporaire simple
		tempPwd := generateTempPassword()
		hash, err := utils.HashPassword(tempPwd)
		if err != nil {
			middleware.JSONError(w, "erreur hash mot de passe", http.StatusInternalServerError)
			return
		}
		user.Password = hash
		user.MustChangePassword = true
		database.DB.Save(&user)
		resetReq.TempPassword = &tempPwd
		_ = database.DB.Save(&resetReq)

		jsonResponse(w, http.StatusOK, map[string]interface{}{
			"status":        "approved",
			"method":        "temp_password",
			"temp_password": tempPwd, // retourné à l'admin (qui le communique au user)
			"user_name":     user.FullName,
			"message":       "Mot de passe temporaire généré. Communiquez-le à l'utilisateur. Il devra le changer à la première connexion.",
		})
	} else {
		// Option 2 : générer un reset link avec token
		token := uuid.NewString()
		resetReq.ResetToken = &token
		_ = database.DB.Save(&resetReq)

		resetLink := fmt.Sprintf("https://sygren.vercel.app/reset?token=%s", token)
		jsonResponse(w, http.StatusOK, map[string]interface{}{
			"status":     "approved",
			"method":     "reset_link",
			"reset_link": resetLink,
			"token":      token,
			"user_name":  user.FullName,
			"message":    "Lien de réinitialisation généré. Copiez-le et partagez-le avec l'utilisateur.",
		})
	}
}

// RejectResetRequest (ADMIN) — admin rejette une demande.
// POST /api/auth/reset-requests/{id}/reject
func RejectResetRequest(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req RejectRequestInput
	_ = json.NewDecoder(r.Body).Decode(&req)

	var resetReq models.PasswordResetRequest
	if err := database.DB.First(&resetReq, "id = ?", id).Error; err != nil {
		middleware.JSONError(w, "demande introuvable", http.StatusNotFound)
		return
	}
	if resetReq.Status != "pending" {
		middleware.JSONError(w, "demande déjà traitée", http.StatusConflict)
		return
	}

	now := time.Now()
	adminID := ctxUserID(r)
	resetReq.Status = "rejected"
	resetReq.ResolvedAt = &now
	resetReq.ResolvedBy = &adminID
	resetReq.AdminNote = strings.TrimSpace(req.Note)
	database.DB.Save(&resetReq)

	jsonResponse(w, http.StatusOK, map[string]string{"status": "rejected"})
}

// ChangePassword (AUTH) — user change son mot de passe (première connexion ou volontaire).
// POST /api/auth/change-password
// Body: { "current_password": "...", "new_password": "..." }
func ChangePassword(w http.ResponseWriter, r *http.Request) {
	var req ChangePasswordInput
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		middleware.JSONError(w, "payload invalide", http.StatusBadRequest)
		return
	}
	if req.NewPassword == "" || len(req.NewPassword) < 6 {
		middleware.JSONError(w, "nouveau mot de passe requis (6 caractères minimum)", http.StatusBadRequest)
		return
	}

	userID := ctxUserID(r)
	var user models.User
	if err := database.DB.First(&user, "id = ?", userID).Error; err != nil {
		middleware.JSONError(w, "user introuvable", http.StatusNotFound)
		return
	}

	// Vérifier le mot de passe courant
	if err := utils.CheckPassword(req.CurrentPassword, user.Password); err != nil {
		middleware.JSONError(w, "mot de passe actuel incorrect", http.StatusUnauthorized)
		return
	}

	// Hasher + sauvegarder le nouveau
	hash, err := utils.HashPassword(req.NewPassword)
	if err != nil {
		middleware.JSONError(w, "erreur hash mot de passe", http.StatusInternalServerError)
		return
	}
	user.Password = hash
	user.MustChangePassword = false
	database.DB.Save(&user)

	// Task 25 — audit : changement de mot de passe volontaire
	// (action « Modifier votre mot de passe ») ou première connexion.
	uid := user.ID
	LogAction(r, "auth.password_changed", "user", &uid, map[string]string{
		"method": "self_change",
	})

	jsonResponse(w, http.StatusOK, map[string]string{"status": "changed"})
}

// ResetPasswordWithToken (PUBLIC) — user réinitialise son mdp via un reset link.
// POST /api/auth/reset-password
// Body: { "token": "...", "new_password": "..." }
func ResetPasswordWithToken(w http.ResponseWriter, r *http.Request) {
	var req ResetPasswordWithTokenInput
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		middleware.JSONError(w, "payload invalide", http.StatusBadRequest)
		return
	}
	if req.Token == "" || req.NewPassword == "" || len(req.NewPassword) < 6 {
		middleware.JSONError(w, "token et nouveau mot de passe requis (6 caractères minimum)", http.StatusBadRequest)
		return
	}

	// Trouver la demande par reset_token
	var resetReq models.PasswordResetRequest
	if err := database.DB.Where("reset_token = ?", req.Token).First(&resetReq).Error; err != nil {
		middleware.JSONError(w, "token invalide ou expiré", http.StatusUnauthorized)
		return
	}
	if resetReq.Status != "approved" {
		middleware.JSONError(w, "demande non approuvée", http.StatusForbidden)
		return
	}
	if resetReq.UserID == nil {
		middleware.JSONError(w, "aucun utilisateur associé à ce token", http.StatusBadRequest)
		return
	}

	// Mettre à jour le mot de passe de l'utilisateur
	var user models.User
	if err := database.DB.First(&user, "id = ?", *resetReq.UserID).Error; err != nil {
		middleware.JSONError(w, "user introuvable", http.StatusNotFound)
		return
	}
	hash, err := utils.HashPassword(req.NewPassword)
	if err != nil {
		middleware.JSONError(w, "erreur hash", http.StatusInternalServerError)
		return
	}
	user.Password = hash
	user.MustChangePassword = false
	database.DB.Save(&user)

	// Marquer la demande comme utilisée (reset_token consommé)
	resetReq.ResetToken = nil
	database.DB.Save(&resetReq)

	jsonResponse(w, http.StatusOK, map[string]string{"status": "changed"})
}
