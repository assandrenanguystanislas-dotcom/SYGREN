package handlers

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"sygren-api/database"
	"sygren-api/middleware"
	"sygren-api/models"

	"github.com/go-chi/chi/v5"
)

// === Sessions de saisie mensuelles (cahier des charges §3 Module 2) ===
//
// Approche A — 1 session par ÉCOLE (pas par classe).
// Toutes les classes actives de l'école participent à la session, sauf celles
// exemptées via la table SessionExemption (par class_id précis ou par niveau
// CP/CE/CM). Cela évite de créer 6 sessions par évaluation (une par classe)
// et centralise le cycle de vie au niveau de l'école.
//
// Cycle de vie complet d'une session :
//
//   draft ──open──► open ──close──► closed ──validate──► validated ──archive──► archived
//     │                  │
//     └──cancel──► cancelled
//                   ▲
//                   └── (cancel autorisé depuis draft librement, depuis open si
//                        0 note saisie — sinon suppression explicite des notes
//                        avec delete_grades=true dans le payload d'annulation)
//
// Statuts terminaux (lecture seule) :
//   - cancelled : session annulée. Les notes sont supprimées au moment de
//     l'annulation. Conservée pour l'audit (qui/quand/pourquoi).
//   - archived  : session validée puis archivée. Les notes sont CONSERVÉES et
//     restent utilisées par le bilan annuel élève + la comparaison inter-annuelle.
//     Masquée de l'UI active par défaut (include_archived=false sur ListSessions).
//     L'archivage peut être manuel (ArchiveSession) ou automatique (cron de
//     fin d'année scolaire dans main.go).
//
// RBAC :
//   - admin, director : peuvent ouvrir/fermer/valider/annuler/archiver les
//     sessions de leur périmètre (director = son école uniquement)
//   - teacher : peut consulter les sessions de son école + saisir si statut=open
//   - inspector : lecture seule

// SessionWithDetails — session enrichie
type SessionWithDetails struct {
	models.EvaluationSession
	SchoolName     string  `json:"school_name,omitempty"`
	ClassCount     int64   `json:"class_count"`
	StudentCount   int64   `json:"student_count"`
	SubjectCount   int64   `json:"subject_count"`
	GradedCount    int64   `json:"graded_count"`
	DraftCount     int64   `json:"draft_count"`
	CompletionRate float64 `json:"completion_rate"`
	ExemptionCount int64   `json:"exemption_count"`
}

// ListSessions returns sessions filtered by user scope.
// Avec l'Approche A, les sessions sont rattachées à une école (school_id).
// Le filtrage par périmètre se fait via JOIN schools (pour l'IEP) ou directement
// par school_id (pour le director/teacher).
func ListSessions(w http.ResponseWriter, r *http.Request) {
	role := ctxRole(r)
	query := database.DB.Model(&models.EvaluationSession{}).
		Joins("JOIN schools ON schools.id = evaluation_sessions.school_id")

	switch role {
	case "inspector":
		iepID := ctxIEPID(r)
		if iepID == "" {
			jsonResponse(w, http.StatusOK, map[string]interface{}{"sessions": []interface{}{}, "count": 0})
			return
		}
		query = query.Where("schools.iep_id = ?", iepID)
	case "director":
		schoolID := ctxSchoolID(r)
		if schoolID == "" {
			jsonResponse(w, http.StatusOK, map[string]interface{}{"sessions": []interface{}{}, "count": 0})
			return
		}
		query = query.Where("evaluation_sessions.school_id = ?", schoolID)
	case "teacher":
		// L'enseignant voit les sessions de son école
		schoolID := ctxSchoolID(r)
		if schoolID == "" {
			// Pas de school_id dans le JWT : fallback via une classe enseignée
			userID := ctxUserID(r)
			var cls models.Class
			if err := database.DB.First(&cls, "teacher_id = ?", userID).Error; err != nil {
				jsonResponse(w, http.StatusOK, map[string]interface{}{"sessions": []interface{}{}, "count": 0})
				return
			}
			schoolID = cls.SchoolID
		}
		query = query.Where("evaluation_sessions.school_id = ?", schoolID)
	}

	// Filtres optionnels : année, mois, école
	if v := r.URL.Query().Get("year"); v != "" {
		query = query.Where("evaluation_sessions.year = ?", v)
	}
	if v := r.URL.Query().Get("month"); v != "" {
		query = query.Where("evaluation_sessions.month = ?", v)
	}
	if v := r.URL.Query().Get("school_id"); v != "" {
		query = query.Where("evaluation_sessions.school_id = ?", v)
	}

	// Filtres d'archivage/annulation :
	//   - Par défaut (sans paramètre), on masque les sessions cancelled et
	//     archived pour garder l'UI active propre. C'est le comportement
	//     attendu : les sessions terminées ne polluent pas la liste active.
	//   - include_archived=true  → inclut les sessions archivées
	//   - include_cancelled=true → inclut les sessions annulées
	//   - Le filtre "toutes" (include_archived=true&include_cancelled=true)
	//     affiche tout, utile pour la vue Archives / l'audit.
	includeArchived := r.URL.Query().Get("include_archived") == "true"
	includeCancelled := r.URL.Query().Get("include_cancelled") == "true"
	if !includeArchived {
		query = query.Where("evaluation_sessions.status != ?", "archived")
	}
	if !includeCancelled {
		query = query.Where("evaluation_sessions.status != ?", "cancelled")
	}

	var sessions []models.EvaluationSession
	if err := query.Order("evaluation_sessions.year DESC, evaluation_sessions.month DESC").Find(&sessions).Error; err != nil {
		middleware.JSONError(w, "erreur récupération sessions", http.StatusInternalServerError)
		return
	}

	result := make([]SessionWithDetails, 0, len(sessions))
	for _, s := range sessions {
		var d SessionWithDetails
		d.EvaluationSession = s
		// Détails de l'école
		var school models.School
		if err := database.DB.First(&school, "id = ?", s.SchoolID).Error; err == nil {
			d.SchoolName = school.Name
		}
		// Classes actives de l'école
		var classCount, studentCount int64
		database.DB.Model(&models.Class{}).
			Where("school_id = ? AND active = ?", s.SchoolID, true).Count(&classCount)
		d.ClassCount = classCount
		// Élèves de l'école (via JOIN classes)
		database.DB.Model(&models.Student{}).
			Joins("JOIN classes ON classes.id = students.class_id").
			Where("classes.school_id = ? AND classes.active = ?", s.SchoolID, true).
			Count(&studentCount)
		d.StudentCount = studentCount
		// Comptages
		database.DB.Model(&models.Subject{}).Count(&d.SubjectCount)
		database.DB.Model(&models.Grade{}).Where("session_id = ?", s.ID).Count(&d.GradedCount)
		database.DB.Model(&models.Grade{}).Where("session_id = ? AND is_draft = true", s.ID).Count(&d.DraftCount)
		database.DB.Model(&models.SessionExemption{}).Where("session_id = ?", s.ID).Count(&d.ExemptionCount)

		// Taux de complétion
		expected := d.StudentCount * d.SubjectCount
		if expected > 0 {
			d.CompletionRate = float64(d.GradedCount) / float64(expected) * 100
		}
		result = append(result, d)
	}

	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"sessions": result,
		"count":    len(result),
	})
}

// CreateSessionRequest — payload pour créer une session
// Avec l'Approche A, SchoolID remplace ClassID : une session couvre toute
// l'école (les classes CP1, CP2, CE1, CE2, CM1, CM2 participent toutes, sauf
// exemptions explicites via SessionExemption).
type CreateSessionRequest struct {
	SchoolID   string `json:"school_id"`
	Month      int    `json:"month"`
	Year       int    `json:"year"`
	Status     string `json:"status"`
	EvalType   string `json:"eval_type"`
	EvalNumber int    `json:"eval_number"`
	OpenAt     string `json:"open_at"`  // ISO 8601 : "2026-01-15T08:00:00Z"
	CloseAt    string `json:"close_at"` // ISO 8601
	AutoOpen   bool   `json:"auto_open"`
}

// CreateSession creates a new evaluation session for a school.
// RBAC :
//   - admin : toutes les écoles
//   - director : uniquement son école
//   - inspector/teacher : pas de création (403)
func CreateSession(w http.ResponseWriter, r *http.Request) {
	defer InvalidateDashboardCache() // Fix C: écriture session → invalidate cache dashboard
	var req CreateSessionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		middleware.JSONError(w, "payload invalide", http.StatusBadRequest)
		return
	}
	if req.SchoolID == "" || req.Month < 1 || req.Month > 12 || req.Year < 2020 {
		middleware.JSONError(w, "school_id, month (1-12) et year requis", http.StatusBadRequest)
		return
	}
	if req.EvalType == "" {
		req.EvalType = "composition"
	}
	if req.EvalType != "composition" && req.EvalType != "exam_blanc" {
		middleware.JSONError(w, "eval_type invalide (composition|exam_blanc)", http.StatusBadRequest)
		return
	}
	if req.EvalNumber < 1 {
		req.EvalNumber = 1
	}
	if req.OpenAt == "" || req.CloseAt == "" {
		middleware.JSONError(w, "open_at et close_at sont obligatoires (format ISO 8601)", http.StatusBadRequest)
		return
	}
	openAt, err := time.Parse(time.RFC3339, req.OpenAt)
	if err != nil {
		middleware.JSONError(w, "open_at invalide (format ISO 8601 attendu, ex: 2026-01-15T08:00:00Z)", http.StatusBadRequest)
		return
	}
	closeAt, err := time.Parse(time.RFC3339, req.CloseAt)
	if err != nil {
		middleware.JSONError(w, "close_at invalide (format ISO 8601 attendu)", http.StatusBadRequest)
		return
	}
	if !closeAt.After(openAt) {
		middleware.JSONError(w, "close_at doit être après open_at", http.StatusBadRequest)
		return
	}

	// Vérifier que l'école existe
	var school models.School
	if err := database.DB.First(&school, "id = ?", req.SchoolID).Error; err != nil {
		middleware.JSONError(w, "école introuvable", http.StatusBadRequest)
		return
	}

	// RBAC : director ne peut créer que pour son école
	role := ctxRole(r)
	if role == "director" {
		if ctxSchoolID(r) == "" || req.SchoolID != ctxSchoolID(r) {
			middleware.JSONError(w, "vous ne pouvez créer des sessions que pour votre école", http.StatusForbidden)
			return
		}
	}

	// Unicité : 1 session par (école, année, type, numéro)
	var count int64
	database.DB.Model(&models.EvaluationSession{}).
		Where("school_id = ? AND year = ? AND eval_type = ? AND eval_number = ?",
			req.SchoolID, req.Year, req.EvalType, req.EvalNumber).
		Count(&count)
	if count > 0 {
		middleware.JSONError(w, fmt.Sprintf("une session %s N°%d existe déjà pour cette école/année",
			evalTypeLabel(req.EvalType), req.EvalNumber), http.StatusConflict)
		return
	}

	// Statut : si AutoOpen et openAt dans le futur → draft, sinon open
	status := "open"
	if req.AutoOpen && openAt.After(time.Now()) {
		status = "draft"
	}
	if req.Status != "" {
		status = req.Status
	}

	session := models.EvaluationSession{
		SchoolID:   req.SchoolID,
		Month:      req.Month,
		Year:       req.Year,
		Status:     status,
		EvalType:   req.EvalType,
		EvalNumber: req.EvalNumber,
		OpenAt:     &openAt,
		CloseAt:    &closeAt,
		AutoOpen:   req.AutoOpen,
	}
	if err := database.DB.Create(&session).Error; err != nil {
		middleware.JSONError(w, "erreur création session", http.StatusInternalServerError)
		return
	}

	// Examen Blanc : seul le CM2 passe l'Examen Blanc. On exempté
	// automatiquement toutes les autres classes (CP1, CP2, CE1, CE2, CM1)
	// pour qu'elles n'apparaissent pas dans les résultats ni la saisie.
	if req.EvalType == "exam_blanc" {
		var classes []models.Class
		database.DB.Where("school_id = ? AND active = ? AND name != ?", req.SchoolID, true, "CM2").Find(&classes)
		for _, c := range classes {
			exemption := models.SessionExemption{
				SessionID: session.ID,
				ClassID:   &c.ID,
				Level:     &c.Level,
				Reason:    "Examen Blanc réservé au CM2 — classe non concernée",
			}
			database.DB.Create(&exemption)
		}
		if len(classes) > 0 {
			log.Printf("[SESSION] Examen Blanc : %d classe(s) exemptée(s) automatiquement (CP1-CM1)", len(classes))
		}
	}

	jsonResponse(w, http.StatusCreated, session)
}

// ExtendSessionRequest — payload pour prolonger une session
type ExtendSessionRequest struct {
	NewCloseAt string `json:"new_close_at"` // ISO 8601
}

// ExtendSession prolonge la date de clôture d'une session.
// RBAC : admin + director (son école uniquement).
// Avec l'Approche A, la vérification se fait directement sur session.SchoolID
// (pas de lookup classe intermédiaire).
func ExtendSession(w http.ResponseWriter, r *http.Request) {
	defer InvalidateDashboardCache() // Fix C: écriture session → invalidate cache dashboard
	id := chi.URLParam(r, "id")
	var req ExtendSessionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		middleware.JSONError(w, "payload invalide", http.StatusBadRequest)
		return
	}
	newCloseAt, err := time.Parse(time.RFC3339, req.NewCloseAt)
	if err != nil {
		middleware.JSONError(w, "new_close_at invalide (format ISO 8601)", http.StatusBadRequest)
		return
	}

	var session models.EvaluationSession
	if err := database.DB.First(&session, "id = ?", id).Error; err != nil {
		middleware.JSONError(w, "session introuvable", http.StatusNotFound)
		return
	}

	// RBAC : director ne peut prolonger que les sessions de son école
	role := ctxRole(r)
	if role == "director" {
		schoolID := ctxSchoolID(r)
		if schoolID == "" || session.SchoolID != schoolID {
			middleware.JSONError(w, "accès refusé : vous ne pouvez prolonger que les sessions de votre école", http.StatusForbidden)
			return
		}
	}

	// Validation : la nouvelle date doit être dans le futur ET après l'actuelle
	if !newCloseAt.After(time.Now()) {
		middleware.JSONError(w, "la nouvelle date de clôture doit être dans le futur", http.StatusBadRequest)
		return
	}
	if session.CloseAt != nil && !newCloseAt.After(*session.CloseAt) {
		middleware.JSONError(w, "la nouvelle date doit être après la date de clôture actuelle", http.StatusBadRequest)
		return
	}

	session.CloseAt = &newCloseAt
	session.UpdatedAt = time.Now()
	if err := database.DB.Save(&session).Error; err != nil {
		middleware.JSONError(w, "erreur mise à jour", http.StatusInternalServerError)
		return
	}
	jsonResponse(w, http.StatusOK, session)
}

// BulkCreateSessionRequest — payload pour créer des sessions en masse
// Scope : "all" (toutes les écoles) ou "school" (une école par code)
// Pour "school", SchoolCode doit être fourni (lookup par code unique)
//
// Avec l'Approche A, on crée 1 session par ÉCOLE (au lieu d'1 par classe).
// Cela réduit drastiquement le nombre de sessions : 6 classes → 1 session.
type BulkCreateSessionRequest struct {
	Scope      string `json:"scope"`       // "all" | "school"
	SchoolCode string `json:"school_code"` // requis si scope="school"
	Month      int    `json:"month"`
	Year       int    `json:"year"`
	EvalType   string `json:"eval_type"`
	EvalNumber int    `json:"eval_number"`
	OpenAt     string `json:"open_at"`
	CloseAt    string `json:"close_at"`
	AutoOpen   bool   `json:"auto_open"`
}

// BulkCreateSessions crée 1 session par école dans le scope.
// admin : scope "all" (toutes écoles) ou "school" (une école par code)
// director : scope forcé à "school" (son école, code ignoré)
// Returns : nombre de sessions créées + liste des écoles pour lesquelles une
// session existe déjà (skipped) ou dont la création a échoué (failed).
func BulkCreateSessions(w http.ResponseWriter, r *http.Request) {
	defer InvalidateDashboardCache() // Fix C: écriture session → invalidate cache dashboard
	var req BulkCreateSessionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		middleware.JSONError(w, "payload invalide", http.StatusBadRequest)
		return
	}
	if req.Month < 1 || req.Month > 12 || req.Year < 2020 {
		middleware.JSONError(w, "month (1-12) et year requis", http.StatusBadRequest)
		return
	}
	if req.EvalType == "" {
		req.EvalType = "composition"
	}
	if req.EvalType != "composition" && req.EvalType != "exam_blanc" {
		middleware.JSONError(w, "eval_type invalide (composition|exam_blanc)", http.StatusBadRequest)
		return
	}
	if req.EvalNumber < 1 {
		req.EvalNumber = 1
	}
	if req.OpenAt == "" || req.CloseAt == "" {
		middleware.JSONError(w, "open_at et close_at sont obligatoires", http.StatusBadRequest)
		return
	}
	openAt, err := time.Parse(time.RFC3339, req.OpenAt)
	if err != nil {
		middleware.JSONError(w, "open_at invalide (ISO 8601)", http.StatusBadRequest)
		return
	}
	closeAt, err := time.Parse(time.RFC3339, req.CloseAt)
	if err != nil {
		middleware.JSONError(w, "close_at invalide (ISO 8601)", http.StatusBadRequest)
		return
	}
	if !closeAt.After(openAt) {
		middleware.JSONError(w, "close_at doit être après open_at", http.StatusBadRequest)
		return
	}

	role := ctxRole(r)

	// Déterminer le périmètre des écoles
	var schools []models.School
	query := database.DB

	switch role {
	case "admin":
		if req.Scope == "school" {
			if req.SchoolCode == "" {
				middleware.JSONError(w, "school_code requis quand scope=school", http.StatusBadRequest)
				return
			}
			// Lookup école par code
			query = query.Where("code = ?", req.SchoolCode)
		}
		// scope="all" → pas de filtre supplémentaire (toutes les écoles)
	case "director":
		// Director forcé à son école, scope ignoré
		schoolID := ctxSchoolID(r)
		if schoolID == "" {
			middleware.JSONError(w, "vous n'êtes rattaché à aucune école", http.StatusForbidden)
			return
		}
		query = query.Where("id = ?", schoolID)
	default:
		middleware.JSONError(w, "accès refusé", http.StatusForbidden)
		return
	}

	if err := query.Order("name ASC").Find(&schools).Error; err != nil {
		middleware.JSONError(w, "erreur récupération écoles", http.StatusInternalServerError)
		return
	}

	// Statut initial
	status := "open"
	if req.AutoOpen && openAt.After(time.Now()) {
		status = "draft"
	}

	created := 0
	skipped := []string{}
	failed := []string{}

	for _, sch := range schools {
		// Unicité : 1 session par (école, année, type, numéro)
		var count int64
		database.DB.Model(&models.EvaluationSession{}).
			Where("school_id = ? AND year = ? AND eval_type = ? AND eval_number = ?",
				sch.ID, req.Year, req.EvalType, req.EvalNumber).
			Count(&count)
		if count > 0 {
			skipped = append(skipped, sch.Name)
			continue
		}

		session := models.EvaluationSession{
			SchoolID:   sch.ID,
			Month:      req.Month,
			Year:       req.Year,
			Status:     status,
			EvalType:   req.EvalType,
			EvalNumber: req.EvalNumber,
			OpenAt:     &openAt,
			CloseAt:    &closeAt,
			AutoOpen:   req.AutoOpen,
		}
		if err := database.DB.Create(&session).Error; err != nil {
			failed = append(failed, sch.Name)
			continue
		}

		// Examen Blanc : exempter automatiquement les classes non-CM2
		if req.EvalType == "exam_blanc" {
			var classes []models.Class
			database.DB.Where("school_id = ? AND active = ? AND name != ?", sch.ID, true, "CM2").Find(&classes)
			for _, c := range classes {
				exemption := models.SessionExemption{
					SessionID: session.ID,
					ClassID:   &c.ID,
					Level:     &c.Level,
					Reason:    "Examen Blanc réservé au CM2 — classe non concernée",
				}
				database.DB.Create(&exemption)
			}
		}

		created++
	}

	jsonResponse(w, http.StatusCreated, map[string]interface{}{
		"status":        "ok",
		"created":       created,
		"skipped":       skipped,
		"failed":        failed,
		"total_schools": len(schools),
	})
}

// === Exemptions — dispenser des classes/niveaux d'une session ===
//
// Une exemption permet d'exclure une classe précise (ClassID) ou un niveau
// entier (Level = CP|CE|CM) d'une session. Par exemple, pour un Examen Blanc
// réservé au CM2, on peut exempter les niveaux CP et CE + la classe CM1.
//
// Le helper isExempted(sessionID, classID, level) est utilisé par les handlers
// de notes et de calcul pour ignorer les élèves exemptés.

// ExemptionWithDetails — exemption enrichie du nom de la classe (si applicable)
type ExemptionWithDetails struct {
	models.SessionExemption
	ClassName string `json:"class_name,omitempty"` // rempli si ClassID défini
}

// ListExemptions returns all exemptions for a session.
// GET /api/sessions/{id}/exemptions
func ListExemptions(w http.ResponseWriter, r *http.Request) {
	sessionID := chi.URLParam(r, "id")
	if sessionID == "" {
		middleware.JSONError(w, "id de session requis", http.StatusBadRequest)
		return
	}
	// Vérifier l'accès à la session (RBAC par périmètre)
	if _, err := getSessionForUser(r, sessionID); err != nil {
		middleware.JSONError(w, err.Error(), http.StatusForbidden)
		return
	}
	var exemptions []models.SessionExemption
	if err := database.DB.Where("session_id = ?", sessionID).
		Order("created_at DESC").Find(&exemptions).Error; err != nil {
		middleware.JSONError(w, "erreur récupération exemptions", http.StatusInternalServerError)
		return
	}
	result := make([]ExemptionWithDetails, 0, len(exemptions))
	for _, e := range exemptions {
		ed := ExemptionWithDetails{SessionExemption: e}
		if e.ClassID != nil && *e.ClassID != "" {
			var cls models.Class
			if err := database.DB.First(&cls, "id = ?", *e.ClassID).Error; err == nil {
				ed.ClassName = cls.Name
			}
		}
		result = append(result, ed)
	}
	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"exemptions": result,
		"count":      len(result),
	})
}

// CreateExemptionRequest — payload pour créer une exemption
// Au moins un de class_id / level doit être fourni. Les deux peuvent être
// cumulés pour exempter une classe précise ET documenter le niveau concerné.
type CreateExemptionRequest struct {
	ClassID *string `json:"class_id,omitempty"` // optionnel : exemption d'une classe précise
	Level   *string `json:"level,omitempty"`    // optionnel : exemption d'un niveau (CP|CE|CM)
	Reason  string  `json:"reason"`
}

// CreateExemption creates a new exemption for a session.
// POST /api/sessions/{id}/exemptions
// RBAC : admin + director (son école).
func CreateExemption(w http.ResponseWriter, r *http.Request) {
	defer InvalidateDashboardCache() // Fix C: écriture exemption → invalidate cache dashboard
	sessionID := chi.URLParam(r, "id")
	if sessionID == "" {
		middleware.JSONError(w, "id de session requis", http.StatusBadRequest)
		return
	}
	var req CreateExemptionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		middleware.JSONError(w, "payload invalide", http.StatusBadRequest)
		return
	}
	classIDProvided := req.ClassID != nil && *req.ClassID != ""
	levelProvided := req.Level != nil && *req.Level != ""
	if !classIDProvided && !levelProvided {
		middleware.JSONError(w, "class_id ou level est requis", http.StatusBadRequest)
		return
	}
	if levelProvided {
		switch *req.Level {
		case "CP", "CE", "CM":
			// OK
		default:
			middleware.JSONError(w, "level invalide (CP|CE|CM)", http.StatusBadRequest)
			return
		}
	}

	// Vérifier l'accès à la session (RBAC par périmètre)
	session, err := getSessionForUser(r, sessionID)
	if err != nil {
		middleware.JSONError(w, err.Error(), http.StatusForbidden)
		return
	}
	// Vérifier que la classe (si fournie) appartient bien à l'école de la session
	if classIDProvided {
		var cls models.Class
		if err := database.DB.First(&cls, "id = ?", *req.ClassID).Error; err != nil {
			middleware.JSONError(w, "classe introuvable", http.StatusBadRequest)
			return
		}
		if cls.SchoolID != session.SchoolID {
			middleware.JSONError(w, "la classe doit appartenir à l'école de la session", http.StatusBadRequest)
			return
		}
	}

	// Vérifier l'unicité : pas de doublon (session_id, class_id, level)
	dupeQuery := database.DB.Model(&models.SessionExemption{}).Where("session_id = ?", sessionID)
	if classIDProvided {
		dupeQuery = dupeQuery.Where("class_id = ?", *req.ClassID)
	} else {
		dupeQuery = dupeQuery.Where("class_id IS NULL")
	}
	if levelProvided {
		dupeQuery = dupeQuery.Where("level = ?", *req.Level)
	} else {
		dupeQuery = dupeQuery.Where("level IS NULL")
	}
	var count int64
	dupeQuery.Count(&count)
	if count > 0 {
		middleware.JSONError(w, "cette exemption existe déjà", http.StatusConflict)
		return
	}

	exemption := models.SessionExemption{
		SessionID: sessionID,
		ClassID:   req.ClassID,
		Level:     req.Level,
		Reason:    req.Reason,
	}
	if err := database.DB.Create(&exemption).Error; err != nil {
		middleware.JSONError(w, "erreur création exemption", http.StatusInternalServerError)
		return
	}
	jsonResponse(w, http.StatusCreated, exemption)
}

// DeleteExemption removes an exemption from a session.
// DELETE /api/sessions/{id}/exemptions/{eid}
// RBAC : admin + director (son école).
func DeleteExemption(w http.ResponseWriter, r *http.Request) {
	defer InvalidateDashboardCache() // Fix C: écriture exemption → invalidate cache dashboard
	sessionID := chi.URLParam(r, "id")
	exemptionID := chi.URLParam(r, "eid")
	if sessionID == "" || exemptionID == "" {
		middleware.JSONError(w, "id de session et eid requis", http.StatusBadRequest)
		return
	}
	// Vérifier l'accès à la session (RBAC par périmètre)
	if _, err := getSessionForUser(r, sessionID); err != nil {
		middleware.JSONError(w, err.Error(), http.StatusForbidden)
		return
	}
	var exemption models.SessionExemption
	if err := database.DB.First(&exemption, "id = ? AND session_id = ?", exemptionID, sessionID).Error; err != nil {
		middleware.JSONError(w, "exemption introuvable", http.StatusNotFound)
		return
	}
	if err := database.DB.Delete(&exemption).Error; err != nil {
		middleware.JSONError(w, "erreur suppression exemption", http.StatusInternalServerError)
		return
	}
	jsonResponse(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// isExempted vérifie si une classe (par classID ou level) est exemptée d'une
// session. Une exemption peut porter sur :
//   - une classe précise (ClassID non nil) → exemption si *ClassID == classID
//   - un niveau (Level non nil) → exemption si *Level == level
//
// Les deux conditions sont évaluées en OU logique sur l'ensemble des
// exemptions de la session (n'importe quelle exemption qui match suffit).
// isExemptedList vérifie si une classe/niveau est exempté à partir d'une liste
// d'exemptions DÉJÀ CHARGÉE (pas de requête DB). Utilisé par computeSessionResults
// (Fix D) qui charge les exemptions 1× par session au lieu de 1× par classe.
func isExemptedList(exemptions []models.SessionExemption, classID, level string) bool {
	for _, e := range exemptions {
		if e.ClassID != nil && classID != "" && *e.ClassID == classID {
			return true
		}
		if e.Level != nil && level != "" && *e.Level == level {
			return true
		}
	}
	return false
}

func isExempted(sessionID, classID, level string) bool {
	var exemptions []models.SessionExemption
	if err := database.DB.Where("session_id = ?", sessionID).Find(&exemptions).Error; err != nil {
		return false
	}
	return isExemptedList(exemptions, classID, level)
}

// evalTypeLabel retourne le label lisible d'un type d'évaluation
func evalTypeLabel(t string) string {
	switch t {
	case "exam_blanc":
		return "Examen Blanc"
	default:
		return "Composition"
	}
}

// UpdateSessionStatus changes the status of a session.
// Transitions valides : draft→open→closed→validated (pas de retour arrière).
// Les statuts terminaux "cancelled" et "archived" ne sont pas atteignables
// via cet endpoint — ils passent par CancelSession / ArchiveSession dédiés
// (qui portent leur propre métadonnée : raison, auteur, horodatage).
func UpdateSessionStatus(w http.ResponseWriter, r *http.Request) {
	defer InvalidateDashboardCache() // Fix C: écriture session → invalidate cache dashboard
	id := chi.URLParam(r, "id")
	var req struct {
		Status string `json:"status"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		middleware.JSONError(w, "payload invalide", http.StatusBadRequest)
		return
	}

	var session models.EvaluationSession
	if err := database.DB.First(&session, "id = ?", id).Error; err != nil {
		middleware.JSONError(w, "session introuvable", http.StatusNotFound)
		return
	}

	// Les statuts terminaux ne peuvent plus évoluer via cet endpoint.
	// Pour sortir de cancelled/archived, il n'y a pas de retour arrière
	// (ce sont des états finaux). L'admin doit recréer une session si besoin.
	if session.Status == "cancelled" {
		middleware.JSONError(w, "session annulée — modification impossible (statut terminal)", http.StatusConflict)
		return
	}
	if session.Status == "archived" {
		middleware.JSONError(w, "session archivée — modification impossible (statut terminal)", http.StatusConflict)
		return
	}

	// Vérifier la transition
	validNext := map[string]string{
		"draft":  "open",
		"open":   "closed",
		"closed": "validated",
	}
	expected, canTransition := validNext[session.Status]
	if !canTransition {
		middleware.JSONError(w, "session déjà validée, modification impossible", http.StatusConflict)
		return
	}
	if req.Status != expected {
		middleware.JSONError(w, "transition invalide : "+session.Status+" → "+req.Status+" (attendu : "+expected+")", http.StatusBadRequest)
		return
	}

	session.Status = req.Status
	session.UpdatedAt = time.Now()
	if err := database.DB.Save(&session).Error; err != nil {
		middleware.JSONError(w, "erreur mise à jour", http.StatusInternalServerError)
		return
	}

	// Si validation : marquer toutes les notes comme non-brouillon
	if req.Status == "validated" {
		database.DB.Model(&models.Grade{}).
			Where("session_id = ?", session.ID).
			Update("is_draft", false)
	}

	jsonResponse(w, http.StatusOK, session)
}

// DeleteSession removes a session and its grades + exemptions (admin only).
func DeleteSession(w http.ResponseWriter, r *http.Request) {
	defer InvalidateDashboardCache() // Fix C: écriture session → invalidate cache dashboard
	id := chi.URLParam(r, "id")
	// Supprimer d'abord les notes et exemptions associées
	database.DB.Where("session_id = ?", id).Delete(&models.Grade{})
	database.DB.Where("session_id = ?", id).Delete(&models.SessionExemption{})
	if err := database.DB.Delete(&models.EvaluationSession{}, "id = ?", id).Error; err != nil {
		middleware.JSONError(w, "erreur suppression", http.StatusInternalServerError)
		return
	}
	jsonResponse(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// === Annulation & Archivage (statuts terminaux) ===
//
// Ces deux opérations sont SOFT : elles ne suppriment pas la session, elles
// la font passer dans un état terminal (cancelled / archived). La session
// reste visible pour l'audit pédagogique et (pour archived) continue de
// nourrir le bilan annuel élève + la comparaison inter-annuelle.
//
// Rationale : le "manque d'espace" n'est pas un vrai problème (Postgres gère
// des dizaines de Mo/an sans peine). Le vrai besoin — une UI propre — se règle
// par filtrage (ListSessions masque cancelled/archived par défaut) + archivage,
// sans destruction de données. Voir discussion approche A + exemptions.

// CancelSessionRequest — payload pour annuler une session
type CancelSessionRequest struct {
	Reason       string `json:"reason"`        // obligatoire (motif d'annulation)
	DeleteGrades bool   `json:"delete_grades"` // si true, supprime les notes saisies
}

// CancelSession annule une session programmée.
// PUT /api/sessions/{id}/cancel
// RBAC : admin + director (son école).
//
// Règles :
//   - Autorisé depuis "draft" librement (pas de note saisie possible en draft).
//   - Autorisé depuis "open" :
//   - si 0 note saisie → annulation directe
//   - si notes présentes → requiert delete_grades=true (sinon 409 Conflict
//     avec le nombre de notes concernées). Les notes sont alors supprimées.
//   - Refusé depuis "closed" / "validated" : ces sessions ont déjà été saisies
//     et doivent être archivées (pas annulées). Renvoie 409 Conflict avec
//     un message explicatif.
//   - Refusé depuis "cancelled" / "archived" (déjà terminal) → 409 Conflict.
func CancelSession(w http.ResponseWriter, r *http.Request) {
	defer InvalidateDashboardCache() // Fix C: écriture session → invalidate cache dashboard
	id := chi.URLParam(r, "id")
	var req CancelSessionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		middleware.JSONError(w, "payload invalide", http.StatusBadRequest)
		return
	}
	if strings.TrimSpace(req.Reason) == "" {
		middleware.JSONError(w, "reason (motif d'annulation) est obligatoire", http.StatusBadRequest)
		return
	}

	var session models.EvaluationSession
	if err := database.DB.First(&session, "id = ?", id).Error; err != nil {
		middleware.JSONError(w, "session introuvable", http.StatusNotFound)
		return
	}

	// RBAC : director ne peut annuler que les sessions de son école
	role := ctxRole(r)
	if role == "director" {
		schoolID := ctxSchoolID(r)
		if schoolID == "" || session.SchoolID != schoolID {
			middleware.JSONError(w, "accès refusé : vous ne pouvez annuler que les sessions de votre école", http.StatusForbidden)
			return
		}
	}

	// Vérifier le statut courant
	switch session.Status {
	case "closed", "validated":
		middleware.JSONError(w,
			"annulation impossible : session déjà "+session.Status+
				" (utilisez l'archivage pour les sessions validées)", http.StatusConflict)
		return
	case "cancelled":
		middleware.JSONError(w, "session déjà annulée", http.StatusConflict)
		return
	case "archived":
		middleware.JSONError(w, "session déjà archivée — annulation impossible", http.StatusConflict)
		return
	case "draft", "open":
		// OK — autorisé
	default:
		middleware.JSONError(w, "statut inattendu : "+session.Status, http.StatusBadRequest)
		return
	}

	// Si la session est "open" et a des notes saisies, exiger delete_grades=true
	if session.Status == "open" {
		var gradeCount int64
		database.DB.Model(&models.Grade{}).Where("session_id = ?", session.ID).Count(&gradeCount)
		if gradeCount > 0 && !req.DeleteGrades {
			middleware.JSONError(w,
				fmt.Sprintf("%d note(s) déjà saisie(s) — confirmez avec delete_grades=true pour les supprimer "+
					"(ou transformez la session en reportée via ExtendSession)", gradeCount),
				http.StatusConflict)
			return
		}
		if gradeCount > 0 && req.DeleteGrades {
			// Supprimer les notes saisies (cascade soft)
			if err := database.DB.Where("session_id = ?", session.ID).Delete(&models.Grade{}).Error; err != nil {
				middleware.JSONError(w, "erreur suppression des notes: "+err.Error(), http.StatusInternalServerError)
				return
			}
			log.Printf("[CANCEL] Session %s : %d note(s) supprimée(s) lors de l'annulation", session.ID, gradeCount)
		}
	}

	// Appliquer l'annulation
	now := time.Now()
	userID := ctxUserID(r)
	session.Status = "cancelled"
	session.CancelReason = strings.TrimSpace(req.Reason)
	session.CancelledBy = &userID
	session.CancelledAt = &now
	session.UpdatedAt = now
	if err := database.DB.Save(&session).Error; err != nil {
		middleware.JSONError(w, "erreur annulation session", http.StatusInternalServerError)
		return
	}
	log.Printf("[CANCEL] Session %s annulée par %s (%s) — motif: %s",
		session.ID, userID, role, session.CancelReason)
	jsonResponse(w, http.StatusOK, session)
}

// ArchiveSession archive une session validée (statut terminal lecture seule).
// PUT /api/sessions/{id}/archive
// RBAC : admin + director (son école).
//
// Règles :
//   - Autorisé uniquement depuis "validated". Une session draft/open/closed
//     n'est pas archivable (elle n'est pas terminée — la valider d'abord).
//   - Refusé depuis "cancelled" (annulée ≠ archivée) et "archived" (déjà fait).
//   - Les notes sont CONSERVÉES. Elles continuent de nourrir le bilan annuel
//     élève et la comparaison inter-annuelle.
//   - L'archivage est aussi déclenché automatiquement par le cron de fin
//     d'année scolaire (main.go) pour les sessions validated de l'année N-1.
func ArchiveSession(w http.ResponseWriter, r *http.Request) {
	defer InvalidateDashboardCache() // Fix C: écriture session → invalidate cache dashboard
	id := chi.URLParam(r, "id")
	var req struct {
		Reason string `json:"reason"` // optionnel pour archive manuel (audit)
	}
	// Le body est optionnel pour archive (reason facultatif)
	_ = json.NewDecoder(r.Body).Decode(&req)

	var session models.EvaluationSession
	if err := database.DB.First(&session, "id = ?", id).Error; err != nil {
		middleware.JSONError(w, "session introuvable", http.StatusNotFound)
		return
	}

	// RBAC : director ne peut archiver que les sessions de son école
	role := ctxRole(r)
	if role == "director" {
		schoolID := ctxSchoolID(r)
		if schoolID == "" || session.SchoolID != schoolID {
			middleware.JSONError(w, "accès refusé : vous ne pouvez archiver que les sessions de votre école", http.StatusForbidden)
			return
		}
	}

	switch session.Status {
	case "validated":
		// OK — seul chemin autorisé vers archived
	case "cancelled":
		middleware.JSONError(w, "session annulée — archivage non applicable", http.StatusConflict)
		return
	case "archived":
		middleware.JSONError(w, "session déjà archivée", http.StatusConflict)
		return
	case "draft", "open", "closed":
		middleware.JSONError(w,
			"archivage impossible : session non validée (statut="+session.Status+
				"). Validez d'abord la session avant de l'archiver.", http.StatusConflict)
		return
	default:
		middleware.JSONError(w, "statut inattendu : "+session.Status, http.StatusBadRequest)
		return
	}

	now := time.Now()
	userID := ctxUserID(r)
	session.Status = "archived"
	session.ArchivedAt = &now
	session.ArchivedBy = &userID
	session.UpdatedAt = now
	if err := database.DB.Save(&session).Error; err != nil {
		middleware.JSONError(w, "erreur archivage session", http.StatusInternalServerError)
		return
	}
	log.Printf("[ARCHIVE] Session %s archivée par %s (%s)", session.ID, userID, role)
	jsonResponse(w, http.StatusOK, session)
}
