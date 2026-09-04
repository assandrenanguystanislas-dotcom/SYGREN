package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"sygren-api/database"
	"sygren-api/middleware"
	"sygren-api/models"
	"sygren-api/utils"
)

// === Auto-inscription — fin de la phase pilote (Task 26) ===
//
// Jusqu'ici les comptes directeur / enseignant étaient créés par
// l'administration (phase pilote). Désormais les DIRECTEURS et les
// ENSEIGNANTS créent leurs accès EUX-MÊMES à travers l'interface SYGREN
// (écran de connexion → « Créer vos accès ») :
//   - le CODE ÉCOLE désigne l'établissement (chaque rôle sur SON école) ;
//   - le mot de passe STANDARD est le numéro de téléphone (Task 25),
//     modifiable à tout moment via « Modifier votre mot de passe » ;
//   - une fois les accès établis, ils se connectent via l'interface qui
//     leur est dédiée et atterrissent sur le module Utilisateurs
//     (Tasks 23/24 — inchangé).
//
// Route publique : POST /api/auth/register (aucun JWT requis — c'est le
// code école qui sert de garde-fou : il faut connaître le code de SON
// établissement). Les mêmes règles métier que la création administrative
// s'appliquent : 1 directeur actif par école, une école doit avoir un
// directeur pour accueillir des enseignants, unicité du téléphone/email.

// RegisterRequest — payload d'auto-inscription directeur / enseignant.
type RegisterRequest struct {
	Role       string  `json:"role"` // "director" | "teacher"
	SchoolCode string  `json:"school_code"`
	FullName   string  `json:"full_name"`
	Phone      string  `json:"phone"`
	Email      *string `json:"email,omitempty"`
	// Mot de passe optionnel : vide → STANDARD = numéro de téléphone
	// (le compte reste modifiable à tout moment via « Modifier votre
	// mot de passe »).
	Password string `json:"password,omitempty"`
}

// Register crée un compte directeur ou enseignant depuis l'interface
// publique (sans authentification préalable).
func Register(w http.ResponseWriter, r *http.Request) {
	var req RegisterRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		middleware.JSONError(w, "payload invalide", http.StatusBadRequest)
		return
	}

	req.SchoolCode = strings.ToUpper(strings.TrimSpace(req.SchoolCode))
	req.FullName = strings.TrimSpace(req.FullName)
	req.Phone = strings.TrimSpace(req.Phone)

	// 1. Rôle : uniquement directeur ou enseignant (le parent est créé par
	//    l'administration dans le module Utilisateurs ; l'admin/inspecteur
	//    ne s'auto-inscrivent pas).
	if req.Role != models.RoleDirector && req.Role != models.RoleTeacher {
		middleware.JSONError(w, "rôle invalide — l'auto-inscription est réservée aux directeurs et aux enseignants", http.StatusBadRequest)
		return
	}
	// 2. Champs requis
	if req.SchoolCode == "" || req.FullName == "" || req.Phone == "" {
		middleware.JSONError(w, "code école, nom complet et téléphone sont requis", http.StatusBadRequest)
		return
	}
	// Email vide → NULL (évite les conflits d'unicité sur chaîne vide)
	if req.Email != nil && strings.TrimSpace(*req.Email) == "" {
		req.Email = nil
	}

	// 3. Le code école désigne l'établissement (garde-fou de l'auto-inscription)
	var school models.School
	if err := database.DB.Where("code = ?", req.SchoolCode).First(&school).Error; err != nil {
		middleware.JSONError(w,
			"aucun établissement ne correspond au code école saisi — vérifiez la saisie (format : lettre E + chiffres, ex : E001103)",
			http.StatusNotFound)
		return
	}

	// 4. Unicité du téléphone (identifiant de connexion + mot de passe standard)
	var phoneCount int64
	database.DB.Model(&models.User{}).Where("phone = ?", req.Phone).Count(&phoneCount)
	if phoneCount > 0 {
		middleware.JSONError(w, "ce numéro de téléphone est déjà utilisé", http.StatusConflict)
		return
	}
	// Unicité de l'email si fourni
	if req.Email != nil {
		var emailCount int64
		database.DB.Model(&models.User{}).Where("email = ?", *req.Email).Count(&emailCount)
		if emailCount > 0 {
			middleware.JSONError(w, "cet email est déjà utilisé", http.StatusConflict)
			return
		}
	}

	// 5. Mot de passe STANDARD = numéro de téléphone (Task 25/26)
	password := req.Password
	if password == "" {
		password = req.Phone
	}

	// 6. Règles métier identiques à la création administrative
	if req.Role == models.RoleDirector {
		// Relation 1-1 : un directeur ACTIF par école (cf. CreateDirector)
		var existing int64
		database.DB.Model(&models.User{}).
			Where("role = ? AND school_id = ? AND active = ?", models.RoleDirector, school.ID, true).
			Count(&existing)
		if existing > 0 {
			middleware.JSONError(w,
				"cette école a déjà un directeur actif — contactez l'administration si nécessaire",
				http.StatusConflict)
			return
		}
	} else {
		// cf. CreateTeacher : une école doit avoir un directeur rattaché
		// pour accueillir des enseignants
		var directorCount int64
		database.DB.Model(&models.User{}).
			Where("school_id = ? AND role = ?", school.ID, models.RoleDirector).
			Count(&directorCount)
		if directorCount == 0 {
			middleware.JSONError(w,
				"impossible de créer un accès enseignant : cette école n'a pas encore de directeur. "+
					"Le directeur doit d'abord créer ses accès (onglet « Directeur »).",
				http.StatusConflict)
			return
		}
	}

	// 7. Création du compte (actif immédiatement — « les accès établis,
	//    ils pourront se connecter à travers le module Utilisateurs »)
	hashed, err := utils.HashPassword(password)
	if err != nil {
		middleware.JSONError(w, "erreur hashage mot de passe", http.StatusInternalServerError)
		return
	}
	role := req.Role
	user := models.User{
		FullName: req.FullName,
		Phone:    &req.Phone,
		Email:    req.Email,
		Password: hashed,
		Role:     role,
		SchoolID: &school.ID,
		Active:   true,
	}
	if err := database.DB.Create(&user).Error; err != nil {
		middleware.JSONError(w, "erreur création du compte", http.StatusInternalServerError)
		return
	}

	// 8. Audit (route publique — insertion directe, cf. Login)
	uid := user.ID
	ip := getClientIP(r)
	ua := r.UserAgent()
	_ = database.DB.Create(&models.AuditLog{
		ActorID:    &uid,
		ActorRole:  role,
		Action:     "auth.register",
		EntityType: "user",
		EntityID:   &uid,
		Details:    fmt.Sprintf(`{"role":%q,"school_code":%q,"method":"self_registration"}`, role, req.SchoolCode),
		IP:         ip,
		UserAgent:  ua,
	}).Error

	user.Password = ""
	jsonResponse(w, http.StatusCreated, map[string]interface{}{
		"status":  "created",
		"message": "Vos accès sont créés. Connectez-vous avec le code école " + school.Code + " et votre mot de passe (standard : votre numéro de téléphone).",
		"user":    user,
		"school": map[string]string{
			"id":   school.ID,
			"code": school.Code,
			"name": school.Name,
		},
	})
}
