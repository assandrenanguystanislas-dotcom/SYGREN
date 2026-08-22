package models

import (
        "time"

        "github.com/google/uuid"
        "gorm.io/gorm"
)

// Role constants for RBAC
const (
        RoleTeacher   = "teacher"
        RoleDirector  = "director"
        RoleInspector = "inspector"
        RoleAdmin     = "admin"
)

// AllRoles returns the list of valid roles (used by RBAC middleware)
func AllRoles() []string {
        return []string{RoleTeacher, RoleDirector, RoleInspector, RoleAdmin}
}

// === User ===
// Base authentication entity. Login via phone OR email (cahier des charges §4.1).
type User struct {
        ID         string         `gorm:"primaryKey;type:text" json:"id"`
        Phone      *string        `gorm:"uniqueIndex;type:text" json:"phone,omitempty"`
        Email      *string        `gorm:"uniqueIndex;type:text" json:"email,omitempty"`
        Password   string         `gorm:"type:text" json:"-"` // bcrypt hash, never serialized
        FullName   string         `gorm:"type:text" json:"full_name"`
        Role       string         `gorm:"type:text;index" json:"role"`
        IEPID      *string        `gorm:"type:text" json:"iep_id,omitempty"`      // inspecteur / admin scope
        SchoolID   *string        `gorm:"type:text" json:"school_id,omitempty"`  // directeur / teacher scope
        Active     bool           `gorm:"default:true" json:"active"`
        MustChangePassword bool  `gorm:"default:false" json:"must_change_password"` // temp password → user must change on first login
        CreatedAt  time.Time      `json:"created_at"`
        UpdatedAt  time.Time      `json:"updated_at"`
        DeletedAt  gorm.DeletedAt `gorm:"index" json:"-"`
}

// BeforeCreate generates a UUID for new users.
func (u *User) BeforeCreate(tx *gorm.DB) error {
        if u.ID == "" {
                u.ID = uuid.NewString()
        }
        return nil
}

// === IEP — Inspection de l'Enseignement Primaire ===
// Représente une circonscription (Inspection) et son titulaire.
// Les informations de l'inspecteur (nom, contact, BP) sont utilisées pour
// remplir automatiquement le document de synthèse des résultats (signatures,
// en-tête "BP : ... / Tel : ..."). Évite de les ressaisir à chaque impression.
type IEP struct {
        ID            string    `gorm:"primaryKey;type:text" json:"id"`
        Name          string    `gorm:"type:text" json:"name"`
        Region        string    `gorm:"type:text" json:"region"`
        InspectorName string    `gorm:"type:text" json:"inspector_name"`           // Nom + prénom de l'inspecteur titulaire
        InspectorEmail string   `gorm:"type:text" json:"inspector_email"`         // Courriel officiel
        InspectorPhone string   `gorm:"type:text" json:"inspector_phone"`        // Téléphone officiel
        BP            string    `gorm:"type:text" json:"bp"`                      // Boîte postale de l'IEP
        CreatedAt     time.Time `json:"created_at"`
}

func (i *IEP) BeforeCreate(tx *gorm.DB) error {
        if i.ID == "" {
                i.ID = uuid.NewString()
        }
        return nil
}

// === School ===
type School struct {
        ID        string    `gorm:"primaryKey;type:text" json:"id"`
        IEPID     string    `gorm:"type:text;index" json:"iep_id"`
        Code      string    `gorm:"uniqueIndex;type:text" json:"code"` // code unique identifiant l'école dans le système IEP
        Name      string    `gorm:"type:text" json:"name"`
        Address   string    `gorm:"type:text" json:"address"`
        Status    string    `gorm:"type:text;default:public" json:"status"` // public | private | community
        CreatedAt time.Time `json:"created_at"`
}

func (s *School) BeforeCreate(tx *gorm.DB) error {
        if s.ID == "" {
                s.ID = uuid.NewString()
        }
        return nil
}

// === Class (CP1, CP2, CE1, CE2, CM1, CM2) ===
// Auto-créées à la création d'une école (cahier des charges §3 Module 1).
// Le directeur peut désactiver une classe (soft-delete) — l'historique
// (notes, bulletins) est conservé, mais la classe n'apparaît plus dans les
// selects de saisie/élèves tant qu'elle est inactive.
type Class struct {
        ID        string    `gorm:"primaryKey;type:text" json:"id"`
        SchoolID  string    `gorm:"type:text;index" json:"school_id"`
        Name      string    `gorm:"type:text" json:"name"`  // "CP1", "CP2"...
        Level     string    `gorm:"type:text" json:"level"` // "CP", "CE", "CM"
        TeacherID *string   `gorm:"type:text;index" json:"teacher_id,omitempty"`
        Active    bool      `gorm:"default:true" json:"active"`
        CreatedAt time.Time `json:"created_at"`
}

func (c *Class) BeforeCreate(tx *gorm.DB) error {
        if c.ID == "" {
                c.ID = uuid.NewString()
        }
        return nil
}

// === Student ===
// Matricule fourni par le Ministère de l'Éducation (optionnel).
// Si absent à la saisie → NULL en base + affichage "N/A" côté frontend.
// (PostgreSQL autorise plusieurs NULL dans un unique index, donc plusieurs
// élèves sans matricule peuvent coexister sans conflit.)
type Student struct {
        ID        string     `gorm:"primaryKey;type:text" json:"id"`
        Matricule *string    `gorm:"uniqueIndex;type:text" json:"matricule,omitempty"`
        ClassID   string     `gorm:"type:text;index" json:"class_id"`
        FirstName string     `gorm:"type:text" json:"first_name"`
        LastName  string     `gorm:"type:text" json:"last_name"`
        Gender    string     `gorm:"type:text" json:"gender"` // M / F
        BirthDate *time.Time `json:"birth_date,omitempty"`
        CreatedAt time.Time  `json:"created_at"`
}

func (s *Student) BeforeCreate(tx *gorm.DB) error {
        if s.ID == "" {
                s.ID = uuid.NewString()
        }
        return nil
}

// === Subject (Matière) ===
// Coefficient par défaut = 1 pour les compositions mensuelles (cahier des charges §3)
// Levels : niveaux où la matière est enseignée (CP, CE, CM) — string séparée par virgules.
// Ex: "CP,CE,CM" = tous niveaux ; "CP" = CP uniquement (CP1+CP2).
type Subject struct {
        ID          string    `gorm:"primaryKey;type:text" json:"id"`
        Name        string    `gorm:"uniqueIndex;type:text" json:"name"`
        Coefficient float64   `gorm:"default:1" json:"coefficient"`
        Levels      string    `gorm:"type:text;default:CP,CE,CM" json:"levels"` // "CP,CE,CM" | "CP" | "CP,CE" etc.
        CreatedAt   time.Time `json:"created_at"`
}

func (s *Subject) BeforeCreate(tx *gorm.DB) error {
        if s.ID == "" {
                s.ID = uuid.NewString()
        }
        return nil
}

// === EvaluationSession ===
// Session d'évaluation. Cycle de vie complet :
//
//   draft ──open──► open ──close──► closed ──validate──► validated ──archive──► archived
//     │                  │
//     └──cancel──► cancelled
//                   ▲
//                   └── (cancel autorisé depuis open si 0 note saisie, sinon
//                        suppression explicite des notes avec delete_grades=true)
//
// Statuts terminaux (lecture seule, plus de modification possible) :
//   - cancelled : session annulée (examen reporté, erreur de planification, force
//     majeure). Les notes saisies sont supprimées au moment de l'annulation. La
//     session reste visible pour l'audit pédagogique (qui, quand, pourquoi).
//   - archived   : session validée puis archivée (manuellement ou automatiquement
//     en fin d'année scolaire via le cron de main.go). Les notes sont conservées
//     et restent utilisées par le bilan annuel élève + la comparaison inter-annuelle.
//     Masquée de l'UI active par défaut (filtre include_archived=false).
//
// RBAC annulation/archivage :
//   - admin : toutes les sessions
//   - director : uniquement les sessions de son école
//   - inspector/teacher : lecture seule (pas d'annulation ni d'archivage)
//
// Type : "composition" (défaut) ou "exam_blanc" (réservé au CM2, inclut EPS)
// Number : numéro de l'évaluation dans l'année (Composition N°1, etc.)
// SchoolID : 1 session par ÉCOLE (pas par classe). Les notes sont rattachées
//   via Grade.StudentID → Student.ClassID (l'élève sait dans quelle classe il est)
// OpenAt/CloseAt : dates d'ouverture et de clôture obligatoires
// AutoOpen : si true, ouverture automatique à OpenAt (goroutine main.go)
type EvaluationSession struct {
        ID         string     `gorm:"primaryKey;type:text" json:"id"`
        SchoolID   string     `gorm:"type:text;index" json:"school_id"`
        Month      int        `json:"month"`
        Year       int        `json:"year"`
        Status     string     `gorm:"type:text;default:draft" json:"status"`
        EvalType   string     `gorm:"type:text;default:composition" json:"eval_type"`
        EvalNumber int        `gorm:"default:1" json:"eval_number"`
        OpenAt     *time.Time `gorm:"type:timestamp" json:"open_at"`
        CloseAt    *time.Time `gorm:"type:timestamp" json:"close_at"`
        AutoOpen   bool       `gorm:"default:false" json:"auto_open"`
        // Champs d'annulation (soft cancel — pas de hard delete pour préserver l'audit)
        CancelReason string     `gorm:"type:text" json:"cancel_reason,omitempty"`
        CancelledBy  *string    `gorm:"type:text" json:"cancelled_by,omitempty"`
        CancelledAt  *time.Time `gorm:"type:timestamp" json:"cancelled_at,omitempty"`
        // Champs d'archivage (manuel ou auto via cron de fin d'année scolaire)
        ArchivedAt *time.Time `gorm:"type:timestamp" json:"archived_at,omitempty"`
        ArchivedBy *string    `gorm:"type:text" json:"archived_by,omitempty"`
        CreatedAt  time.Time  `json:"created_at"`
        UpdatedAt  time.Time  `json:"updated_at"`
}

func (e *EvaluationSession) BeforeCreate(tx *gorm.DB) error {
        if e.ID == "" {
                e.ID = uuid.NewString()
        }
        return nil
}

// === Grade (Note) ===
// Value = note brute (0 à MaxScore, dépendant du barème de la matière+classe)
// MaxScore est déterminé dynamiquement via la table GradeScale (cahier des charges
// §3 Module 2 : CP et CE sur /10, CM sur /20, Dictée /20, etc.)
type Grade struct {
        ID        string    `gorm:"primaryKey;type:text" json:"id"`
        StudentID string    `gorm:"type:text;index" json:"student_id"`
        SubjectID string    `gorm:"type:text;index" json:"subject_id"`
        SessionID string    `gorm:"type:text;index" json:"session_id"`
        Value     float64   `json:"value"` // note brute (sur MaxScore, pas forcément 20)
        IsDraft   bool      `gorm:"default:true" json:"is_draft"`
        UpdatedAt time.Time `json:"updated_at"`
}

func (g *Grade) BeforeCreate(tx *gorm.DB) error {
        if g.ID == "" {
                g.ID = uuid.NewString()
        }
        return nil
}

// === ReportCard (Bulletin) ===
type ReportCard struct {
        ID          string    `gorm:"primaryKey;type:text" json:"id"`
        StudentID   string    `gorm:"type:text;index" json:"student_id"`
        SessionID   string    `gorm:"type:text;index" json:"session_id"`
        Average     float64   `json:"average"`
        Rank        int       `json:"rank"`
        Mention     string    `gorm:"type:text" json:"mention"`
        FilePath    string    `gorm:"type:text" json:"file_path"`
        GeneratedAt time.Time `json:"generated_at"`
}

func (r *ReportCard) BeforeCreate(tx *gorm.DB) error {
        if r.ID == "" {
                r.ID = uuid.NewString()
        }
        return nil
}

// === Setting (key-value) — configuration globale du système ===
// Permet de stocker les seuils de mentions, coefficients par défaut, etc.
// sans modifier le schéma. Les settings sont partagés (pas de scope).
type Setting struct {
        ID        string    `gorm:"primaryKey;type:text" json:"id"`
        Key       string    `gorm:"uniqueIndex;type:text" json:"key"`        // ex: "mention.threshold.tres_bien"
        Value     string    `gorm:"type:text" json:"value"`                 // stocké en string, converti selon le type
        Category  string    `gorm:"type:text;index" json:"category"`        // ex: "mention", "system", "coefficient"
        Label     string    `gorm:"type:text" json:"label"`                 // description lisible
        UpdatedAt time.Time `json:"updated_at"`
}

func (s *Setting) BeforeCreate(tx *gorm.DB) error {
        if s.ID == "" {
                s.ID = uuid.NewString()
        }
        return nil
}

// DefaultSettings retourne les settings par défaut (utilisés au premier seed).
// Les seuils sont stockés en nombres décimaux (ex: "16" pour 16/20).
func DefaultSettings() []Setting {
        return []Setting{
                // Seuils de mentions (cahier des charges §3 Module 3)
                {Key: "mention.threshold.tres_bien", Value: "16", Category: "mention", Label: "Seuil Très Bien (≥)"},
                {Key: "mention.threshold.bien", Value: "14", Category: "mention", Label: "Seuil Bien (≥)"},
                {Key: "mention.threshold.assez_bien", Value: "12", Category: "mention", Label: "Seuil Assez Bien (≥)"},
                {Key: "mention.threshold.passable", Value: "10", Category: "mention", Label: "Seuil Passable (≥)"},
                {Key: "mention.threshold.faible", Value: "8", Category: "mention", Label: "Seuil Faible (≥)"},
                {Key: "mention.threshold.insuffisant", Value: "5", Category: "mention", Label: "Seuil Insuffisant (≥)"},
                // Config système
                {Key: "system.school_year", Value: "2026", Category: "system", Label: "Année scolaire en cours"},
                {Key: "system.pass_rate_threshold", Value: "10", Category: "system", Label: "Seuil de réussite (≥)"},
                {Key: "system.distinction_threshold", Value: "14", Category: "system", Label: "Seuil de distinction (≥)"},
                // Coefficient par défaut pour les nouvelles matières
                {Key: "coefficient.default", Value: "1", Category: "coefficient", Label: "Coefficient par défaut"},
        }
}

// === GradeScale (Barème de notation) ===
// Définit le barème max d'une matière pour un niveau donné.
// Si SubjectID est NULL → barème par défaut du niveau (toutes matières).
// Si SubjectID est défini → exception spécifique (ex: Dictée CE à /20 alors que défaut CE est /10).
type GradeScale struct {
        ID        string    `gorm:"primaryKey;type:text" json:"id"`
        Level     string    `gorm:"type:text;index" json:"level"`               // "CP" | "CE" | "CM"
        SubjectID *string   `gorm:"type:text;index" json:"subject_id,omitempty"` // NULL = défaut du niveau
        SubjectName string  `gorm:"-" json:"subject_name,omitempty"`            // rempli par le handler ( JOIN manuelle)
        MaxScore  int       `gorm:"default:20" json:"max_score"`                 // 10, 20, 30, 50...
        CreatedAt time.Time `json:"created_at"`
        UpdatedAt time.Time `json:"updated_at"`
}

func (gs *GradeScale) BeforeCreate(tx *gorm.DB) error {
        if gs.ID == "" {
                gs.ID = uuid.NewString()
        }
        return nil
}

// DefaultGradeScales retourne les barèmes par défaut (cahier des charges §3 Module 2).
// Utilisé au premier seed.
//   - CP  : toutes matières /10
//   - CE  : toutes matières /30, sauf Dictée /20 (exception ajoutée au seed via SubjectID)
//   - CM  : toutes matières /50, sauf Dictée /20 (exception ajoutée au seed via SubjectID)
//
// Les exceptions Dictée sont ajoutées dynamiquement dans seedDefaults() car on doit
// d'abord trouver l'ID du sujet "Dictée" en base.
func DefaultGradeScales() []GradeScale {
        return []GradeScale{
                // CP : défaut /10
                {Level: "CP", SubjectID: nil, MaxScore: 10},
                // CE : défaut /30
                {Level: "CE", SubjectID: nil, MaxScore: 30},
                // CM : défaut /50
                {Level: "CM", SubjectID: nil, MaxScore: 50},
        }
}

// === SessionExemption — Dispense de classe/niveau pour une session ===
// Permet d'exempter certaines classes ou niveaux d'une évaluation.
// Si ClassID est défini → exemption d'une classe précise (ex: CP1)
// Si Level est défini → exemption de tout le niveau (ex: "CP" = CP1 + CP2)
// Les deux peuvent être cumulés.
type SessionExemption struct {
        ID        string    `gorm:"primaryKey;type:text" json:"id"`
        SessionID string    `gorm:"type:text;index" json:"session_id"`
        ClassID   *string   `gorm:"type:text;index" json:"class_id,omitempty"`  // NULL = pas une classe précise
        Level     *string   `gorm:"type:text" json:"level,omitempty"`            // "CP"|"CE"|"CM" = tout le niveau
        Reason    string    `gorm:"type:text" json:"reason"`
        CreatedAt time.Time `json:"created_at"`
}

func (e *SessionExemption) BeforeCreate(tx *gorm.DB) error {
        if e.ID == "" {
                e.ID = uuid.NewString()
        }
        return nil
}

// === StudentSessionResult (Fix E) ===
// Table de moyennes PRÉCALCULÉES par élève × session. Alimentée par
// recomputeStudentSessionResult (appelée à chaque saisie/suppression de note)
// + backfill au démarrage. Permet au dashboard d'agréger en SQL (AVG, COUNT
// FILTER) au lieu de tout recalculer en Go (Fix E : ~9s → ~0.3s sur cache-miss).
type StudentSessionResult struct {
        ID           string    `gorm:"primaryKey;type:text" json:"id"`
        StudentID    string    `gorm:"type:text;index" json:"student_id"`
        SessionID    string    `gorm:"type:text;index" json:"session_id"`
        ClassID      string    `gorm:"type:text" json:"class_id"`
        ClassLevel   string    `gorm:"type:text" json:"class_level"`    // CP|CE|CM
        Average      float64   `gorm:"type:numeric" json:"average"`    // moyenne pondérée (sur average_scale)
        AverageScale int       `gorm:"type:int" json:"average_scale"`  // 10 (CP/CE) ou 20 (CM)
        HasAverage   bool      `gorm:"type:boolean" json:"has_average"`
        CreatedAt    time.Time `json:"created_at"`
}

func (r *StudentSessionResult) BeforeCreate(tx *gorm.DB) error {
        if r.ID == "" {
                r.ID = uuid.NewString()
        }
        return nil
}

// === PasswordResetRequest — demandes de réinitialisation de mot de passe ===
// Workflow : user soumet une demande (identifier) → admin valide (option 1:
// temp password, option 2: reset link) → user change son mot de passe.
type PasswordResetRequest struct {
        ID           string     `gorm:"primaryKey;type:text" json:"id"`
        Identifier   string     `gorm:"type:text" json:"identifier"`           // email, phone, ou code école
        RoleHint     string     `gorm:"type:text" json:"role_hint"`            // rôle sélectionné par l'utilisateur
        UserID       *string    `gorm:"type:text" json:"user_id,omitempty"`    // user résolu (si trouvé)
        UserName     string     `gorm:"type:text" json:"user_name,omitempty"`  // nom du user résolu (pour l'admin)
        Status       string     `gorm:"type:text;default:pending" json:"status"` // pending | approved | rejected
        TempPassword *string    `gorm:"type:text" json:"-"`                     // option 1: mdp temporaire en clair (jamais sérialisé)
        ResetToken   *string    `gorm:"type:text;index" json:"reset_token,omitempty"` // option 2: token pour reset link
        Message      string     `gorm:"type:text" json:"message,omitempty"`    // message optionnel du user
        AdminNote    string     `gorm:"type:text" json:"admin_note,omitempty"`  // note de l'admin
        CreatedAt    time.Time  `json:"created_at"`
        ResolvedAt   *time.Time `json:"resolved_at,omitempty"`
        ResolvedBy   *string    `gorm:"type:text" json:"resolved_by,omitempty"` // admin user ID
}

func (r *PasswordResetRequest) BeforeCreate(tx *gorm.DB) error {
        if r.ID == "" {
                r.ID = uuid.NewString()
        }
        return nil
}

// AllModels returns all models for auto-migration.
func AllModels() []interface{} {
        return []interface{}{
                &User{}, &IEP{}, &School{}, &Class{}, &Student{},
                &Subject{}, &EvaluationSession{}, &Grade{}, &ReportCard{},
                &Setting{}, &GradeScale{}, &SessionExemption{},
                &StudentSessionResult{},
                &PasswordResetRequest{},
        }
}
