package models

// Architecture D — Default RBAC matrix (v2)
//
// This file defines the default Role seeds and RoleModule matrix.
//
// === v2 (politique d'accès — session 19) ===
//
//   - Enseignant (teacher) : module Élèves (lecture + ÉCRITURE) et saisie
//     des notes dans le module Évaluations. AUCUN accès aux documents
//     imprimables (modules Résultats / Bulletins) ni au module Utilisateurs.
//   - Directeur (director) : Élèves + saisie des notes + CONSULTATION des
//     documents imprimables (Résultats / Bulletins). L'IMPRESSION est
//     verrouillée (frontend : boutons masqués + CSS @media print bloque le
//     document — seul le personnel autorisé imprime).
//   - Admin IEP (inspector) et Super Admin (admin) : TOUT, y compris
//     l'impression des documents.
//   - Parent (NOUVEAU) : Portail Parent uniquement — consultation et
//     impression du bulletin individuel de son enfant (recherche par
//     matricule) dans les modules Résultats (fin d'année) et Bulletins
//     (bulletins de période).
//
// La matrice MIRRORS the RequireModule(...) calls in router.go. After seed,
// every dynamic permission check returns the intended result. The super
// admin can then edit the matrix via the /api/permissions UI.
// Migration : la constante RbacMatrixVersion + le setting "rbac.matrix_version"
// (voir database/seedRBAC) permettent d'appliquer la matrice à une base
// EXISTANTE sans écraser d'éventuelles personnalisations ultérieures.

// === Module keys (mirror the router's RequireModule groups) ===
const (
	ModuleDashboard       = "dashboard"        // any authed — no writes
	ModuleIEP             = "iep"              // admin+inspector
	ModuleSchools         = "schools"          // write: admin+inspector
	ModuleClasses         = "classes"          // write: admin+inspector+director
	ModuleStudents        = "students"         // v2 write: admin+inspector+director+TEACHER
	ModuleUsersTeachers   = "users.teachers"   // write: admin+inspector+director
	ModuleUsersDirectors  = "users.directors"  // write: admin only
	ModuleUsersInspectors = "users.inspectors" // write+read: admin only
	ModuleUsersParents    = "users.parents"    // v2 NEW — CRUD comptes parents: admin+inspector
	ModuleSubjects        = "subjects"         // write: admin+inspector+director
	ModuleSessions        = "sessions"         // write: admin+inspector+director
	ModuleGrades          = "grades"           // write: teacher+director+admin+inspector
	ModuleGradeScales     = "grade-scales"     // write: admin+inspector
	ModuleReportCards     = "report-cards"     // v2 read: admin+inspector+DIRECTOR (impression: admin+inspector)
	ModuleReports         = "reports"          // v2 read: admin+inspector+DIRECTOR (impression: admin+inspector)
	ModuleSettings        = "settings"         // write+read: admin only
	ModuleResetRequests   = "reset-requests"   // write+read: admin only
	// Architecture D — NEW modules
	ModulePermissions = "permissions" // NEW — admin only
	ModuleAudit       = "audit"       // NEW — admin only
	ModuleUsersAdmin  = "users-admin" // NEW — suspend/reactivate, admin only
	// v2 — Portail Parent
	ModuleParentPortal = "parent-portal" // v2 NEW — consultation + impression bulletin individuel: parent (+admin+inspector)
)

// RbacMatrixVersion — version de la matrice par défaut (voir seedRBAC).
// Incrémenter à chaque changement de politique pour que les bases existantes
// soient re-synchronisées au démarrage.
const RbacMatrixVersion = 2

// RbacMatrixVersionKey — clé du setting stockant la version appliquée.
const RbacMatrixVersionKey = "rbac.matrix_version"

// AllModuleKeys returns the list of all module keys for the matrix.
// Used by the seed to populate every (role × module) cell.
func AllModuleKeys() []string {
	return []string{
		ModuleDashboard, ModuleIEP, ModuleSchools, ModuleClasses,
		ModuleStudents, ModuleUsersTeachers, ModuleUsersDirectors, ModuleUsersInspectors,
		ModuleUsersParents, ModuleSubjects, ModuleSessions, ModuleGrades, ModuleGradeScales,
		ModuleReportCards, ModuleReports, ModuleSettings, ModuleResetRequests,
		// Architecture D — NEW
		ModulePermissions, ModuleAudit, ModuleUsersAdmin,
		// v2
		ModuleParentPortal,
	}
}

// ModuleMeta describes a module for UI display.
type ModuleMeta struct {
	Key         string `json:"key"`
	Label       string `json:"label"`
	Description string `json:"description"`
	IconHint    string `json:"icon_hint"` // for frontend; the frontend maps icons by key
}

// AllModuleMetas returns metadata for each module (used by /api/permissions).
func AllModuleMetas() []ModuleMeta {
	return []ModuleMeta{
		{Key: ModuleDashboard, Label: "Tableau de bord", Description: "Indicateurs et statistiques agrégées", IconHint: "LayoutDashboard"},
		{Key: ModuleIEP, Label: "Inspections (IEP)", Description: "Circonscriptions et inspecteurs titulaires", IconHint: "BarChart3"},
		{Key: ModuleSchools, Label: "Écoles", Description: "CRUD des établissements", IconHint: "School"},
		{Key: ModuleClasses, Label: "Classes", Description: "CP1-CM2 par école (soft-delete)", IconHint: "Layers"},
		{Key: ModuleStudents, Label: "Élèves", Description: "CRUD élèves + import Excel", IconHint: "Users"},
		{Key: ModuleUsersTeachers, Label: "Utilisateurs · Enseignants", Description: "CRUD enseignants", IconHint: "GraduationCap"},
		{Key: ModuleUsersDirectors, Label: "Utilisateurs · Directeurs", Description: "CRUD directeurs (1 actif/école)", IconHint: "UserCog"},
		{Key: ModuleUsersInspectors, Label: "Utilisateurs · Admins IEP", Description: "CRUD admins IEP (super admin seul)", IconHint: "ShieldCheck"},
		{Key: ModuleUsersParents, Label: "Utilisateurs · Parents", Description: "CRUD comptes parents (portail bulletin individuel)", IconHint: "UserRound"},
		{Key: ModuleSubjects, Label: "Matières", Description: "CRUD matières + niveaux (CP/CE/CM)", IconHint: "BookOpen"},
		{Key: ModuleSessions, Label: "Sessions d'évaluation", Description: "CRUD + cycle de vie (draft→open→validated→archived)", IconHint: "CalendarDays"},
		{Key: ModuleGrades, Label: "Saisie des notes", Description: "Upsert/bulk/delete (autosave 800ms)", IconHint: "Pencil"},
		{Key: ModuleGradeScales, Label: "Barèmes de notation", Description: "CRUD barèmes (CP/10, CE/30, CM/50)", IconHint: "Ruler"},
		{Key: ModuleReportCards, Label: "Bulletins", Description: "Bulletins individuels de période (impression réservée)", IconHint: "FileText"},
		{Key: ModuleReports, Label: "Résultats", Description: "Documents officiels (impression réservée)", IconHint: "FileBarChart"},
		{Key: ModuleSettings, Label: "Paramètres système", Description: "Configuration générale (irréductible admin)", IconHint: "Settings"},
		{Key: ModuleResetRequests, Label: "Demandes reset password", Description: "Validation admin des demandes de reset", IconHint: "KeyRound"},
		// Architecture D — NEW
		{Key: ModulePermissions, Label: "Permissions (matrice RBAC)", Description: "Édition dynamique des permissions rôle × module", IconHint: "ShieldCheck"},
		{Key: ModuleAudit, Label: "Journal d'audit", Description: "Trace des actions sensibles", IconHint: "History"},
		{Key: ModuleUsersAdmin, Label: "Suspension/Réactivation", Description: "Gestion fine des statuts de comptes", IconHint: "UserX"},
		// v2
		{Key: ModuleParentPortal, Label: "Portail Parent", Description: "Consultation + impression du bulletin individuel de l'enfant (par matricule)", IconHint: "Home"},
	}
}

// === Default roles (5 system roles, immutable via UI) ===
type DefaultRoleSeed struct {
	Name        string
	Label       string
	Description string
	IsSystem    bool
	SortOrder   int
}

func DefaultRoles() []DefaultRoleSeed {
	return []DefaultRoleSeed{
		{Name: RoleAdmin, Label: "Super Admin", Description: "Contrôle total du système (irréductible)", IsSystem: true, SortOrder: 1},
		{Name: RoleInspector, Label: "Admin IEP", Description: "Fonctionnaire de l'IEP — gestion multi-écoles (sauf paramètres généraux)", IsSystem: true, SortOrder: 2},
		{Name: RoleDirector, Label: "Directeur", Description: "Directeur d'école — gestion de son établissement (documents consultables, impression verrouillée)", IsSystem: true, SortOrder: 3},
		{Name: RoleTeacher, Label: "Enseignant", Description: "Enseignant — module Élèves et saisie des notes de sa classe", IsSystem: true, SortOrder: 4},
		// v2 — Portail Parent
		{Name: RoleParent, Label: "Parent", Description: "Parent — consultation et impression du bulletin individuel de son enfant (par matricule)", IsSystem: true, SortOrder: 5},
	}
}

// === Default permission matrix (v2) ===
// (role_name, module_key, can_read, can_write).
// Read  = can see in nav + can call GET (where the route uses RequireModule("X", "read"))
// Write = can call POST/PUT/DELETE (where the route uses RequireModule("X", "write"))
type DefaultRoleModuleSeed struct {
	RoleName string
	Module   string
	CanRead  bool
	CanWrite bool
}

func DefaultRoleModules() []DefaultRoleModuleSeed {
	all := []string{RoleAdmin, RoleInspector, RoleDirector, RoleTeacher, RoleParent}
	var out []DefaultRoleModuleSeed

	// Pré-allouer TOUTES les cellules (rôle × module) à false/false —
	// aucun accès par défaut (le parent n'a QUE le portail parent).
	for _, mod := range AllModuleKeys() {
		for _, r := range all {
			out = append(out, DefaultRoleModuleSeed{RoleName: r, Module: mod, CanRead: false, CanWrite: false})
		}
	}

	// --- Lecture commune aux 4 rôles "internes" (admin, inspector, director,
	// teacher) — le PARENT n'y accède PAS (portail parent uniquement) ---
	internal := []string{RoleAdmin, RoleInspector, RoleDirector, RoleTeacher}
	readableForInternal := []string{
		ModuleDashboard, ModuleClasses, ModuleStudents, ModuleSubjects,
		ModuleSessions, ModuleGrades,
	}
	for _, mod := range readableForInternal {
		for _, r := range internal {
			out = setDefault(out, r, mod, true, false)
		}
	}

	// Classes : ÉCRITURE admin + inspector + director (inchangé).
	out = setDefault(out, RoleAdmin, ModuleClasses, true, true)
	out = setDefault(out, RoleInspector, ModuleClasses, true, true)
	out = setDefault(out, RoleDirector, ModuleClasses, true, true)
	// Élèves : ÉCRITURE admin + inspector + director + ENSEIGNANT (v2 — les
	// enseignants travaillent dans le module Élèves).
	out = setDefault(out, RoleAdmin, ModuleStudents, true, true)
	out = setDefault(out, RoleInspector, ModuleStudents, true, true)
	out = setDefault(out, RoleDirector, ModuleStudents, true, true)
	out = setDefault(out, RoleTeacher, ModuleStudents, true, true)

	// Saisie des notes : teacher + director + admin + inspector (inchangé).
	out = setDefault(out, RoleTeacher, ModuleGrades, true, true)
	out = setDefault(out, RoleDirector, ModuleGrades, true, true)
	out = setDefault(out, RoleAdmin, ModuleGrades, true, true)
	out = setDefault(out, RoleInspector, ModuleGrades, true, true)

	// --- Admin IEP + Super Admin ---
	out = setDefault(out, RoleAdmin, ModuleIEP, true, true)
	out = setDefault(out, RoleInspector, ModuleIEP, true, true)
	out = setDefault(out, RoleAdmin, ModuleSchools, true, true)
	out = setDefault(out, RoleInspector, ModuleSchools, true, true)
	out = setDefault(out, RoleAdmin, ModuleUsersTeachers, true, true)
	out = setDefault(out, RoleInspector, ModuleUsersTeachers, true, true)
	out = setDefault(out, RoleDirector, ModuleUsersTeachers, true, true)
	// Utilisateurs · Directeurs : écriture Super Admin seul ; lecture
	// admin + inspector + director (consultation).
	out = setDefault(out, RoleAdmin, ModuleUsersDirectors, true, true)
	out = setDefault(out, RoleInspector, ModuleUsersDirectors, true, false)
	out = setDefault(out, RoleDirector, ModuleUsersDirectors, true, false)
	// Utilisateurs · Admins IEP : Super Admin seul (irréductible).
	out = setDefault(out, RoleAdmin, ModuleUsersInspectors, true, true)
	// v2 — Utilisateurs · Parents : admin + inspector (les parents ne sont
	// pas rattachés à une école → pas de gestion par le directeur).
	out = setDefault(out, RoleAdmin, ModuleUsersParents, true, true)
	out = setDefault(out, RoleInspector, ModuleUsersParents, true, true)

	out = setDefault(out, RoleAdmin, ModuleSubjects, true, true)
	out = setDefault(out, RoleInspector, ModuleSubjects, true, true)
	out = setDefault(out, RoleDirector, ModuleSubjects, true, true)
	out = setDefault(out, RoleAdmin, ModuleSessions, true, true)
	out = setDefault(out, RoleInspector, ModuleSessions, true, true)
	out = setDefault(out, RoleDirector, ModuleSessions, true, true)
	out = setDefault(out, RoleAdmin, ModuleGradeScales, true, true)
	out = setDefault(out, RoleInspector, ModuleGradeScales, true, true)

	// --- Documents imprimables (v2 — IMPRESSION VERROUILLÉE) ---
	// Lecture (consultation à l'écran) : admin + inspector + DIRECTOR.
	// L'enseignant n'a AUCUN accès (ni consultation ni impression).
	// L'impression est bloquée côté FRONTEND pour le directeur
	// (bouton masqué + @media print) ; l'Admin IEP et le Super Admin
	// impriment librement.
	out = setDefault(out, RoleAdmin, ModuleReports, true, true)
	out = setDefault(out, RoleInspector, ModuleReports, true, true)
	out = setDefault(out, RoleDirector, ModuleReports, true, false)
	out = setDefault(out, RoleAdmin, ModuleReportCards, true, true)
	out = setDefault(out, RoleInspector, ModuleReportCards, true, true)
	out = setDefault(out, RoleDirector, ModuleReportCards, true, false)

	// --- Modules Super Admin (irréductibles) ---
	out = setDefault(out, RoleAdmin, ModuleSettings, true, true)
	out = setDefault(out, RoleAdmin, ModuleResetRequests, true, true)
	out = setDefault(out, RoleAdmin, ModulePermissions, true, true)
	out = setDefault(out, RoleAdmin, ModuleAudit, true, false)
	out = setDefault(out, RoleAdmin, ModuleUsersAdmin, true, true)

	// --- v2 — Portail Parent ---
	// Le PARENT consulte et imprime le bulletin individuel de son enfant.
	// Admin + Inspector accèdent aussi au portail (assistance).
	out = setDefault(out, RoleParent, ModuleParentPortal, true, false)
	out = setDefault(out, RoleAdmin, ModuleParentPortal, true, true)
	out = setDefault(out, RoleInspector, ModuleParentPortal, true, true)

	return out
}

// setDefault finds the (role, module) cell and updates CanRead/CanWrite.
// If the cell doesn't exist (shouldn't happen due to pre-allocation), it appends.
func setDefault(slice []DefaultRoleModuleSeed, roleName, module string, canRead, canWrite bool) []DefaultRoleModuleSeed {
	for i, e := range slice {
		if e.RoleName == roleName && e.Module == module {
			slice[i].CanRead = canRead
			slice[i].CanWrite = canWrite
			return slice
		}
	}
	return append(slice, DefaultRoleModuleSeed{RoleName: roleName, Module: module, CanRead: canRead, CanWrite: canWrite})
}

// === Irreducible permissions ===
// These (role × module) pairs cannot be revoked via the UI even by the super admin.
// Prevents self-lockout and ensures audit trail integrity.
// The middleware asserts these are always true regardless of DB state.
func IsIrreducible(roleName, module string) bool {
	switch roleName {
	case RoleAdmin:
		switch module {
		case ModuleSettings, ModulePermissions, ModuleAudit, ModuleUsersAdmin, ModuleUsersInspectors:
			return true
		}
	}
	return false
}

// AdminIEPServices lists the suggested services for the Admin IEP "service" field.
// Free-text input, but the UI shows these as datalist suggestions.
func AdminIEPServices() []string {
	return []string{
		"Service Examen & Concours",
		"Service Statistique",
		"Service Pédagogique",
		"Service Administration Générale",
		"Service Affaires Sociales",
	}
}
