package middleware

import (
	"context"
	"net/http"
	"strings"

	"sygren-api/config"
	"sygren-api/utils"
)

// ctxKey is an unexported type for context keys to avoid collisions.
type ctxKey string

const (
	// CtxUserID stores the authenticated user ID in the request context.
	CtxUserID ctxKey = "user_id"
	// CtxRole stores the authenticated user's role.
	CtxRole ctxKey = "role"
	// CtxSchoolID stores the authenticated user's school scope (if any).
	CtxSchoolID ctxKey = "school_id"
	// CtxIEPID stores the authenticated user's IEP scope (if any).
	CtxIEPID ctxKey = "iep_id"
)

// JSONError writes a JSON error response.
func JSONError(w http.ResponseWriter, message string, code int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	w.Write([]byte(`{"error":"` + message + `"}`))
}

// Auth verifies the JWT token and loads the user identity into the context.
func Auth(cfg *config.Config) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			authHeader := r.Header.Get("Authorization")
			if authHeader == "" {
				JSONError(w, "token d'authentification manquant", http.StatusUnauthorized)
				return
			}

			claims, err := utils.ParseToken(cfg.JWTSecret, authHeader)
			if err != nil {
				JSONError(w, "token invalide ou expiré", http.StatusUnauthorized)
				return
			}

			ctx := r.Context()
			ctx = context.WithValue(ctx, CtxUserID, claims.UserID)
			ctx = context.WithValue(ctx, CtxRole, claims.Role)
			if claims.SchoolID != "" {
				ctx = context.WithValue(ctx, CtxSchoolID, claims.SchoolID)
			}
			if claims.IEPID != "" {
				ctx = context.WithValue(ctx, CtxIEPID, claims.IEPID)
			}

			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// RequireRole returns middleware that allows only the given roles.
// This is the core of the RBAC system (cahier des charges §2).
func RequireRole(roles ...string) func(http.Handler) http.Handler {
	allowed := make(map[string]bool, len(roles))
	for _, r := range roles {
		allowed[r] = true
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			role, ok := r.Context().Value(CtxRole).(string)
			if !ok || role == "" {
				JSONError(w, "rôle non authentifié", http.StatusUnauthorized)
				return
			}
			if !allowed[role] {
				JSONError(w, "accès refusé : permissions insuffisantes", http.StatusForbidden)
				return
			}
			next.ServeHTTP(w, r.WithContext(r.Context()))
		})
	}
}

// CORSMiddleware allows the Next.js frontend (port 3000) to call the Go API (port 8080).
// In production, restrict to the real frontend origin.
func CORSMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" {
			w.Header().Set("Access-Control-Allow-Origin", origin)
		}
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Transform-Port")
		w.Header().Set("Access-Control-Allow-Credentials", "true")
		w.Header().Set("Access-Control-Max-Age", "86400")

		// Preflight
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		// Strip the gateway's port query param header if present
		_ = strings.TrimSpace

		next.ServeHTTP(w, r)
	})
}
