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
type IEP struct {
        ID        string    `gorm:"primaryKey;type:text" json:"id"`
        Name      string    `gorm:"type:text" json:"name"`
        Region    string    `gorm:"type:text" json:"region"`
        CreatedAt time.Time `json:"created_at"`
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
// Session mensuelle de saisie. Statuts : draft → open → closed → validated
type EvaluationSession struct {
        ID        string    `gorm:"primaryKey;type:text" json:"id"`
        ClassID   string    `gorm:"type:text;index" json:"class_id"`
        Month     int       `json:"month"`  // 1-12
        Year      int       `json:"year"`
        Status    string    `gorm:"type:text;default:draft" json:"status"` // draft|open|closed|validated
        CreatedAt time.Time `json:"created_at"`
        UpdatedAt time.Time `json:"updated_at"`
}

func (e *EvaluationSession) BeforeCreate(tx *gorm.DB) error {
        if e.ID == "" {
                e.ID = uuid.NewString()
        }
        return nil
}

// === Grade (Note) ===
type Grade struct {
        ID        string    `gorm:"primaryKey;type:text" json:"id"`
        StudentID string    `gorm:"type:text;index" json:"student_id"`
        SubjectID string    `gorm:"type:text;index" json:"subject_id"`
        SessionID string    `gorm:"type:text;index" json:"session_id"`
        Value     float64   `json:"value"` // 0-20
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

// AllModels returns all models for auto-migration.
func AllModels() []interface{} {
        return []interface{}{
                &User{}, &IEP{}, &School{}, &Class{}, &Student{},
                &Subject{}, &EvaluationSession{}, &Grade{}, &ReportCard{},
                &Setting{},
        }
}
