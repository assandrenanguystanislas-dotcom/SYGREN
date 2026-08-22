package models

// Architecture D — Default RBAC matrix
//
// This file defines the default Role seeds and RoleModule matrix.
// The matrix MIRRORS today's hardcoded RequireRole(...) calls in router.go.
// After seed, every dynamic permission check returns the SAME result as
// the prior static RBAC — zero behavioral change at deploy time.
// The super admin can then edit the matrix via the /api/permissions UI.

// === Module keys (mirror the router's RequireRole groups) ===
const (
        ModuleDashboard       = "dashboard"        // any authed — no writes
        ModuleIEP             = "iep"              // admin+inspector
        ModuleSchools         = "schools"          // write: admin+inspector
        ModuleClasses         = "classes"          // write: admin+inspector+director
        ModuleStudents        = "students"         // write: admin+inspector+director
        ModuleUsersTeachers   = "users.teachers"   // write: admin+inspector+director
        ModuleUsersDirectors  = "users.directors"  // write: admin only
        ModuleUsersInspectors = "users.inspectors" // write+read: admin only
        ModuleSubjects        = "subjects"         // write: admin+inspector+director
        ModuleSessions        = "sessions"         // write: admin+inspector+director
        ModuleGrades          = "grades"           // write: teacher+director+admin+inspector
        ModuleGradeScales     = "grade-scales"     // write: admin+inspector
        ModuleReportCards     = "report-cards"     // write: admin+inspector+director
        ModuleReports         = "reports"          // read-only for all
        ModuleSettings        = "settings"         // write+read: admin only
        ModuleResetRequests   = "reset-requests"   // write+read: admin only
        // Architecture D — NEW modules
        ModulePermissions = "permissions" // NEW — admin only
        ModuleAudit       = "audit"       // NEW — admin only
        ModuleUsersAdmin  = "users-admin" // NEW — suspend/reactivate, admin only
)

// AllModuleKeys returns the list of all module keys for the matrix.
// Used by the seed to populate every (role × module) cell.
func AllModuleKeys() []string {
        return []string{
                ModuleDashboard, ModuleIEP, ModuleSchools, ModuleClasses,
                ModuleStudents, ModuleUsersTeachers, ModuleUsersDirectors, ModuleUsersInspectors,
                ModuleSubjects, ModuleSessions, ModuleGrades, ModuleGradeScales,
                ModuleReportCards, ModuleReports, ModuleSettings, ModuleResetRequests,
                // Architecture D — NEW
                ModulePermissions, ModuleAudit, ModuleUsersAdmin,
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
                {Key: ModuleSubjects, Label: "Matières", Description: "CRUD matières + niveaux (CP/CE/CM)", IconHint: "BookOpen"},
                {Key: ModuleSessions, Label: "Sessions d'évaluation", Description: "CRUD + cycle de vie (draft→open→validated→archived)", IconHint: "CalendarDays"},
                {Key: ModuleGrades, Label: "Saisie des notes", Description: "Upsert/bulk/delete (autosave 800ms)", IconHint: "Pencil"},
                {Key: ModuleGradeScales, Label: "Barèmes de notation", Description: "CRUD barèmes (CP/10, CE/30, CM/50)", IconHint: "Ruler"},
                {Key: ModuleReportCards, Label: "Bulletins PDF", Description: "Génération + lot + téléchargement", IconHint: "FileText"},
                {Key: ModuleReports, Label: "Relevés & synthèses", Description: "Documents PDF officiels", IconHint: "FileBarChart"},
                {Key: ModuleSettings, Label: "Paramètres système", Description: "Configuration générale (irréductible admin)", IconHint: "Settings"},
                {Key: ModuleResetRequests, Label: "Demandes reset password", Description: "Validation admin des demandes de reset", IconHint: "KeyRound"},
                // Architecture D — NEW
                {Key: ModulePermissions, Label: "Permissions (matrice RBAC)", Description: "Édition dynamique des permissions rôle × module", IconHint: "ShieldCheck"},
                {Key: ModuleAudit, Label: "Journal d'audit", Description: "Trace des actions sensibles", IconHint: "History"},
                {Key: ModuleUsersAdmin, Label: "Suspension/Réactivation", Description: "Gestion fine des statuts de comptes", IconHint: "UserX"},
        }
}

// === Default roles (4 system roles, immutable via UI) ===
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
                {Name: RoleDirector, Label: "Directeur", Description: "Directeur d'école — gestion de son établissement", IsSystem: true, SortOrder: 3},
                {Name: RoleTeacher, Label: "Enseignant", Description: "Enseignant — saisie des notes de sa classe", IsSystem: true, SortOrder: 4},
        }
}

// === Default permission matrix ===
// (role_name, module_key, can_read, can_write). Mirrors today's RequireRole calls.
// Read  = can see in nav + can call GET (where the route uses RequireModule("X", "read"))
// Write = can call POST/PUT/DELETE (where the route uses RequireModule("X", "write"))
type DefaultRoleModuleSeed struct {
        RoleName string
        Module   string
        CanRead  bool
        CanWrite bool
}

func DefaultRoleModules() []DefaultRoleModuleSeed {
        all := []string{RoleAdmin, RoleInspector, RoleDirector, RoleTeacher}
        var out []DefaultRoleModuleSeed

        // Helper: for a given module, set CanRead for "all roles"
        for _, mod := range AllModuleKeys() {
                for _, r := range all {
                        out = append(out, DefaultRoleModuleSeed{RoleName: r, Module: mod, CanRead: false, CanWrite: false})
                }
        }

        // Set CanRead=true for all roles on most modules
        readableForAll := []string{
                ModuleDashboard, ModuleSchools, ModuleClasses, ModuleStudents,
                ModuleUsersTeachers, ModuleUsersDirectors, ModuleSubjects,
                ModuleSessions, ModuleGrades, ModuleGradeScales, ModuleReportCards, ModuleReports,
        }
        for _, mod := range readableForAll {
                for _, r := range all {
                        out = setDefault(out, r, mod, true, false)
                }
        }

        // Role-specific read grants
        readForAdminInspector := []string{ModuleIEP}
        for _, mod := range readForAdminInspector {
                out = setDefault(out, RoleAdmin, mod, true, false)
                out = setDefault(out, RoleInspector, mod, true, false)
        }
        readForAdmin := []string{ModuleUsersInspectors, ModuleSettings, ModuleResetRequests, ModulePermissions, ModuleAudit, ModuleUsersAdmin}
        for _, mod := range readForAdmin {
                out = setDefault(out, RoleAdmin, mod, true, false)
        }

        // Write grants — mirror today's RequireRole(...) calls
        // ModuleIEP: admin+inspector (router.go:59)
        out = setDefault(out, RoleAdmin, ModuleIEP, true, true)
        out = setDefault(out, RoleInspector, ModuleIEP, true, true)
        // ModuleSchools: admin+inspector (router.go:69)
        out = setDefault(out, RoleAdmin, ModuleSchools, true, true)
        out = setDefault(out, RoleInspector, ModuleSchools, true, true)
        // ModuleClasses: admin+inspector+director (router.go:78)
        out = setDefault(out, RoleAdmin, ModuleClasses, true, true)
        out = setDefault(out, RoleInspector, ModuleClasses, true, true)
        out = setDefault(out, RoleDirector, ModuleClasses, true, true)
        // ModuleStudents: admin+inspector+director (router.go:87)
        out = setDefault(out, RoleAdmin, ModuleStudents, true, true)
        out = setDefault(out, RoleInspector, ModuleStudents, true, true)
        out = setDefault(out, RoleDirector, ModuleStudents, true, true)
        // ModuleUsersTeachers: admin+inspector+director (router.go:97)
        out = setDefault(out, RoleAdmin, ModuleUsersTeachers, true, true)
        out = setDefault(out, RoleInspector, ModuleUsersTeachers, true, true)
        out = setDefault(out, RoleDirector, ModuleUsersTeachers, true, true)
        // ModuleUsersDirectors: admin only (router.go:106)
        out = setDefault(out, RoleAdmin, ModuleUsersDirectors, true, true)
        // ModuleUsersInspectors: admin only (router.go:114) — read+write
        out = setDefault(out, RoleAdmin, ModuleUsersInspectors, true, true)
        // ModuleSubjects: admin+inspector+director (router.go:124)
        out = setDefault(out, RoleAdmin, ModuleSubjects, true, true)
        out = setDefault(out, RoleInspector, ModuleSubjects, true, true)
        out = setDefault(out, RoleDirector, ModuleSubjects, true, true)
        // ModuleSessions: admin+inspector+director (router.go:143)
        out = setDefault(out, RoleAdmin, ModuleSessions, true, true)
        out = setDefault(out, RoleInspector, ModuleSessions, true, true)
        out = setDefault(out, RoleDirector, ModuleSessions, true, true)
        // ModuleGrades: teacher+director+admin+inspector (router.go:169)
        out = setDefault(out, RoleTeacher, ModuleGrades, true, true)
        out = setDefault(out, RoleDirector, ModuleGrades, true, true)
        out = setDefault(out, RoleAdmin, ModuleGrades, true, true)
        out = setDefault(out, RoleInspector, ModuleGrades, true, true)
        // ModuleGradeScales: admin+inspector (router.go:180)
        out = setDefault(out, RoleAdmin, ModuleGradeScales, true, true)
        out = setDefault(out, RoleInspector, ModuleGradeScales, true, true)
        // ModuleReportCards: admin+inspector+director (router.go:198)
        out = setDefault(out, RoleAdmin, ModuleReportCards, true, true)
        out = setDefault(out, RoleInspector, ModuleReportCards, true, true)
        out = setDefault(out, RoleDirector, ModuleReportCards, true, true)
        // ModuleSettings: admin only (router.go:231)
        out = setDefault(out, RoleAdmin, ModuleSettings, true, true)
        // ModuleResetRequests: admin only (router.go:49)
        out = setDefault(out, RoleAdmin, ModuleResetRequests, true, true)
        // ModulePermissions (NEW): admin only
        out = setDefault(out, RoleAdmin, ModulePermissions, true, true)
        // ModuleAudit (NEW): admin only (read-only, no write)
        out = setDefault(out, RoleAdmin, ModuleAudit, true, false)
        // ModuleUsersAdmin (NEW): admin only — suspend/reactivate
        out = setDefault(out, RoleAdmin, ModuleUsersAdmin, true, true)
        // ModuleReports: read-only for all (no writes)
        // (CanRead already true for all above)

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
