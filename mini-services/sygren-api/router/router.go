package router

import (
        "net/http"

        "github.com/go-chi/chi/v5"

        "sygren-api/config"
        "sygren-api/handlers"
        "sygren-api/middleware"
        "sygren-api/models"
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
//   /api/sessions       → sessions de saisie mensuelle (Module 2 — à venir)
//   /api/grades         → saisie des notes (Module 2 — à venir)
//   /api/dashboard      → tableaux de bord (Module 5 — à venir)
//   /api/me             → profil utilisateur connecté
func New(cfg *config.Config) http.Handler {
        r := chi.NewRouter()

        // Global middleware
        r.Use(middleware.CORSMiddleware)

        // Public routes
        r.Get("/api/health", handlers.Health)
        r.Post("/api/auth/login", handlers.Login(cfg))

        // Authenticated routes
        r.Group(func(r chi.Router) {
                r.Use(middleware.Auth(cfg))

                r.Get("/api/me", handlers.Me)

                // === Module 1 — Gestion Administrative ===

                // IEP — Super-Admin uniquement (cahier des charges §2)
                r.Group(func(r chi.Router) {
                        r.Use(middleware.RequireRole(models.RoleAdmin))
                        r.Get("/api/iep", handlers.ListIEP)
                        r.Post("/api/iep", handlers.CreateIEP)
                        r.Put("/api/iep/{id}", handlers.UpdateIEP)
                        r.Delete("/api/iep/{id}", handlers.DeleteIEP)
                })

                // Écoles — admin (CRUD), inspector (lecture), director/teacher (lecture son école)
                r.Get("/api/schools", handlers.ListSchools)
                r.Group(func(r chi.Router) {
                        r.Use(middleware.RequireRole(models.RoleAdmin))
                        r.Post("/api/schools", handlers.CreateSchool)
                        r.Put("/api/schools/{id}", handlers.UpdateSchool)
                        r.Delete("/api/schools/{id}", handlers.DeleteSchool)
                })

                // Classes — admin+director (CRUD), inspector+teacher (lecture)
                r.Get("/api/classes", handlers.ListClasses)
                r.Group(func(r chi.Router) {
                        r.Use(middleware.RequireRole(models.RoleAdmin, models.RoleDirector))
                        r.Post("/api/classes", handlers.CreateClass)
                        r.Put("/api/classes/{id}", handlers.UpdateClass)
                        r.Delete("/api/classes/{id}", handlers.DeleteClass)
                })

                // Élèves — admin+director (CRUD), inspector+teacher (lecture)
                r.Get("/api/students", handlers.ListStudents)
                r.Group(func(r chi.Router) {
                        r.Use(middleware.RequireRole(models.RoleAdmin, models.RoleDirector))
                        r.Post("/api/students", handlers.CreateStudent)
                        r.Put("/api/students/{id}", handlers.UpdateStudent)
                        r.Delete("/api/students/{id}", handlers.DeleteStudent)
                })

                // Enseignants — admin (CRUD), director (CRUD limité son école), inspector (lecture)
                r.Get("/api/teachers", handlers.ListTeachers)
                r.Group(func(r chi.Router) {
                        r.Use(middleware.RequireRole(models.RoleAdmin, models.RoleDirector))
                        r.Post("/api/teachers", handlers.CreateTeacher)
                        r.Put("/api/teachers/{id}", handlers.UpdateTeacher)
                        r.Delete("/api/teachers/{id}", handlers.DeleteTeacher)
                })

                // Matières — admin (CRUD), director (CRUD), teacher+inspector (lecture)
                r.Get("/api/subjects", handlers.ListSubjects)
                r.Group(func(r chi.Router) {
                        r.Use(middleware.RequireRole(models.RoleAdmin, models.RoleDirector))
                        r.Post("/api/subjects", handlers.CreateSubject)
                        r.Put("/api/subjects/{id}", handlers.UpdateSubject)
                        r.Delete("/api/subjects/{id}", handlers.DeleteSubject)
                })

                // === Modules 2-5 — stubs (à implémenter dans les phases suivantes) ===
                notImpl := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
                        middleware.JSONError(w, "endpoint en cours d'implémentation", http.StatusNotImplemented)
                })

                // === Module 2 — Sessions de saisie mensuelle (cahier des charges §3) ===
                // Lecture : tous les rôles (filtré par scope dans le handler)
                // Création/Modification/Suppression : admin + director
                r.Get("/api/sessions", handlers.ListSessions)
                r.Group(func(r chi.Router) {
                        r.Use(middleware.RequireRole(models.RoleAdmin, models.RoleDirector))
                        r.Post("/api/sessions", handlers.CreateSession)
                        r.Put("/api/sessions/{id}/status", handlers.UpdateSessionStatus)
                        r.Delete("/api/sessions/{id}", handlers.DeleteSession)
                })

                // === Module 2 — Saisie des notes ===
                // Lecture : tous les rôles (filtré par scope dans le handler)
                // Saisie (upsert/bulk/delete) : teacher + director + admin (vérification statut session dans handler)
                r.Get("/api/grades", handlers.ListGrades)
                r.Group(func(r chi.Router) {
                        r.Use(middleware.RequireRole(models.RoleTeacher, models.RoleDirector, models.RoleAdmin))
                        r.Post("/api/grades", handlers.UpsertGrade)
                        r.Post("/api/grades/bulk", handlers.BulkUpsertGrades)
                        r.Delete("/api/grades/{id}", handlers.DeleteGrade)
                })

                // Modules 3-5 — stubs (à implémenter dans les phases suivantes)
                r.Get("/api/dashboard", notImpl)
                r.Get("/api/report-cards", notImpl)
        })

        return r
}
