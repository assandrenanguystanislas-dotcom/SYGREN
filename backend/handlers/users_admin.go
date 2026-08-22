package handlers

import (
	"encoding/json"
	"io"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"sygren-api/database"
	"sygren-api/middleware"
	"sygren-api/models"
)

// === Architecture D — Gestion admin des utilisateurs ===
//
// 3 endpoints pour le module "Utilisateurs" (vue admin) :
//   GET    /api/users               — liste tous les users (sans password)
//   POST   /api/users/{id}/suspend  — suspendre (active=false, suspended_at, reason)
//   POST   /api/users/{id}/reactivate — réactiver (active=true, reset suspension fields)
//
// RBAC : admin seul (RequireModule("users-admin", "read"|"write"))
//
// Garde-fous :
// - Impossible de suspendre son propre compte (self-suspension guard)
// - Impossible de suspendre un super admin (sauf si soi-même super admin — mais
//   on vient de dire qu'on ne peut pas se suspendre soi-même, donc en pratique :
//   seul un autre super admin peut suspendre un super admin).

// === GET /api/users ===
// Liste tous les utilisateurs avec leur rôle et statut de suspension.

type userAdminRow struct {
	ID                 string     `json:"id"`
	FullName           string     `json:"full_name"`
	Email              *string    `json:"email,omitempty"`
	Phone              *string    `json:"phone,omitempty"`
	Role               string     `json:"role"`
	IEPID              *string    `json:"iep_id,omitempty"`
	SchoolID           *string    `json:"school_id,omitempty"`
	Service            string     `json:"service,omitempty"`
	Active             bool       `json:"active"`
	SuspendedAt        *time.Time `json:"suspended_at,omitempty"`
	SuspendedReason    string     `json:"suspended_reason,omitempty"`
	MustChangePassword bool       `json:"must_change_password"`
	CreatedAt          time.Time  `json:"created_at"`
	UpdatedAt          time.Time  `json:"updated_at"`
}

func ListAllUsers(w http.ResponseWriter, r *http.Request) {
	var users []models.User
	// Exclut soft-deleted. Tri : admin d'abord, puis par nom.
	if err := database.DB.Order("role ASC, full_name ASC").Find(&users).Error; err != nil {
		middleware.JSONError(w, "erreur récupération utilisateurs: "+err.Error(), http.StatusInternalServerError)
		return
	}

	out := make([]userAdminRow, 0, len(users))
	for _, u := range users {
		out = append(out, userAdminRow{
			ID:                 u.ID,
			FullName:           u.FullName,
			Email:              u.Email,
			Phone:              u.Phone,
			Role:               u.Role,
			IEPID:              u.IEPID,
			SchoolID:           u.SchoolID,
			Service:            u.Service,
			Active:             u.Active,
			SuspendedAt:        u.SuspendedAt,
			SuspendedReason:    u.SuspendedReason,
			MustChangePassword: u.MustChangePassword,
			CreatedAt:          u.CreatedAt,
			UpdatedAt:          u.UpdatedAt,
		})
	}

	// Also return the list of Admin IEP service suggestions (datalist)
	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"users":              out,
		"admin_iep_services": models.AdminIEPServices(),
	})
}

// === POST /api/users/{id}/suspend ===
// Body : { "reason": "motif optionnel" }

type suspendReq struct {
	Reason string `json:"reason"`
}

func SuspendUser(w http.ResponseWriter, r *http.Request) {
	targetID := chi.URLParam(r, "id")
	if targetID == "" {
		middleware.JSONError(w, "ID utilisateur manquant", http.StatusBadRequest)
		return
	}

	actorID := ctxUserID(r)
	actorRole := ctxRole(r)

	if targetID == actorID {
		middleware.JSONError(w, "vous ne pouvez pas suspendre votre propre compte", http.StatusBadRequest)
		return
	}

	// Find target
	var target models.User
	if err := database.DB.Where("id = ?", targetID).First(&target).Error; err != nil {
		middleware.JSONError(w, "utilisateur introuvable", http.StatusNotFound)
		return
	}

	// Super admin cannot be suspended by non-admin
	if target.Role == models.RoleAdmin && actorRole != models.RoleAdmin {
		middleware.JSONError(w, "seul un super admin peut suspendre un super admin", http.StatusForbidden)
		return
	}

	// Parse body (optional reason)
	var req suspendReq
	if body, err := io.ReadAll(r.Body); err == nil {
		_ = json.Unmarshal(body, &req)
	}
	defer r.Body.Close()

	// Capture "before" snapshot
	before := map[string]interface{}{
		"active":           target.Active,
		"suspended_at":     target.SuspendedAt,
		"suspended_reason": target.SuspendedReason,
	}

	// Apply suspension
	now := time.Now()
	target.Active = false
	target.SuspendedAt = &now
	target.SuspendedByID = &actorID
	target.SuspendedReason = req.Reason

	if err := database.DB.Save(&target).Error; err != nil {
		middleware.JSONError(w, "erreur suspension: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Audit log
	LogAction(r, "user.suspend", "user", &targetID, map[string]interface{}{
		"before": before,
		"after": map[string]interface{}{
			"active":           target.Active,
			"suspended_at":     target.SuspendedAt,
			"suspended_reason": target.SuspendedReason,
		},
		"reason":      req.Reason,
		"target_name": target.FullName,
		"target_role": target.Role,
	})

	// Invalidate dashboard cache (suspension might affect KPIs)
	InvalidateDashboardCache()

	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"ok": true,
		"user": userAdminRow{
			ID:                 target.ID,
			FullName:           target.FullName,
			Email:              target.Email,
			Phone:              target.Phone,
			Role:               target.Role,
			IEPID:              target.IEPID,
			SchoolID:           target.SchoolID,
			Service:            target.Service,
			Active:             target.Active,
			SuspendedAt:        target.SuspendedAt,
			SuspendedReason:    target.SuspendedReason,
			MustChangePassword: target.MustChangePassword,
			CreatedAt:          target.CreatedAt,
			UpdatedAt:          target.UpdatedAt,
		},
	})
}

// === POST /api/users/{id}/reactivate ===
func ReactivateUser(w http.ResponseWriter, r *http.Request) {
	targetID := chi.URLParam(r, "id")
	if targetID == "" {
		middleware.JSONError(w, "ID utilisateur manquant", http.StatusBadRequest)
		return
	}

	var target models.User
	if err := database.DB.Where("id = ?", targetID).First(&target).Error; err != nil {
		middleware.JSONError(w, "utilisateur introuvable", http.StatusNotFound)
		return
	}

	before := map[string]interface{}{
		"active":           target.Active,
		"suspended_at":     target.SuspendedAt,
		"suspended_reason": target.SuspendedReason,
	}

	target.Active = true
	target.SuspendedAt = nil
	target.SuspendedByID = nil
	target.SuspendedReason = ""

	if err := database.DB.Save(&target).Error; err != nil {
		middleware.JSONError(w, "erreur réactivation: "+err.Error(), http.StatusInternalServerError)
		return
	}

	LogAction(r, "user.reactivate", "user", &targetID, map[string]interface{}{
		"before": before,
		"after": map[string]interface{}{
			"active":           target.Active,
			"suspended_at":     target.SuspendedAt,
			"suspended_reason": target.SuspendedReason,
		},
		"target_name": target.FullName,
		"target_role": target.Role,
	})

	InvalidateDashboardCache()

	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"ok": true,
		"user": userAdminRow{
			ID:                 target.ID,
			FullName:           target.FullName,
			Email:              target.Email,
			Phone:              target.Phone,
			Role:               target.Role,
			IEPID:              target.IEPID,
			SchoolID:           target.SchoolID,
			Service:            target.Service,
			Active:             target.Active,
			SuspendedAt:        target.SuspendedAt,
			SuspendedReason:    target.SuspendedReason,
			MustChangePassword: target.MustChangePassword,
			CreatedAt:          target.CreatedAt,
			UpdatedAt:          target.UpdatedAt,
		},
	})
}
