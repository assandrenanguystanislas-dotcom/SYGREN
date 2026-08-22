package handlers

import (
	"encoding/json"
	"net/http"
	"time"

	"sygren-api/database"
	"sygren-api/middleware"
	"sygren-api/models"
)

// === Architecture D — Journal d'audit ===
//
// LogAction enregistre une entrée d'audit. Append-only. Ne lève jamais d'erreur
// visible (l'échec d'audit ne doit pas bloquer l'opération métier — on log
// l'erreur côté serveur et on continue).
//
// Usage :
//   defer LogAction(r, "user.suspend", "user", &targetID, map[string]interface{}{
//       "before": before, "after": after, "reason": reason,
//   })

// LogAction crée une entrée dans le journal d'audit.
// L'acteur (user_id, role) est extrait du contexte de la requête.
func LogAction(r *http.Request, action, entityType string, entityID *string, details interface{}) {
	uid := ctxUserID(r)
	role := ctxRole(r)

	var detailsJSON string
	if details != nil {
		if b, err := json.Marshal(details); err == nil {
			detailsJSON = string(b)
		}
	}

	ip := getClientIP(r)
	ua := r.UserAgent()

	entry := models.AuditLog{
		ActorID:    strPtrOrNil(uid),
		ActorRole:  role,
		Action:     action,
		EntityType: entityType,
		EntityID:   entityID,
		Details:    detailsJSON,
		IP:         ip,
		UserAgent:  ua,
	}

	// Best-effort write — never fail the request on audit error
	if err := database.DB.Create(&entry).Error; err != nil {
		// Log to server stderr via println (no log import to avoid cycle)
		println("[audit] failed to write:", err.Error(), "action:", action)
	}
}

// strPtrOrNil retourne un *string non-nil si s est non vide, sinon nil.
func strPtrOrNil(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// getClientIP extrait l'IP du client (best-effort).
func getClientIP(r *http.Request) string {
	if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" {
		// Take the first IP in the chain (before the first comma)
		for i, c := range fwd {
			if c == ',' {
				return fwd[:i]
			}
		}
		return fwd
	}
	if real := r.Header.Get("X-Real-IP"); real != "" {
		return real
	}
	return r.RemoteAddr
}

// === GET /api/audit-logs ===
// Liste les entrées du journal avec filtres optionnels + pagination.
//
// Query params:
//   action       — filter by action (e.g., "user.suspend")
//   entity_type  — filter by entity type ("user", "permission", "session")
//   actor_id     — filter by actor user ID
//   target_id    — filter by target user ID
//   from         — ISO date (inclusive)
//   to           — ISO date (inclusive)
//   page         — page number (default 1)
//   pageSize     — page size (default 50, max 200)

type auditLogRow struct {
	ID         string    `json:"id"`
	ActorID    *string   `json:"actor_id,omitempty"`
	ActorRole  string    `json:"actor_role"`
	ActorName  string    `json:"actor_name,omitempty"`
	ActorEmail string    `json:"actor_email,omitempty"`
	Action     string    `json:"action"`
	EntityType string    `json:"entity_type"`
	EntityID   *string   `json:"entity_id,omitempty"`
	Details    string    `json:"details,omitempty"`
	IP         string    `json:"ip,omitempty"`
	UserAgent  string    `json:"user_agent,omitempty"`
	CreatedAt  time.Time `json:"created_at"`
}

func ListAuditLogs(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()

	// Build WHERE clause dynamically
	where := "1=1"
	args := []interface{}{}

	if v := q.Get("action"); v != "" {
		where += " AND action = ?"
		args = append(args, v)
	}
	if v := q.Get("entity_type"); v != "" {
		where += " AND entity_type = ?"
		args = append(args, v)
	}
	if v := q.Get("actor_id"); v != "" {
		where += " AND actor_id = ?"
		args = append(args, v)
	}
	if v := q.Get("target_id"); v != "" {
		where += " AND entity_id = ?"
		args = append(args, v)
	}
	if v := q.Get("from"); v != "" {
		if t, err := time.Parse(time.RFC3339, v); err == nil {
			where += " AND created_at >= ?"
			args = append(args, t)
		}
	}
	if v := q.Get("to"); v != "" {
		if t, err := time.Parse(time.RFC3339, v); err == nil {
			where += " AND created_at <= ?"
			args = append(args, t)
		}
	}

	// Pagination
	p := readQueryPagination(r)
	if p.PageSize > 200 {
		p.PageSize = 200
	}

	// Total count
	var total int64
	if err := database.DB.Model(&models.AuditLog{}).Where(where, args...).Count(&total).Error; err != nil {
		middleware.JSONError(w, "erreur comptage audit logs: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Fetch logs (raw SQL with LEFT JOIN to get actor name/email)
	query := `
		SELECT a.id, a.actor_id, a.actor_role,
		       COALESCE(u.full_name, '') AS actor_name,
		       COALESCE(u.email, '') AS actor_email,
		       a.action, a.entity_type, a.entity_id, a.details,
		       a.ip, a.user_agent, a.created_at
		FROM audit_logs a
		LEFT JOIN users u ON u.id = a.actor_id
		WHERE ` + where + `
		ORDER BY a.created_at DESC
		LIMIT ? OFFSET ?
	`
	argsWithPaging := append(args, p.PageSize, p.Offset)

	type dbRow struct {
		ID         string    `gorm:"column:id" json:"id"`
		ActorID    *string   `gorm:"column:actor_id" json:"actor_id,omitempty"`
		ActorRole  string    `gorm:"column:actor_role" json:"actor_role"`
		ActorName  string    `gorm:"column:actor_name" json:"actor_name,omitempty"`
		ActorEmail string    `gorm:"column:actor_email" json:"actor_email,omitempty"`
		Action     string    `gorm:"column:action" json:"action"`
		EntityType string    `gorm:"column:entity_type" json:"entity_type"`
		EntityID   *string   `gorm:"column:entity_id" json:"entity_id,omitempty"`
		Details    string    `gorm:"column:details" json:"details,omitempty"`
		IP         string    `gorm:"column:ip" json:"ip,omitempty"`
		UserAgent  string    `gorm:"column:user_agent" json:"user_agent,omitempty"`
		CreatedAt  time.Time `gorm:"column:created_at" json:"created_at"`
	}

	var rows []dbRow
	if err := database.DB.Raw(query, argsWithPaging...).Scan(&rows).Error; err != nil {
		middleware.JSONError(w, "erreur récupération audit logs: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Convert to response
	out := make([]auditLogRow, 0, len(rows))
	for _, r := range rows {
		out = append(out, auditLogRow(r))
	}

	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"logs":     out,
		"total":    total,
		"page":     p.Page,
		"pageSize": p.PageSize,
		"pages":    (total + int64(p.PageSize) - 1) / int64(p.PageSize),
	})
}
