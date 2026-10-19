package handlers

import (
	"net/http"
	"time"

	"sygren-api/database"
	"sygren-api/middleware"
	"sygren-api/models"
)

// === CONTRÔLE ADMIN DES MOTS DE PASSE (demande utilisateur) ===
//
// « désormais faire apparaître les mots de passe changés par les
// directeurs et des adjoints aux directeurs pour mieux contrôler leur
// travail » — chaque définition d'un mot de passe (création — standard
// téléphone, changement volontaire « Modifier votre mot de passe »,
// réinitialisation admin / lien) maintient la copie en clair
// users.password_visible via models.User.SetPassword. Cet endpoint
// l'expose au SUPER ADMIN seul (module "users-admin"), pour le personnel
// des écoles : DIRECTEURS et ADJOINTS AU DIRECTEUR / ENSEIGNANTS.
//
// Copie NULL = mot de passe personnalisé inconnu de l'administration
// (défini avant cette fonctionnalité et non conforme au standard) : il
// apparaîtra dès la prochaine définition du mot de passe, ou sera ramené
// au standard téléphone via la réinitialisation (option « standard »).
//
// GET /api/users/passwords — module "users-admin" (read).

type userPasswordRow struct {
	ID                 string     `json:"id"`
	FullName           string     `json:"full_name"`
	Role               string     `json:"role"`
	Fonction           *string    `json:"fonction,omitempty"`
	Phone              *string    `json:"phone,omitempty"`
	SchoolID           *string    `json:"school_id,omitempty"`
	SchoolName         *string    `json:"school_name,omitempty"`
	SchoolCode         *string    `json:"school_code,omitempty"`
	Cours              *string    `json:"cours,omitempty"`
	PasswordVisible    *string    `json:"password_visible,omitempty"`
	PasswordChangedAt  *time.Time `json:"password_changed_at,omitempty"`
	MustChangePassword bool       `json:"must_change_password"`
	Active             bool       `json:"active"`
}

// ListUserPasswords liste le personnel des écoles (directeurs + adjoints
// au directeur / enseignants, soft-deleted exclus) avec le mot de passe
// EN CLAIR courant et sa date de définition.
func ListUserPasswords(w http.ResponseWriter, r *http.Request) {
	var users []models.User
	if err := database.DB.
		Where("role IN ?", []string{models.RoleDirector, models.RoleTeacher}).
		Order("full_name ASC").
		Find(&users).Error; err != nil {
		middleware.JSONError(w, "erreur récupération utilisateurs: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Écoles (nom + code) — une requête, une map.
	type schoolRef struct{ Name, Code string }
	schools := make(map[string]schoolRef)
	var schoolRows []models.School
	if err := database.DB.Select("id", "name", "code").Find(&schoolRows).Error; err == nil {
		for _, s := range schoolRows {
			schools[s.ID] = schoolRef{Name: s.Name, Code: s.Code}
		}
	}

	out := make([]userPasswordRow, 0, len(users))
	visibleCount := 0
	for _, u := range users {
		row := userPasswordRow{
			ID:                 u.ID,
			FullName:           u.FullName,
			Role:               u.Role,
			Fonction:           u.Fonction,
			Phone:              u.Phone,
			SchoolID:           u.SchoolID,
			Cours:              u.Cours,
			PasswordVisible:    u.PasswordVisible,
			PasswordChangedAt:  u.PasswordChangedAt,
			MustChangePassword: u.MustChangePassword,
			Active:             u.Active,
		}
		if row.PasswordVisible != nil && *row.PasswordVisible != "" {
			visibleCount++
		}
		if u.SchoolID != nil {
			if s, ok := schools[*u.SchoolID]; ok {
				n, c := s.Name, s.Code
				row.SchoolName = &n
				row.SchoolCode = &c
			}
		}
		out = append(out, row)
	}

	// Audit : consultation sensible — tracée (sans aucun mot de passe).
	LogAction(r, "users.passwords_viewed", "user", nil, map[string]interface{}{
		"count":   len(out),
		"visible": visibleCount,
	})

	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"users":         out,
		"count":         len(out),
		"visible_count": visibleCount,
	})
}
