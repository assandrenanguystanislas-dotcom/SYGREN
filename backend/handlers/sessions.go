package handlers

import (
        "encoding/json"
        "fmt"
        "net/http"
        "time"

        "sygren-api/database"
        "sygren-api/middleware"
        "sygren-api/models"

        "github.com/go-chi/chi/v5"
)

// === Sessions de saisie mensuelles (cahier des charges §3 Module 2) ===
//
// Cycle de vie d'une session :
//   draft   → créée automatiquement, saisie pas encore possible
//   open    → l'enseignant peut saisir ses notes (brouillon)
//   closed  → la saisie est fermée, le directeur peut valider
//   validated → verrouillé, plus de modification possible
//
// RBAC :
//   - admin, director : peuvent ouvrir/fermer/valider les sessions de leur périmètre
//   - teacher : peut consulter les sessions de sa classe + saisir si statut=open
//   - inspector : lecture seule

// SessionWithDetails — session enrichie
type SessionWithDetails struct {
        models.EvaluationSession
        ClassName      string  `json:"class_name,omitempty"`
        SchoolName     string  `json:"school_name,omitempty"`
        TeacherName    *string `json:"teacher_name,omitempty"`
        StudentCount   int64   `json:"student_count"`
        SubjectCount   int64   `json:"subject_count"`
        GradedCount    int64   `json:"graded_count"`     // nombre de notes saisies
        DraftCount     int64   `json:"draft_count"`      // notes en brouillon
        CompletionRate float64 `json:"completion_rate"`  // 0-100
}

// ListSessions returns sessions filtered by user scope.
func ListSessions(w http.ResponseWriter, r *http.Request) {
        role := ctxRole(r)
        query := database.DB.Model(&models.EvaluationSession{}).
                Joins("JOIN classes ON classes.id = evaluation_sessions.class_id")

        switch role {
        case "inspector":
                iepID := ctxIEPID(r)
                if iepID == "" {
                        jsonResponse(w, http.StatusOK, map[string]interface{}{"sessions": []interface{}{}, "count": 0})
                        return
                }
                query = query.Joins("JOIN schools ON schools.id = classes.school_id").
                        Where("schools.iep_id = ?", iepID)
        case "director":
                schoolID := ctxSchoolID(r)
                if schoolID == "" {
                        jsonResponse(w, http.StatusOK, map[string]interface{}{"sessions": []interface{}{}, "count": 0})
                        return
                }
                query = query.Where("classes.school_id = ?", schoolID)
        case "teacher":
                userID := ctxUserID(r)
                query = query.Where("classes.teacher_id = ?", userID)
        }

        // Filtres optionnels : année, mois, classe
        if v := r.URL.Query().Get("year"); v != "" {
                query = query.Where("evaluation_sessions.year = ?", v)
        }
        if v := r.URL.Query().Get("month"); v != "" {
                query = query.Where("evaluation_sessions.month = ?", v)
        }
        if v := r.URL.Query().Get("class_id"); v != "" {
                query = query.Where("evaluation_sessions.class_id = ?", v)
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
                // Détails de la classe
                var cls models.Class
                if err := database.DB.First(&cls, "id = ?", s.ClassID).Error; err == nil {
                        d.ClassName = cls.Name
                        // École
                        var school models.School
                        if err := database.DB.First(&school, "id = ?", cls.SchoolID).Error; err == nil {
                                d.SchoolName = school.Name
                        }
                        // Enseignant
                        if cls.TeacherID != nil {
                                var teacher models.User
                                if err := database.DB.First(&teacher, "id = ?", *cls.TeacherID).Error; err == nil {
                                        n := teacher.FullName
                                        d.TeacherName = &n
                                }
                        }
                }
                // Comptages
                database.DB.Model(&models.Student{}).Where("class_id = ?", s.ClassID).Count(&d.StudentCount)
                database.DB.Model(&models.Subject{}).Count(&d.SubjectCount)
                database.DB.Model(&models.Grade{}).Where("session_id = ?", s.ID).Count(&d.GradedCount)
                database.DB.Model(&models.Grade{}).Where("session_id = ? AND is_draft = true", s.ID).Count(&d.DraftCount)

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
type CreateSessionRequest struct {
        ClassID    string `json:"class_id"`
        Month      int    `json:"month"`  // 1-12
        Year       int    `json:"year"`
        Status     string `json:"status"` // draft | open | closed | validated
        EvalType   string `json:"eval_type"`   // composition | exam_blanc
        EvalNumber int    `json:"eval_number"`  // 1, 2, 3...
}

// CreateSession creates a new evaluation session.
// Règles :
//   - "composition" : autorisé pour toutes les classes (CP, CE, CM)
//   - "exam_blanc"  : réservé au CM2 (inclut automatiquement la matière EPS)
//   - Unicité : une seule session du même type+numéro par classe+année
func CreateSession(w http.ResponseWriter, r *http.Request) {
        var req CreateSessionRequest
        if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
                middleware.JSONError(w, "payload invalide", http.StatusBadRequest)
                return
        }
        if req.ClassID == "" || req.Month < 1 || req.Month > 12 || req.Year < 2020 {
                middleware.JSONError(w, "class_id, month (1-12) et year requis", http.StatusBadRequest)
                return
        }
        if req.Status == "" {
                req.Status = "open" // par défaut ouverte à la saisie
        }
        if req.Status != "draft" && req.Status != "open" && req.Status != "closed" && req.Status != "validated" {
                middleware.JSONError(w, "statut invalide (draft|open|closed|validated)", http.StatusBadRequest)
                return
        }

        // Type d'évaluation (défaut: composition)
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

        // Vérifier que la classe existe + récupérer son niveau
        var cls models.Class
        if err := database.DB.First(&cls, "id = ?", req.ClassID).Error; err != nil {
                middleware.JSONError(w, "classe introuvable", http.StatusBadRequest)
                return
        }

        // Examen Blanc réservé au CM2
        if req.EvalType == "exam_blanc" && cls.Level != "CM" {
                middleware.JSONError(w, "les examens blancs sont réservés aux classes de CM (CM1, CM2)", http.StatusBadRequest)
                return
        }

        // Vérifier l'unicité (une session du même type+numéro par classe+année)
        var count int64
        database.DB.Model(&models.EvaluationSession{}).
                Where("class_id = ? AND year = ? AND eval_type = ? AND eval_number = ?",
                        req.ClassID, req.Year, req.EvalType, req.EvalNumber).
                Count(&count)
        if count > 0 {
                middleware.JSONError(w, fmt.Sprintf("une session %s N°%d existe déjà pour cette classe/année",
                        evalTypeLabel(req.EvalType), req.EvalNumber), http.StatusConflict)
                return
        }

        session := models.EvaluationSession{
                ClassID:    req.ClassID,
                Month:      req.Month,
                Year:       req.Year,
                Status:     req.Status,
                EvalType:   req.EvalType,
                EvalNumber: req.EvalNumber,
        }
        if err := database.DB.Create(&session).Error; err != nil {
                middleware.JSONError(w, "erreur création session", http.StatusInternalServerError)
                return
        }
        jsonResponse(w, http.StatusCreated, session)
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
func UpdateSessionStatus(w http.ResponseWriter, r *http.Request) {
        id := chi.URLParam(r, "id")
        var req struct {
                Status string `json:"status"`
        }
        if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
                middleware.JSONError(w, "payload invalide", http.StatusBadRequest)
                return
        }

        validTransitions := map[string][]string{
                "draft":     {"open"},
                "open":      {"closed"},
                "closed":    {"validated"},
                "validated": {},
        }
        allowed, ok := validTransitions[req.Status]
        if !ok {
                middleware.JSONError(w, "statut cible invalide", http.StatusBadRequest)
                return
        }
        _ = allowed // pour documentation

        var session models.EvaluationSession
        if err := database.DB.First(&session, "id = ?", id).Error; err != nil {
                middleware.JSONError(w, "session introuvable", http.StatusNotFound)
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

// DeleteSession removes a session and its grades (admin only).
func DeleteSession(w http.ResponseWriter, r *http.Request) {
        id := chi.URLParam(r, "id")
        // Supprimer d'abord les notes associées
        database.DB.Where("session_id = ?", id).Delete(&models.Grade{})
        if err := database.DB.Delete(&models.EvaluationSession{}, "id = ?", id).Error; err != nil {
                middleware.JSONError(w, "erreur suppression", http.StatusInternalServerError)
                return
        }
        jsonResponse(w, http.StatusOK, map[string]string{"status": "deleted"})
}
