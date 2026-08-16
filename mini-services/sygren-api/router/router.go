package router

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"sygren-api/config"
	"sygren-api/handlers"
	"sygren-api/middleware"
)

// New builds the main HTTP router with all SYGREN routes.
// Structure mirrors the cahier des charges modules:
//   /api/auth          → authentification (§4.1)
//   /api/iep           → gestion des IEP (Super-Admin)
//   /api/schools       → gestion des écoles (Module 1)
//   /api/classes       → gestion des classes (Module 1)
//   /api/students      → gestion des élèves (Module 1)
//   /api/teachers      → gestion des enseignants (Module 1)
//   /api/subjects       → gestion des matières (Module 1)
//   /api/sessions       → sessions de saisie mensuelle (Module 2)
//   /api/grades         → saisie des notes (Module 2)
//   /api/computation    → calculs moyennes + classement (Module 3)
//   /api/report-cards   → bulletins PDF (Module 4)
//   /api/dashboard      → tableaux de bord (Module 5)
//   /api/me             → profil utilisateur connecté
func New(cfg *config.Config) http.Handler {
	r := chi.NewRouter()

	// Global middleware
	r.Use(middleware.CORSMiddleware)
	r.Use(RequestLogger)

	// Public routes
	r.Get("/api/health", handlers.Health)
	r.Post("/api/auth/login", handlers.Login(cfg))

	// Authenticated routes
	r.Group(func(r chi.Router) {
		r.Use(middleware.Auth(cfg))

		r.Get("/api/me", handlers.Me)

		// === Phase 1 stubs — seront implémentés dans les phases suivantes ===
		// Pour l'instant, seules les routes d'auth et de santé sont actives.
		// Les handlers CRUD seront ajoutés phase par phase.

		// Stub: renvoie 501 Not Implemented pour signaler les routes à venir
		notImpl := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			middleware.JSONError(w, "endpoint en cours d'implémentation", http.StatusNotImplemented)
		})

		// Module 1 — Gestion Administrative
		r.Get("/api/iep", notImpl)                    // liste IEP (admin)
		r.Get("/api/schools", notImpl)                // liste écoles
		r.Get("/api/classes", notImpl)                // liste classes
		r.Get("/api/students", notImpl)               // liste élèves
		r.Get("/api/teachers", notImpl)               // liste enseignants
		r.Get("/api/subjects", handlers.ListSubjects) // liste matières (déjà fonctionnel)

		// Modules 2-5 stubs
		r.Get("/api/sessions", notImpl)
		r.Get("/api/grades", notImpl)
		r.Get("/api/dashboard", notImpl)
		r.Get("/api/report-cards", notImpl)
	})

	return r
}

// RequestLogger logs each incoming request (dev only).
func RequestLogger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Comment out for quieter logs in production
		// log.Printf("[%s] %s %s", r.Method, r.URL.Path, r.URL.Query().Get("XTransformPort"))
		next.ServeHTTP(w, r)
	})
}
