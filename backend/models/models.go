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
	ID                 string  `gorm:"primaryKey;type:text" json:"id"`
	Phone              *string `gorm:"uniqueIndex;type:text" json:"phone,omitempty"`
	Email              *string `gorm:"uniqueIndex;type:text" json:"email,omitempty"`
	Password           string  `gorm:"type:text" json:"-"` // bcrypt hash, never serialized
	FullName           string  `gorm:"type:text" json:"full_name"`
	Role               string  `gorm:"type:text;index" json:"role"`
	IEPID              *string `gorm:"type:text" json:"iep_id,omitempty"`    // inspecteur / admin scope
	SchoolID           *string `gorm:"type:text" json:"school_id,omitempty"` // directeur / teacher scope
	Active             bool    `gorm:"default:true" json:"active"`
	MustChangePassword bool    `gorm:"default:false" json:"must_change_password"` // temp password → user must change on first login
	Service            string  `gorm:"type:text" json:"service,omitempty"`        // service au sein de l'IEP (ex: "Examen & Concours", "Statistique") — pour les Admins IEP
	// === Dossier personnel (module Utilisateurs) ===
	// Champs administratifs du document officiel « ÉTAT NOMINATIF DU
	// PERSONNEL » (une ligne = un agent : directeur ou enseignant).
	// Tous optionnels (les comptes créés avant ce dossier restent valides).
	Matricule      *string    `gorm:"type:text" json:"matricule,omitempty"`
	Sexe           *string    `gorm:"type:text" json:"sexe,omitempty"` // F | G (« N.B : écrire le nom des femmes en rouge »)
	DateNaissance  *time.Time `json:"date_naissance,omitempty"`        // « Date et lieu de naissance »
	LieuNaissance  *string    `gorm:"type:text" json:"lieu_naissance,omitempty"`
	Categorie      *string    `gorm:"type:text" json:"categorie,omitempty"` // IO | IA | IS | IAS
	ClasseGrade    *int       `json:"classe_grade,omitempty"`               // classe administrative 1..4
	Echelon        *int       `json:"echelon,omitempty"`                    // échelon 1..4
	DateEntreeFP   *time.Time `json:"date_entree_fp,omitempty"`             // date d'entrée à la Fonction Publique
	Fonction       *string    `gorm:"type:text" json:"fonction,omitempty"`  // DIRECTEUR | ADJOINT(E)
	DateEntreeDREN *time.Time `json:"date_entree_dren,omitempty"`           // entrée DREN
	DateEntreeIEP  *time.Time `json:"date_entree_iep,omitempty"`            // entrée IEP
	EffectifF      *int       `json:"effectif_f,omitempty"`                 // effectif du cours tenu — Filles
	EffectifG      *int       `json:"effectif_g,omitempty"`                 // effectif du cours tenu — Garçons
	EffectifT      *int       `json:"effectif_t,omitempty"`                 // effectif du cours tenu — Total
	RedoublantF    *int       `json:"redoublant_f,omitempty"`               // redoublants — Filles
	RedoublantG    *int       `json:"redoublant_g,omitempty"`               // redoublants — Garçons
	RedoublantT    *int       `json:"redoublant_t,omitempty"`               // redoublants — Total
	// Architecture D — Suspension (Palier 1)
	SuspendedAt     *time.Time     `gorm:"index" json:"suspended_at,omitempty"`
	SuspendedByID   *string        `gorm:"type:text;index" json:"suspended_by_id,omitempty"`
	SuspendedReason string         `gorm:"type:text" json:"suspended_reason,omitempty"`
	CreatedAt       time.Time      `json:"created_at"`
	UpdatedAt       time.Time      `json:"updated_at"`
	DeletedAt       gorm.DeletedAt `gorm:"index" json:"-"`
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
	ID             string    `gorm:"primaryKey;type:text" json:"id"`
	Name           string    `gorm:"type:text" json:"name"`
	Region         string    `gorm:"type:text" json:"region"`
	InspectorName  string    `gorm:"type:text" json:"inspector_name"`  // Nom + prénom de l'inspecteur titulaire
	InspectorEmail string    `gorm:"type:text" json:"inspector_email"` // Courriel officiel
	InspectorPhone string    `gorm:"type:text" json:"inspector_phone"` // Téléphone officiel
	BP             string    `gorm:"type:text" json:"bp"`              // Boîte postale de l'IEP
	CreatedAt      time.Time `json:"created_at"`
}

func (i *IEP) BeforeCreate(tx *gorm.DB) error {
	if i.ID == "" {
		i.ID = uuid.NewString()
	}
	return nil
}

// === ExamCenter (Centre d'examen) ===
// Lieu de regroupement des écoles pour les examens (documents officiels
// « PLAN D'ACTION PLURIANNUEL DE L'IEPP » : la colonne CENTRES D'EXAMENS
// groupe les lignes écoles). Rattaché à une IEP ; l'ordre d'affichage
// (Position) respecte le classement de l'inspection dans ses documents.
type ExamCenter struct {
	ID        string    `gorm:"primaryKey;type:text" json:"id"`
	IEPID     string    `gorm:"type:text;index" json:"iep_id"`
	Name      string    `gorm:"type:text" json:"name"`     // ex : « BOUBOURY », « DABOU AGNIMEL »
	Position  int       `gorm:"default:0" json:"position"` // ordre d'affichage dans les documents
	CreatedAt time.Time `json:"created_at"`
}

func (c *ExamCenter) BeforeCreate(tx *gorm.DB) error {
	if c.ID == "" {
		c.ID = uuid.NewString()
	}
	return nil
}

// === School ===
type School struct {
	ID      string `gorm:"primaryKey;type:text" json:"id"`
	IEPID   string `gorm:"type:text;index" json:"iep_id"`
	Code    string `gorm:"uniqueIndex;type:text" json:"code"` // code unique identifiant l'école dans le système IEP
	Name    string `gorm:"type:text" json:"name"`
	Address string `gorm:"type:text" json:"address"`
	Status  string `gorm:"type:text;default:public" json:"status"` // public | private | community
	// LogoPath — clé de l'objet logo dans le stockage fichiers (R2 en prod,
	// filesystem en dev). Nullable : NULL = aucun logo. L'URL de lecture
	// (présignée) est calculée par les handlers, jamais stockée.
	LogoPath *string `gorm:"type:text" json:"logo_path,omitempty"`
	// ExamCenterID — centre d'examen de rattachement (documents officiels
	// « PLAN D'ACTION PLURIANNUEL DE L'IEPP » : les écoles y sont groupées
	// par CENTRES D'EXAMENS). Nullable : NULL = école non encore affectée
	// (affichée hors groupe dans les documents IEPP).
	ExamCenterID *string   `gorm:"type:text;index" json:"exam_center_id,omitempty"`
	CreatedAt    time.Time `json:"created_at"`
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
	// === Résultats de fin d'année — compteurs MANUELS du tableau
	// récapitulatif (lignes « Exclus » et « Abandons », colonnes
	// Garçons/Filles ; Total = G+F calculé à l'affichage). Saisis par le
	// conseil des maîtres (listes 1..15), NULL = case vide du document.
	// L'entité Class est pérenne : ces compteurs portent l'année courante
	// et sont réajustables à chaque fin d'année.
	ExclusGarcons   *int `gorm:"type:integer" json:"exclus_garcons,omitempty"`
	ExclusFilles    *int `gorm:"type:integer" json:"exclus_filles,omitempty"`
	AbandonsGarcons *int `gorm:"type:integer" json:"abandons_garcons,omitempty"`
	AbandonsFilles  *int `gorm:"type:integer" json:"abandons_filles,omitempty"`
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
	ID        string  `gorm:"primaryKey;type:text" json:"id"`
	Matricule *string `gorm:"uniqueIndex;type:text" json:"matricule,omitempty"`
	ClassID   string  `gorm:"type:text;index" json:"class_id"`
	FirstName string  `gorm:"type:text" json:"first_name"`
	LastName  string  `gorm:"type:text" json:"last_name"`
	Gender    string  `gorm:"type:text" json:"gender"` // M / F
	// BirthYear — année de naissance seule (format court, ex: 2006).
	// Nullable : NULL = non renseignée (les élèves existants ne sont pas
	// impactés — AutoMigrate ajoute la colonne sans backfill). Le champ
	// BirthDate (date complète ISO) est conservé pour compatibilité API
	// mais n'est pas exposé dans l'UI (champ dormant depuis l'origine).
	BirthYear *int       `gorm:"type:integer" json:"birth_year,omitempty"`
	BirthDate *time.Time `json:"birth_date,omitempty"`
	// === Résultats de fin d'année (document officiel « RESULTATS DE FIN
	// D'ANNEE ») ===
	// ScolariteCours — scolarité dans le cours (années passées dans l'école),
	// liste déroulante 1..10. Nullable : NULL = non renseigné (case vide du
	// document). AutoMigrate ajoute les colonnes sans backfill.
	ScolariteCours *int `gorm:"type:integer" json:"scolarite_cours,omitempty"`
	// ScolariteTotale — scolarité totale (toutes écoles confondues), 1..10.
	ScolariteTotale *int `gorm:"type:integer" json:"scolarite_totale,omitempty"`
	// DecisionConseil — décision du conseil des maîtres :
	//   "A" = Admis, "R" = Redoublant, "ABD" = Abandon.
	// Saisie en fin d'année ; NULL = pas encore statué (case vide).
	DecisionConseil *string   `gorm:"type:text" json:"decision_conseil,omitempty"`
	CreatedAt       time.Time `json:"created_at"`
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
//	draft ──open──► open ──close──► closed ──validate──► validated ──archive──► archived
//	  │                  │
//	  └──cancel──► cancelled
//	                ▲
//	                └── (cancel autorisé depuis open si 0 note saisie, sinon
//	                     suppression explicite des notes avec delete_grades=true)
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
//
//	via Grade.StudentID → Student.ClassID (l'élève sait dans quelle classe il est)
//
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
	Key       string    `gorm:"uniqueIndex;type:text" json:"key"` // ex: "mention.threshold.tres_bien"
	Value     string    `gorm:"type:text" json:"value"`           // stocké en string, converti selon le type
	Category  string    `gorm:"type:text;index" json:"category"`  // ex: "mention", "system", "coefficient"
	Label     string    `gorm:"type:text" json:"label"`           // description lisible
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
	ID          string    `gorm:"primaryKey;type:text" json:"id"`
	Level       string    `gorm:"type:text;index" json:"level"`                // "CP" | "CE" | "CM"
	SubjectID   *string   `gorm:"type:text;index" json:"subject_id,omitempty"` // NULL = défaut du niveau
	SubjectName string    `gorm:"-" json:"subject_name,omitempty"`             // rempli par le handler ( JOIN manuelle)
	MaxScore    int       `gorm:"default:20" json:"max_score"`                 // 10, 20, 30, 50...
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
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
	ClassID   *string   `gorm:"type:text;index" json:"class_id,omitempty"` // NULL = pas une classe précise
	Level     *string   `gorm:"type:text" json:"level,omitempty"`          // "CP"|"CE"|"CM" = tout le niveau
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
	ClassLevel   string    `gorm:"type:text" json:"class_level"`  // CP|CE|CM
	Average      float64   `gorm:"type:numeric" json:"average"`   // moyenne pondérée (sur average_scale)
	AverageScale int       `gorm:"type:int" json:"average_scale"` // 10 (CP/CE) ou 20 (CM)
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
	Identifier   string     `gorm:"type:text" json:"identifier"`                  // email, phone, ou code école
	RoleHint     string     `gorm:"type:text" json:"role_hint"`                   // rôle sélectionné par l'utilisateur
	UserID       *string    `gorm:"type:text" json:"user_id,omitempty"`           // user résolu (si trouvé)
	UserName     string     `gorm:"type:text" json:"user_name,omitempty"`         // nom du user résolu (pour l'admin)
	Status       string     `gorm:"type:text;default:pending" json:"status"`      // pending | approved | rejected
	TempPassword *string    `gorm:"type:text" json:"-"`                           // option 1: mdp temporaire en clair (jamais sérialisé)
	ResetToken   *string    `gorm:"type:text;index" json:"reset_token,omitempty"` // option 2: token pour reset link
	Message      string     `gorm:"type:text" json:"message,omitempty"`           // message optionnel du user
	AdminNote    string     `gorm:"type:text" json:"admin_note,omitempty"`        // note de l'admin
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

// === Role (Architecture D — Dynamic RBAC) ===
// Représente un rôle éditable dans la matrice de permissions. Les 4 rôles
// système (admin, inspector, director, teacher) sont seedés au démarrage et
// ne peuvent pas être supprimés (IsSystem = true).
type Role struct {
	ID          string    `gorm:"primaryKey;type:text" json:"id"`
	Name        string    `gorm:"uniqueIndex;type:text" json:"name"` // "admin", "inspector", "director", "teacher"
	Label       string    `gorm:"type:text" json:"label"`            // "Super Admin", "Admin IEP", etc.
	Description string    `gorm:"type:text" json:"description"`
	IsSystem    bool      `gorm:"default:false" json:"is_system"`
	SortOrder   int       `gorm:"default:0" json:"sort_order"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

func (r *Role) BeforeCreate(tx *gorm.DB) error {
	if r.ID == "" {
		r.ID = uuid.NewString()
	}
	return nil
}

// === RoleModule — cellule de la matrice rôle × module ===
// Représente les permissions d'accès (read/write) d'un rôle sur un module.
// CanRead  = visible dans la nav + peut appeler les GET du module
// CanWrite = peut appeler les POST/PUT/DELETE du module
type RoleModule struct {
	ID        string    `gorm:"primaryKey;type:text" json:"id"`
	RoleID    string    `gorm:"type:text;index" json:"role_id"`
	ModuleKey string    `gorm:"type:text;index" json:"module_key"` // ex: "dashboard", "users", "settings"
	CanRead   bool      `gorm:"default:false" json:"can_read"`
	CanWrite  bool      `gorm:"default:false" json:"can_write"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (rm *RoleModule) BeforeCreate(tx *gorm.DB) error {
	if rm.ID == "" {
		rm.ID = uuid.NewString()
	}
	return nil
}

// === AuditLog — Journal d'audit (Architecture D) ===
// Trace toute action sensible (suspension, changement de permission, création
// de user, validation de session, etc.). Append-only : aucune mise à jour
// ni suppression depuis l'app.
type AuditLog struct {
	ID         string    `gorm:"primaryKey;type:text" json:"id"`
	ActorID    *string   `gorm:"type:text;index" json:"actor_id,omitempty"` // user qui effectue l'action
	ActorRole  string    `gorm:"type:text" json:"actor_role"`               // snapshot du rôle au moment de l'action
	Action     string    `gorm:"type:text;index" json:"action"`             // ex: "user.suspend", "permission.update"
	EntityType string    `gorm:"type:text;index" json:"entity_type"`        // "user", "permission", "session", "setting"
	EntityID   *string   `gorm:"type:text;index" json:"entity_id,omitempty"`
	Details    string    `gorm:"type:text" json:"details,omitempty"` // blob JSON (before/after, reason)
	IP         string    `gorm:"type:text" json:"ip,omitempty"`
	UserAgent  string    `gorm:"type:text" json:"user_agent,omitempty"`
	CreatedAt  time.Time `gorm:"index" json:"created_at"`
}

func (a *AuditLog) BeforeCreate(tx *gorm.DB) error {
	if a.ID == "" {
		a.ID = uuid.NewString()
	}
	return nil
}

// === PDA IEPP — Plan d'Action Pluriannuel (compositions + examens blancs CE/CM) ===
// Reproduction du document officiel « SUIVI DU PLAN D'ACTION PLURIANNUEL
// DE L'IEPP » (niveaux CE et CM) pour TOUTES les évaluations de l'année :
//   - les COMPOSITIONS MENSUELLES (kind="composition") : notes dérivées du
//     module Notes (EvaluationSession + Grade) — aucune double saisie ;
//   - les EXAMENS BLANCS (kind="blanc") : saisie manuelle des 3 notes.
// Objectif : mesurer le niveau de maîtrise de CHAQUE élève dans les 3
// matières désignées (Exploitation de texte, Mathématiques, Dictée) puis
// produire automatiquement les tableaux agrégés du document :
//   Tableau 1 : Présents / Admis / % Admis (Total | Filles | Garçons)
//   Tableau 2 : maîtrise par matière (Présents, Admis, %, Non Admis, %)
//   Tableau 3 : difficultés d'apprentissage + remédiation
// Un élève est « Admis » dans une matière si Present=true ET
// note >= barème × Threshold/100. Barème selon la source :
//   - examen blanc  : barème PDA fixe (CE=/10, CM=/20) ;
//   - composition   : barème réel de la matière pour le niveau (GradeScale,
//     ex: CE=/30, CM=/50, Dictée /20) — les notes de composition sont
//     enregistrées sur ce barème dans le module Notes.

// PDAExam — une évaluation suivie par le plan d'action (composition
// mensuelle ou examen blanc), numérotée par école + année.
const (
	PDAKindBlanc       = "blanc"       // examen blanc — saisie manuelle des 3 notes
	PDAKindComposition = "composition" // composition mensuelle — notes dérivées du module Notes
)

type PDAExam struct {
	ID       string `gorm:"primaryKey;type:text" json:"id"`
	SchoolID string `gorm:"type:text;index" json:"school_id"`
	// Kind — type d'évaluation suivie :
	//   - "blanc"       : examen blanc (saisie manuelle des 3 notes dans le PDA)
	//   - "composition" : composition mensuelle (notes DÉRIVÉES du module Notes
	//     via la session liée — grille PDA en lecture seule)
	Kind string `gorm:"type:text;default:blanc;index" json:"kind"`
	// SessionID — session de composition mensuelle (EvaluationSession) dont
	// les notes alimentent le plan (kind="composition" uniquement).
	SessionID *string    `gorm:"type:text;index" json:"session_id,omitempty"`
	Number    int        `json:"number"`                                    // Composition/Examen Blanc N° 1, 2, 3…
	Year      int        `gorm:"index" json:"year"`                         // année scolaire (ex: 2026)
	ExamDate  *time.Time `gorm:"type:timestamp" json:"exam_date,omitempty"` // date de passage (optionnel, blancs)
	Threshold int        `gorm:"default:50" json:"threshold"`               // seuil de maîtrise en % du barème (ex: 50)
	CreatedAt time.Time  `json:"created_at"`
	UpdatedAt time.Time  `json:"updated_at"`
}

func (p *PDAExam) BeforeCreate(tx *gorm.DB) error {
	if p.ID == "" {
		p.ID = uuid.NewString()
	}
	return nil
}

// PDAResult — résultat individuel d'un élève à un examen blanc du plan.
// Notes = pointeurs : nil = non saisie (affiché « — » et neutre dans les
// agrégats : un élève présent sans note ne compte ni Admis ni Non Admis).
type PDAResult struct {
	ID               string    `gorm:"primaryKey;type:text" json:"id"`
	ExamID           string    `gorm:"type:text;uniqueIndex:idx_pda_results_exam_student" json:"exam_id"`
	StudentID        string    `gorm:"type:text;uniqueIndex:idx_pda_results_exam_student" json:"student_id"`
	Present          bool      `gorm:"default:false" json:"present"`
	NoteExploitation *float64  `gorm:"type:numeric" json:"note_exploitation,omitempty"`
	NoteMath         *float64  `gorm:"type:numeric" json:"note_math,omitempty"`
	NoteDictee       *float64  `gorm:"type:numeric" json:"note_dictee,omitempty"`
	CreatedAt        time.Time `json:"created_at"`
	UpdatedAt        time.Time `json:"updated_at"`
}

func (p *PDAResult) BeforeCreate(tx *gorm.DB) error {
	if p.ID == "" {
		p.ID = uuid.NewString()
	}
	return nil
}

// PDARemediation — compteurs de remédiation (lignes 2-3 du tableau 3 du
// document : élèves ayant bénéficié des cours de mise à niveau + élèves
// ayant bénéficié des mécanismes de remédiation). Ces effectifs ne sont
// pas dérivables des notes : saisie manuelle par classe et par examen.
type PDARemediation struct {
	ID                 string    `gorm:"primaryKey;type:text" json:"id"`
	ExamID             string    `gorm:"type:text;uniqueIndex:idx_pda_remediation_exam_class" json:"exam_id"`
	ClassID            string    `gorm:"type:text;uniqueIndex:idx_pda_remediation_exam_class" json:"class_id"`
	MiseANiveauTotal   int       `gorm:"default:0" json:"mise_a_niveau_total"`
	MiseANiveauGarcons int       `gorm:"default:0" json:"mise_a_niveau_garcons"`
	MiseANiveauFilles  int       `gorm:"default:0" json:"mise_a_niveau_filles"`
	RemediationTotal   int       `gorm:"default:0" json:"remediation_total"`
	RemediationGarcons int       `gorm:"default:0" json:"remediation_garcons"`
	RemediationFilles  int       `gorm:"default:0" json:"remediation_filles"`
	UpdatedAt          time.Time `json:"updated_at"`
}

func (p *PDARemediation) BeforeCreate(tx *gorm.DB) error {
	if p.ID == "" {
		p.ID = uuid.NewString()
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
		// Architecture D — Dynamic RBAC + Audit
		&Role{}, &RoleModule{}, &AuditLog{},
		// PDA IEPP — Plan d'Action Pluriannuel (examens blancs CE/CM)
		&PDAExam{}, &PDAResult{}, &PDARemediation{},
		// Centres d'examen — regroupement des écoles dans les
		// documents officiels du plan (colonne CENTRES D'EXAMENS)
		&ExamCenter{},
	}
}
