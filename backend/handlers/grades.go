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

// === Grades — Saisie des notes mensuelles ===
//
// Cahier des charges §3 Module 2 :
//   - Grille de saisie type tableur (saisie rapide au clavier)
//   - Mode brouillon automatique (prévenir la perte de données)
//
// RBAC :
//   - teacher : saisit/modifie les notes de sa classe si session=open
//   - director : consultation + peut saisir si session=open (supervision)
//   - admin : tout
//   - inspector : lecture seule
//
// Une note est valide si 0 ≤ value ≤ 20.

// GradeWithDetails — note enrichie
type GradeWithDetails struct {
        models.Grade
        StudentName  string  `json:"student_name,omitempty"`
        StudentMatricule string `json:"student_matricule,omitempty"`
        SubjectName  string  `json:"subject_name,omitempty"`
}

// ListGrades returns grades for a session, filtered by user scope.
// Query params: session_id (required), student_id (optional), subject_id (optional)
func ListGrades(w http.ResponseWriter, r *http.Request) {
        sessionID := r.URL.Query().Get("session_id")
        if sessionID == "" {
                middleware.JSONError(w, "session_id est requis", http.StatusBadRequest)
                return
        }

        // Vérifier l'accès à la session
        session, err := getSessionForUser(r, sessionID)
        if err != nil {
                middleware.JSONError(w, err.Error(), http.StatusForbidden)
                return
        }

        query := database.DB.Model(&models.Grade{}).Where("session_id = ?", session.ID)
        if v := r.URL.Query().Get("student_id"); v != "" {
                query = query.Where("student_id = ?", v)
        }
        if v := r.URL.Query().Get("subject_id"); v != "" {
                query = query.Where("subject_id = ?", v)
        }

        var grades []models.Grade
        if err := query.Find(&grades).Error; err != nil {
                middleware.JSONError(w, "erreur récupération notes", http.StatusInternalServerError)
                return
        }

        jsonResponse(w, http.StatusOK, map[string]interface{}{
                "grades": grades,
                "count":  len(grades),
        })
}

// getSessionForUser vérifie que l'utilisateur a accès à la session
// (la session doit appartenir à son périmètre : sa classe, son école, ou son IEP).
func getSessionForUser(r *http.Request, sessionID string) (*models.EvaluationSession, error) {
        role := ctxRole(r)
        var session models.EvaluationSession
        if err := database.DB.First(&session, "id = ?", sessionID).Error; err != nil {
                return nil, fmt.Errorf("session introuvable")
        }

        // Récupérer la classe
        var cls models.Class
        if err := database.DB.First(&cls, "id = ?", session.ClassID).Error; err != nil {
                return nil, fmt.Errorf("classe introuvable")
        }

        switch role {
        case "admin":
                // accès total
        case "inspector":
                // vérifier que la classe appartient à une école de son IEP
                var school models.School
                if err := database.DB.First(&school, "id = ?", cls.SchoolID).Error; err != nil {
                        return nil, fmt.Errorf("accès refusé")
                }
                if school.IEPID != ctxIEPID(r) {
                        return nil, fmt.Errorf("accès refusé")
                }
        case "director":
                if cls.SchoolID != ctxSchoolID(r) {
                        return nil, fmt.Errorf("accès refusé")
                }
        case "teacher":
                if cls.TeacherID == nil || *cls.TeacherID != ctxUserID(r) {
                        return nil, fmt.Errorf("accès refusé : vous n'êtes pas l'enseignant de cette classe")
                }
        }
        return &session, nil
}

// UpsertGradeRequest — payload pour créer/modifier une note (single)
type UpsertGradeRequest struct {
        StudentID string  `json:"student_id"`
        SubjectID string  `json:"subject_id"`
        SessionID string  `json:"session_id"`
        Value     float64 `json:"value"` // 0-20
}

// UpsertGrade crée ou met à jour une note (mode brouillon par défaut).
// La note est validée dynamiquement selon le barème de la matière+classe
// (cahier des charges §3 Module 2 : CP=/10, CE=/30, CM=/50, Dictée /20).
func UpsertGrade(w http.ResponseWriter, r *http.Request) {
        var req UpsertGradeRequest
        if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
                middleware.JSONError(w, "payload invalide", http.StatusBadRequest)
                return
        }
        if req.StudentID == "" || req.SubjectID == "" || req.SessionID == "" {
                middleware.JSONError(w, "student_id, subject_id et session_id requis", http.StatusBadRequest)
                return
        }

        // Vérifier l'accès à la session + que la saisie est ouverte
        session, err := getSessionForUser(r, req.SessionID)
        if err != nil {
                middleware.JSONError(w, err.Error(), http.StatusForbidden)
                return
        }
        if session.Status != "open" && ctxRole(r) != "admin" {
                middleware.JSONError(w, "saisie fermée : statut session = "+session.Status, http.StatusForbidden)
                return
        }

        // Récupérer le niveau de la classe (CP/CE/CM) pour déterminer le barème
        var cls models.Class
        if err := database.DB.First(&cls, "id = ?", session.ClassID).Error; err != nil {
                middleware.JSONError(w, "classe introuvable", http.StatusBadRequest)
                return
        }
        maxScore := getMaxScore(cls.Level, req.SubjectID)
        if req.Value < 0 || req.Value > float64(maxScore) {
                middleware.JSONError(w, fmt.Sprintf("la note doit être comprise entre 0 et %d (barème %s)", maxScore, cls.Level), http.StatusBadRequest)
                return
        }

        // Upsert : chercher une note existante
        var grade models.Grade
        result := database.DB.Where(
                "student_id = ? AND subject_id = ? AND session_id = ?",
                req.StudentID, req.SubjectID, req.SessionID,
        ).First(&grade)

        // En mode brouillon (sauf si session validated où on force is_draft=false)
        isDraft := session.Status != "validated"

        if result.Error != nil {
                // Création
                grade = models.Grade{
                        StudentID: req.StudentID,
                        SubjectID: req.SubjectID,
                        SessionID: req.SessionID,
                        Value:     req.Value,
                        IsDraft:   isDraft,
                        UpdatedAt: time.Now(),
                }
                if err := database.DB.Create(&grade).Error; err != nil {
                        middleware.JSONError(w, "erreur création note", http.StatusInternalServerError)
                        return
                }
        } else {
                // Mise à jour
                grade.Value = req.Value
                grade.IsDraft = isDraft
                grade.UpdatedAt = time.Now()
                if err := database.DB.Save(&grade).Error; err != nil {
                        middleware.JSONError(w, "erreur mise à jour note", http.StatusInternalServerError)
                        return
                }
        }

        jsonResponse(w, http.StatusOK, grade)
}

// BulkGradeItem — un item du bulk save
type BulkGradeItem struct {
        StudentID string  `json:"student_id"`
        SubjectID string  `json:"subject_id"`
        Value     float64 `json:"value"`
}

// BulkGradeRequest — payload pour sauvegarder plusieurs notes d'un coup
// (optimisé pour la grille tableur — sauvegarde automatique)
type BulkGradeRequest struct {
        SessionID string           `json:"session_id"`
        Grades    []BulkGradeItem  `json:"grades"`
}

// BulkUpsertGrades sauvegarde un lot de notes en une seule transaction.
// C'est l'endpoint utilisé par l'auto-save de la grille tableur.
func BulkUpsertGrades(w http.ResponseWriter, r *http.Request) {
        var req BulkGradeRequest
        if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
                middleware.JSONError(w, "payload invalide", http.StatusBadRequest)
                return
        }
        if req.SessionID == "" {
                middleware.JSONError(w, "session_id requis", http.StatusBadRequest)
                return
        }

        // Vérifier l'accès + statut open
        session, err := getSessionForUser(r, req.SessionID)
        if err != nil {
                middleware.JSONError(w, err.Error(), http.StatusForbidden)
                return
        }
        if session.Status != "open" && ctxRole(r) != "admin" {
                middleware.JSONError(w, "saisie fermée : statut = "+session.Status, http.StatusForbidden)
                return
        }

        // Récupérer le niveau de la classe (CP/CE/CM) pour valider les barèmes
        var cls models.Class
        if err := database.DB.First(&cls, "id = ?", session.ClassID).Error; err != nil {
                middleware.JSONError(w, "classe introuvable", http.StatusBadRequest)
                return
        }

        // Valider toutes les notes AVANT de commencer la transaction
        // (validation dynamique selon le barème de chaque matière)
        for _, g := range req.Grades {
                if g.StudentID == "" || g.SubjectID == "" {
                        middleware.JSONError(w, "student_id et subject_id requis pour chaque note", http.StatusBadRequest)
                        return
                }
                maxScore := getMaxScore(cls.Level, g.SubjectID)
                if g.Value < 0 || g.Value > float64(maxScore) {
                        middleware.JSONError(w, fmt.Sprintf("note invalide : %v (doit être 0-%d, barème %s)", g.Value, maxScore, cls.Level), http.StatusBadRequest)
                        return
                }
        }

        // Transaction : tout ou rien
        tx := database.DB.Begin()
        if tx.Error != nil {
                middleware.JSONError(w, "erreur initialisation transaction", http.StatusInternalServerError)
                return
        }

        isDraft := session.Status != "validated"
        now := time.Now()
        saved := 0
        updated := 0

        for _, g := range req.Grades {
                var existing models.Grade
                result := tx.Where(
                        "student_id = ? AND subject_id = ? AND session_id = ?",
                        g.StudentID, g.SubjectID, req.SessionID,
                ).First(&existing)

                if result.Error != nil {
                        // Création
                        grade := models.Grade{
                                StudentID: g.StudentID,
                                SubjectID: g.SubjectID,
                                SessionID: req.SessionID,
                                Value:     g.Value,
                                IsDraft:   isDraft,
                                UpdatedAt: now,
                        }
                        if err := tx.Create(&grade).Error; err != nil {
                                tx.Rollback()
                                middleware.JSONError(w, "erreur création note", http.StatusInternalServerError)
                                return
                        }
                        saved++
                } else {
                        // Mise à jour (uniquement si la valeur a changé)
                        if existing.Value != g.Value {
                                existing.Value = g.Value
                                existing.IsDraft = isDraft
                                existing.UpdatedAt = now
                                if err := tx.Save(&existing).Error; err != nil {
                                        tx.Rollback()
                                        middleware.JSONError(w, "erreur mise à jour note", http.StatusInternalServerError)
                                        return
                                }
                                updated++
                        }
                }
        }

        if err := tx.Commit().Error; err != nil {
                middleware.JSONError(w, "erreur commit transaction", http.StatusInternalServerError)
                return
        }

        jsonResponse(w, http.StatusOK, map[string]interface{}{
                "status":         "ok",
                "session_id":     req.SessionID,
                "total_received": len(req.Grades),
                "created":        saved,
                "updated":        updated,
                "skipped":        len(req.Grades) - saved - updated,
        })
}

// DeleteGrade removes a single grade.
func DeleteGrade(w http.ResponseWriter, r *http.Request) {
        id := chi.URLParam(r, "id")
        var grade models.Grade
        if err := database.DB.First(&grade, "id = ?", id).Error; err != nil {
                middleware.JSONError(w, "note introuvable", http.StatusNotFound)
                return
        }
        // Vérifier l'accès à la session
        if _, err := getSessionForUser(r, grade.SessionID); err != nil {
                middleware.JSONError(w, err.Error(), http.StatusForbidden)
                return
        }
        // Vérifier le statut de la session
        session, _ := getSessionForUser(r, grade.SessionID)
        if session.Status != "open" && ctxRole(r) != "admin" {
                middleware.JSONError(w, "suppression impossible : session "+session.Status, http.StatusForbidden)
                return
        }
        if err := database.DB.Delete(&grade).Error; err != nil {
                middleware.JSONError(w, "erreur suppression", http.StatusInternalServerError)
                return
        }
        jsonResponse(w, http.StatusOK, map[string]string{"status": "deleted"})
}
