package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"sygren-api/middleware"
)

// jsonResponse writes a JSON response with the given status code.
func jsonResponse(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}

// readQueryPagination extracts page & pageSize from query string.
// Defaults: page=1, pageSize=20. Max pageSize=100.
type Pagination struct {
	Page     int
	PageSize int
	Offset   int
}

func readQueryPagination(r *http.Request) Pagination {
	p := Pagination{Page: 1, PageSize: 20}
	if v := r.URL.Query().Get("page"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			p.Page = n
		}
	}
	if v := r.URL.Query().Get("pageSize"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 100 {
			p.PageSize = n
		}
	}
	p.Offset = (p.Page - 1) * p.PageSize
	return p
}

// ctxUserID extracts the authenticated user ID from the request context.
func ctxUserID(r *http.Request) string {
	if v, ok := r.Context().Value(middleware.CtxUserID).(string); ok {
		return v
	}
	return ""
}

// ctxRole extracts the authenticated user's role.
func ctxRole(r *http.Request) string {
	if v, ok := r.Context().Value(middleware.CtxRole).(string); ok {
		return v
	}
	return ""
}

// ctxSchoolID extracts the school scope (director/teacher).
func ctxSchoolID(r *http.Request) string {
	if v, ok := r.Context().Value(middleware.CtxSchoolID).(string); ok {
		return v
	}
	return ""
}

// ctxIEPID extracts the IEP scope (inspector).
func ctxIEPID(r *http.Request) string {
	if v, ok := r.Context().Value(middleware.CtxIEPID).(string); ok {
		return v
	}
	return ""
}

// matriculeOrNA retourne la valeur du matricule s'il est non nil,
// sinon "N/A". Utilisé pour les réponses JSON destinées à l'affichage.
func matriculeOrNA(m *string) string {
	if m == nil || strings.TrimSpace(*m) == "" {
		return "N/A"
	}
	return *m
}
