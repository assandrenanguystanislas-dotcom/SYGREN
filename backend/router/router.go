package router

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"sygren-api/config"
	"sygren-api/handlers"
	"sygren-api/middleware"
	"sygren-api/models"
	"sygren-api/storage"
)

// New builds the main HTTP router with all SYGREN routes.
//
// Architecture D — migration du RBAC statique (RequireRole) vers le RBAC
// dynamique (RequireModule). La matrice seedée dans la DB reflète EXACTEMENT
// le comportement RequireRole précédent — aucun changement visible au
// premier déploiement. Le super admin peut ensuite éditer la matrice via
// le module Permissions (UI).
//
// Routes :
//
//	/api/auth          → authentification (§4.1)
//	/api/iep           → gestion des IEP (Super-Admin + Admin IEP)
//	/api/schools       → gestion des écoles (Module 1)
//	/api/classes       → gestion des classes (Module 1)
//	/api/students      → gestion des élèves (Module 1)
//	/api/teachers      → gestion des enseignants (Module 1)
//	/api/subjects      → gestion des matières (Module 1)
//	/api/sessions      → sessions de saisie mensuelle (Module 2)
//	/api/grades        → saisie des notes (Module 2)
//	/api/dashboard     → tableaux de bord (Module 5)
//	/api/me            → profil utilisateur connecté
//
// Architecture D — nouveaux modules :
//
//	/api/permissions   → matrice RBAC (admin only)
//	/api/audit-logs    → journal d'audit (admin only)
//	/api/users         → gestion admin des comptes (suspend/reactivate) (admin only)
//	/api/me/modules    → liste des modules accessibles au user (pour nav dynamique)
func New(cfg *config.Config) http.Handler {
	r := chi.NewRouter()

	// Global middleware
	r.Use(middleware.CORSMiddleware)

	// Fichiers du stockage local (DEV UNIQUEMENT) — service public : même
	// modèle d'accès « qui a l'URL lit le fichier » que les URLs présignées
	// R2. Monté seulement si le stockage local est actif (storage.New est
	// appelé AVANT router.New dans main.go).
	if storage.Global != nil && storage.Global.Kind() == "local" {
		r.Handle("/storage/*", http.StripPrefix("/storage/", http.FileServer(http.Dir(cfg.StoragePath))))
	}

	// Public routes
	r.Get("/api/health", handlers.Health)
	r.Post("/api/auth/login", handlers.Login(cfg))
	r.Post("/api/auth/reset-request", handlers.ResetRequest)
	r.Post("/api/auth/reset-password", handlers.ResetPasswordWithToken)

	// Authenticated routes
	r.Group(func(r chi.Router) {
		r.Use(middleware.Auth(cfg))

		r.Get("/api/me", handlers.Me)
		r.Post("/api/auth/change-password", handlers.ChangePassword)

		// === Architecture D — Modules dynamiques pour le user connecté ===
		// Pas de middleware RequireModule : on renvoie juste la liste filtrée
		// par le rôle. C'est l'endpoint qui alimente la nav frontend.
		r.Get("/api/me/modules", handlers.ListUserModules)

		// === Reset Password — gestion admin des demandes ===
		// Anciennement RequireRole(RoleAdmin) → RequireModule("reset-requests", "write")
		r.Group(func(r chi.Router) {
			r.Use(middleware.RequireModule(models.ModuleResetRequests, "write"))
			r.Get("/api/auth/reset-requests", handlers.ListResetRequests)
			r.Post("/api/auth/reset-requests/{id}/approve", handlers.ApproveResetRequest)
			r.Post("/api/auth/reset-requests/{id}/reject", handlers.RejectResetRequest)
		})

		// === Module 1 — Gestion Administrative ===

		// IEP — admin + inspector (CRUD)
		// Anciennement RequireRole(RoleAdmin, RoleInspector) → RequireModule("iep", "write")
		r.Get("/api/iep", handlers.ListIEP)
		r.Group(func(r chi.Router) {
			r.Use(middleware.RequireModule(models.ModuleIEP, "write"))
			r.Post("/api/iep", handlers.CreateIEP)
			r.Put("/api/iep/{id}", handlers.UpdateIEP)
			r.Delete("/api/iep/{id}", handlers.DeleteIEP)
		})

		// Écoles — lecture ouverte (handler scope), écriture admin + inspector
		r.Get("/api/schools", handlers.ListSchools)
		r.Group(func(r chi.Router) {
			r.Use(middleware.RequireModule(models.ModuleSchools, "write"))
			r.Post("/api/schools", handlers.CreateSchool)
			r.Put("/api/schools/{id}", handlers.UpdateSchool)
			r.Delete("/api/schools/{id}", handlers.DeleteSchool)
			// Logos d'écoles — stockage fichiers (R2 prod / FS dev) ; 503 si
			// le stockage n'est pas configuré (voir handlers/schools.go)
			r.Post("/api/schools/{id}/logo", handlers.UploadSchoolLogo)
			r.Delete("/api/schools/{id}/logo", handlers.DeleteSchoolLogo)
		})

		// Centres d'examen — regroupement des écoles pour les documents
		// officiels du plan IEPP (colonne « CENTRES D'EXAMENS »).
		// Lecture ouverte (scope dans le handler), écriture = mêmes droits
		// que le module Écoles dont le rattachement est l'extension naturelle.
		r.Get("/api/exam-centers", handlers.ListExamCenters)
		r.Group(func(r chi.Router) {
			r.Use(middleware.RequireModule(models.ModuleSchools, "write"))
			r.Post("/api/exam-centers", handlers.CreateExamCenter)
			r.Put("/api/exam-centers/{id}", handlers.UpdateExamCenter)
			r.Delete("/api/exam-centers/{id}", handlers.DeleteExamCenter)
		})

		// Classes — lecture ouverte, écriture admin + inspector + director
		r.Get("/api/classes", handlers.ListClasses)
		r.Group(func(r chi.Router) {
			r.Use(middleware.RequireModule(models.ModuleClasses, "write"))
			r.Post("/api/classes", handlers.CreateClass)
			r.Put("/api/classes/{id}", handlers.UpdateClass)
			r.Delete("/api/classes/{id}", handlers.DeleteClass)
		})

		// Élèves — lecture ouverte.
		// Écriture (créer / importer / supprimer) : admin + inspector +
		// director (matrice RBAC students:write).
		// La MISE À JOUR (PUT) est traitée à part : le tenant du cours
		// (teacher) peut CORRIGER un élève de SA classe (erreur de
		// saisie sur le nom, les prénoms, l'année de naissance…) —
		// contrôle RBAC + scope effet dans le handler UpdateStudent.
		r.Get("/api/students", handlers.ListStudents)
		r.Group(func(r chi.Router) {
			r.Use(middleware.RequireModule(models.ModuleStudents, "write"))
			r.Post("/api/students", handlers.CreateStudent)
			r.Post("/api/students/bulk", handlers.BulkCreateStudents)
			r.Delete("/api/students/{id}", handlers.DeleteStudent)
		})
		r.Put("/api/students/{id}", handlers.UpdateStudent)

		// Enseignants — lecture ouverte, écriture admin + inspector + director
		r.Get("/api/teachers", handlers.ListTeachers)
		r.Group(func(r chi.Router) {
			r.Use(middleware.RequireModule(models.ModuleUsersTeachers, "write"))
			r.Post("/api/teachers", handlers.CreateTeacher)
			r.Put("/api/teachers/{id}", handlers.UpdateTeacher)
			r.Delete("/api/teachers/{id}", handlers.DeleteTeacher)
		})

		// Directeurs d'école — lecture ouverte, écriture admin seulement
		r.Get("/api/directors", handlers.ListDirectors)
		r.Group(func(r chi.Router) {
			r.Use(middleware.RequireModule(models.ModuleUsersDirectors, "write"))
			r.Post("/api/directors", handlers.CreateDirector)
			r.Put("/api/directors/{id}", handlers.UpdateDirector)
			r.Delete("/api/directors/{id}", handlers.DeleteDirector)
		})

		// Admins IEP (inspecteurs) — lecture + écriture admin seulement
		// (lecture fermée car la liste expose des emails pro)
		r.Group(func(r chi.Router) {
			r.Use(middleware.RequireModule(models.ModuleUsersInspectors, "read"))
			r.Get("/api/inspectors", handlers.ListInspectors)
		})
		r.Group(func(r chi.Router) {
			r.Use(middleware.RequireModule(models.ModuleUsersInspectors, "write"))
			r.Post("/api/inspectors", handlers.CreateInspector)
			r.Put("/api/inspectors/{id}", handlers.UpdateInspector)
			r.Delete("/api/inspectors/{id}", handlers.DeleteInspector)
		})

		// Matières — lecture ouverte, écriture admin + inspector + director
		r.Get("/api/subjects", handlers.ListSubjects)
		r.Group(func(r chi.Router) {
			r.Use(middleware.RequireModule(models.ModuleSubjects, "write"))
			r.Post("/api/subjects", handlers.CreateSubject)
			r.Put("/api/subjects/{id}", handlers.UpdateSubject)
			r.Delete("/api/subjects/{id}", handlers.DeleteSubject)
		})

		// === Module 2 — Sessions de saisie mensuelle ===
		r.Get("/api/sessions", handlers.ListSessions)
		r.Group(func(r chi.Router) {
			r.Use(middleware.RequireModule(models.ModuleSessions, "write"))
			r.Post("/api/sessions", handlers.CreateSession)
			r.Post("/api/sessions/bulk", handlers.BulkCreateSessions)
			r.Put("/api/sessions/{id}/status", handlers.UpdateSessionStatus)
			r.Put("/api/sessions/{id}/extend", handlers.ExtendSession)
			r.Put("/api/sessions/{id}/cancel", handlers.CancelSession)
			r.Put("/api/sessions/{id}/archive", handlers.ArchiveSession)
			r.Delete("/api/sessions/{id}", handlers.DeleteSession)
		})

		// === Exemptions de session ===
		r.Get("/api/sessions/{id}/exemptions", handlers.ListExemptions)
		r.Group(func(r chi.Router) {
			r.Use(middleware.RequireModule(models.ModuleSessions, "write"))
			r.Post("/api/sessions/{id}/exemptions", handlers.CreateExemption)
			r.Delete("/api/sessions/{id}/exemptions/{eid}", handlers.DeleteExemption)
		})

		// === Module 2 — Saisie des notes ===
		// Lecture : tous les rôles (scope dans le handler)
		// Saisie (upsert/bulk/delete) : teacher + director + admin + inspector
		r.Get("/api/grades", handlers.ListGrades)
		r.Group(func(r chi.Router) {
			r.Use(middleware.RequireModule(models.ModuleGrades, "write"))
			r.Post("/api/grades", handlers.UpsertGrade)
			r.Post("/api/grades/bulk", handlers.BulkUpsertGrades)
			r.Delete("/api/grades/{id}", handlers.DeleteGrade)
		})

		// === Barèmes de notation ===
		r.Get("/api/grade-scales", handlers.ListGradeScales)
		r.Group(func(r chi.Router) {
			r.Use(middleware.RequireModule(models.ModuleGradeScales, "write"))
			r.Post("/api/grade-scales", handlers.CreateGradeScale)
			r.Put("/api/grade-scales/{id}", handlers.UpdateGradeScale)
			r.Delete("/api/grade-scales/{id}", handlers.DeleteGradeScale)
		})

		// === Module 3 — Traitement mathématique ===
		// Read-only for all authed (RBAC par périmètre dans getSessionForUser)
		r.Get("/api/computation/session/{id}", handlers.GetSessionResults)
		r.Get("/api/computation/student/{id}/annual", handlers.GetStudentAnnualResults)

		// === PDA IEPP — Plan d'Action Pluriannuel (compositions mensuelles
		// + examens blancs CE/CM) ===
		// Reproduction du document officiel « SUIVI DU PLAN D'ACTION
		// PLURIANNUEL DE L'IEPP » : les compositions mensuelles sont dérivées
		// du module Notes (lecture seule), les examens blancs sont saisis
		// manuellement. Lecture : tous les rôles authentifiés (scope par
		// périmètre dans les handlers). Écriture : mêmes droits que la saisie
		// des notes (ModuleGrades — teacher+director+admin+inspector).
		r.Get("/api/pda/exams", handlers.ListPDAExams)
		r.Get("/api/pda/exams/{id}/results", handlers.GetPDAResults)
		r.Get("/api/pda/exams/{id}/remediation", handlers.GetPDARemediation)
		r.Get("/api/pda/exams/{id}/summary", handlers.GetPDASummary)
		r.Get("/api/pda/timeline", handlers.GetPDATimeline)
		// Document réseau « PLAN D'ACTION PLURIANNUEL DE L'IEPP » :
		// toutes les écoles du périmètre pour UNE évaluation
		// (année+numéro+type), groupées par CENTRE D'EXAMEN.
		r.Get("/api/pda/plan-action", handlers.GetPDAPlanAction)
		r.Group(func(r chi.Router) {
			r.Use(middleware.RequireModule(models.ModuleGrades, "write"))
			r.Post("/api/pda/exams", handlers.CreatePDAExam)
			// Rattrapage : abonne les compositions actives non suivies
			// (sessions créées avant l'auto-abonnement). Idempotent.
			r.Post("/api/pda/exams/backfill", handlers.BackfillPDAExams)
			r.Delete("/api/pda/exams/{id}", handlers.DeletePDAExam)
			r.Post("/api/pda/exams/{id}/results", handlers.SavePDAResults)
			r.Put("/api/pda/exams/{id}/remediation", handlers.SavePDARemediation)
		})

		// === Module 4 — Bulletins ===
		// Endpoints de génération PDF retirés (le module est passé 100 % sur
		// l'impression A5 côté navigateur — /bulletins + releve-data/computation).
		// L'entité models.ReportCard et la table report_cards sont conservées
		// (données historiques + rollback possible).

		// === Synthèse + Relevé (données JSON pour rendu HTML frontend) ===
		// RBAC : scope vérifié dans le handler (admin = toutes, director = son école, etc.)
		r.Get("/api/reports/synthese-data", handlers.GetSyntheseData)
		r.Get("/api/reports/releve-data", handlers.GetReleveData)
		r.Get("/api/reports/releve-classes", handlers.ListReleveClasses)
		// Document « ÉTAT NOMINATIF DU PERSONNEL » (module Utilisateurs) :
		// école + IEP + agents (dossier personnel) pour une école.
		r.Get("/api/reports/personnel", handlers.GetPersonnelSheet)
		// Document « RESULTATS DE FIN D'ANNEE » (module Résultats → onglet
		// Fin d'année) : élèves d'une classe avec âge, scolarités (1..10),
		// moyennes (compositions / composition de passage / annuelle),
		// décision du conseil des maîtres (A|R|ABD) + tableau récapitulatif
		// Effectif/Admis/Redoublants (calculés) + Exclus/Abandons (manuels).
		r.Get("/api/reports/end-of-year", handlers.GetEndOfYearSheet)

		// === Module 5 — Tableau de bord analytique ===
		r.Get("/api/dashboard", handlers.GetDashboard)

		// === Paramètres système (admin uniquement) ===
		// Anciennement RequireRole(RoleAdmin) → RequireModule("settings", "read"|"write")
		r.Group(func(r chi.Router) {
			r.Use(middleware.RequireModule(models.ModuleSettings, "read"))
			r.Get("/api/settings", handlers.ListSettings)
			r.Get("/api/settings/{key}", handlers.GetSetting)
		})
		r.Group(func(r chi.Router) {
			r.Use(middleware.RequireModule(models.ModuleSettings, "write"))
			r.Put("/api/settings/{key}", handlers.UpdateSetting)
		})

		// === Architecture D — Nouveaux modules ===

		// Matrice des permissions (admin only)
		r.Group(func(r chi.Router) {
			r.Use(middleware.RequireModule(models.ModulePermissions, "read"))
			r.Get("/api/permissions", handlers.ListPermissions)
		})
		r.Group(func(r chi.Router) {
			r.Use(middleware.RequireModule(models.ModulePermissions, "write"))
			r.Put("/api/permissions", handlers.UpdatePermission)
		})

		// Journal d'audit (admin only, lecture seule)
		r.Group(func(r chi.Router) {
			r.Use(middleware.RequireModule(models.ModuleAudit, "read"))
			r.Get("/api/audit-logs", handlers.ListAuditLogs)
		})

		// Gestion admin des comptes (suspend/reactivate)
		r.Group(func(r chi.Router) {
			r.Use(middleware.RequireModule(models.ModuleUsersAdmin, "read"))
			r.Get("/api/users", handlers.ListAllUsers)
		})
		r.Group(func(r chi.Router) {
			r.Use(middleware.RequireModule(models.ModuleUsersAdmin, "write"))
			r.Post("/api/users/{id}/suspend", handlers.SuspendUser)
			r.Post("/api/users/{id}/reactivate", handlers.ReactivateUser)
		})
	})

	return r
}
