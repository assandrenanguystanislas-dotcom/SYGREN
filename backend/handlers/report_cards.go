package handlers

import (
        "bytes"
        "fmt"
        "net/http"
        "os"
        "time"

        "sygren-api/database"
        "sygren-api/middleware"
        "sygren-api/models"
        "sygren-api/storage"

        "github.com/go-chi/chi/v5"
        "github.com/go-pdf/fpdf"
)

// === Module 4 — Édition et Gestion des Bulletins (cahier des charges §3) ===
//
// Génération PDF des bulletins officiels avec :
//   - En-tête institutionnel (République de Côte d'Ivoire, Ministère, IEP, École)
//   - Informations de l'élève (nom, matricule, classe)
//   - Tableau des notes par matière avec coefficients et appréciations
//   - Moyenne générale, rang, mention
//   - Appréciation générale automatique
//   - Zones de signature
//
// Endpoints :
//   POST   /api/report-cards/generate/{sessionId}/{studentId}   (admin, director)
//   POST   /api/report-cards/generate-batch/{sessionId}         (admin, director)
//   GET    /api/report-cards/session/{sessionId}                 (tous rôles)
//   GET    /api/report-cards/{id}/download                       (tous rôles)

// ReportCardWithStudent — bulletin enrichi
type ReportCardWithStudent struct {
        models.ReportCard
        StudentName      string `json:"student_name"`
        StudentMatricule string `json:"student_matricule"`
        ClassName        string `json:"class_name"`
        SchoolName       string `json:"school_name"`
        Month            int    `json:"month"`
        Year             int    `json:"year"`
}

// GenerateReportCard generates a single bulletin PDF and stores it.
func GenerateReportCard(w http.ResponseWriter, r *http.Request) {
        sessionID := chi.URLParam(r, "sessionId")
        studentID := chi.URLParam(r, "studentId")

        // Vérifier l'accès à la session (RBAC par périmètre)
        if _, err := getSessionForUser(r, sessionID); err != nil {
                middleware.JSONError(w, err.Error(), http.StatusForbidden)
                return
        }

        // Calculer les résultats de la session
        results, err := computeSessionResults(sessionID)
        if err != nil {
                middleware.JSONError(w, err.Error(), http.StatusInternalServerError)
                return
        }

        // Trouver le résultat de l'élève
        var studentResult *StudentResult
        for i := range results.Results {
                if results.Results[i].StudentID == studentID {
                        studentResult = &results.Results[i]
                        break
                }
        }
        if studentResult == nil {
                middleware.JSONError(w, "élève non trouvé dans cette session", http.StatusNotFound)
                return
        }

        // Charger l'élève
        var student models.Student
        if err := database.DB.First(&student, "id = ?", studentID).Error; err != nil {
                middleware.JSONError(w, "élève introuvable", http.StatusNotFound)
                return
        }

        // Générer le PDF
        pdfBytes, err := generateBulletinPDF(studentResult, results, &student)
        if err != nil {
                middleware.JSONError(w, "erreur génération PDF: "+err.Error(), http.StatusInternalServerError)
                return
        }

        // Sauvegarder le fichier
        relPath := fmt.Sprintf("bulletins/%s/%s.pdf", sessionID, studentID)
        if _, err := storage.Global.SaveBytes(pdfBytes, relPath); err != nil {
                middleware.JSONError(w, "erreur sauvegarde PDF", http.StatusInternalServerError)
                return
        }

        // Upsert l'enregistrement ReportCard
        reportCard := upsertReportCardRecord(studentID, sessionID, studentResult, relPath)

        jsonResponse(w, http.StatusOK, reportCard)
}

// GenerateBatchReportCards generates bulletins for all students in a session.
func GenerateBatchReportCards(w http.ResponseWriter, r *http.Request) {
        sessionID := chi.URLParam(r, "sessionId")

        if _, err := getSessionForUser(r, sessionID); err != nil {
                middleware.JSONError(w, err.Error(), http.StatusForbidden)
                return
        }

        results, err := computeSessionResults(sessionID)
        if err != nil {
                middleware.JSONError(w, err.Error(), http.StatusInternalServerError)
                return
        }

        generated := 0
        failed := 0
        var failedStudents []string

        for i := range results.Results {
                sr := &results.Results[i]
                var student models.Student
                if err := database.DB.First(&student, "id = ?", sr.StudentID).Error; err != nil {
                        failed++
                        failedStudents = append(failedStudents, sr.LastName+" "+sr.FirstName)
                        continue
                }

                pdfBytes, err := generateBulletinPDF(sr, results, &student)
                if err != nil {
                        failed++
                        failedStudents = append(failedStudents, student.LastName+" "+student.FirstName)
                        continue
                }

                relPath := fmt.Sprintf("bulletins/%s/%s.pdf", sessionID, sr.StudentID)
                if _, err := storage.Global.SaveBytes(pdfBytes, relPath); err != nil {
                        failed++
                        failedStudents = append(failedStudents, student.LastName+" "+student.FirstName)
                        continue
                }

                upsertReportCardRecord(sr.StudentID, sessionID, sr, relPath)
                generated++
        }

        response := map[string]interface{}{
                "session_id": sessionID,
                "total":       len(results.Results),
                "generated":   generated,
                "failed":      failed,
        }
        if len(failedStudents) > 0 {
                response["failed_students"] = failedStudents
        }

        jsonResponse(w, http.StatusOK, response)
}

// ListReportCards returns all bulletins generated for a session.
func ListReportCards(w http.ResponseWriter, r *http.Request) {
        sessionID := chi.URLParam(r, "sessionId")

        if _, err := getSessionForUser(r, sessionID); err != nil {
                middleware.JSONError(w, err.Error(), http.StatusForbidden)
                return
        }

        var cards []models.ReportCard
        if err := database.DB.Where("session_id = ?", sessionID).Find(&cards).Error; err != nil {
                middleware.JSONError(w, "erreur récupération bulletins", http.StatusInternalServerError)
                return
        }

        // Charger les infos de session pour mois/année/école
        var session models.EvaluationSession
        var school models.School
        _ = database.DB.First(&session, "id = ?", sessionID).Error
        if session.SchoolID != "" {
                _ = database.DB.First(&school, "id = ?", session.SchoolID).Error
        }

        result := make([]ReportCardWithStudent, 0, len(cards))
        for _, c := range cards {
                var s models.Student
                _ = database.DB.First(&s, "id = ?", c.StudentID).Error
                // Approche A : la session couvre plusieurs classes ; on récupère
                // la classe de l'élève pour afficher son nom sur le bulletin.
                var cls models.Class
                if s.ClassID != "" {
                        _ = database.DB.First(&cls, "id = ?", s.ClassID).Error
                }
                result = append(result, ReportCardWithStudent{
                        ReportCard:       c,
                        StudentName:      s.LastName + " " + s.FirstName,
                        StudentMatricule: matriculeOrNA(s.Matricule),
                        ClassName:        cls.Name,
                        SchoolName:       school.Name,
                        Month:            session.Month,
                        Year:             session.Year,
                })
        }

        jsonResponse(w, http.StatusOK, map[string]interface{}{
                "report_cards": result,
                "count":        len(result),
        })
}

// DownloadReportCard serves the PDF file for download.
func DownloadReportCard(w http.ResponseWriter, r *http.Request) {
        id := chi.URLParam(r, "id")

        var rc models.ReportCard
        if err := database.DB.First(&rc, "id = ?", id).Error; err != nil {
                middleware.JSONError(w, "bulletin introuvable", http.StatusNotFound)
                return
        }

        // Vérifier l'accès via la session
        if _, err := getSessionForUser(r, rc.SessionID); err != nil {
                middleware.JSONError(w, err.Error(), http.StatusForbidden)
                return
        }

        // Vérifier l'existence du fichier
        if !storage.Global.FileExists(rc.FilePath) {
                middleware.JSONError(w, "fichier PDF introuvable sur le disque", http.StatusNotFound)
                return
        }

        // Lire et servir le fichier
        data, err := os.ReadFile(storage.Global.FullPath(rc.FilePath))
        if err != nil {
                middleware.JSONError(w, "erreur lecture fichier", http.StatusInternalServerError)
                return
        }

        // Nom du fichier : bulletin_{matricule}_{mois}_{année}.pdf
        var student models.Student
        studentName := rc.StudentID
        if err := database.DB.First(&student, "id = ?", rc.StudentID).Error; err == nil {
                studentName = matriculeOrNA(student.Matricule)
        }
        filename := fmt.Sprintf("bulletin_%s.pdf", studentName)

        w.Header().Set("Content-Type", "application/pdf")
        w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))
        w.Header().Set("Content-Length", fmt.Sprintf("%d", len(data)))
        w.Write(data)
}

// upsertReportCardRecord creates or updates a ReportCard record.
func upsertReportCardRecord(studentID, sessionID string, result *StudentResult, filePath string) models.ReportCard {
        var rc models.ReportCard
        existing := database.DB.Where("student_id = ? AND session_id = ?", studentID, sessionID).First(&rc)
        if existing.Error != nil {
                rc = models.ReportCard{
                        StudentID: studentID,
                        SessionID: sessionID,
                }
        }
        rc.Average = result.Average
        rc.Rank = result.Rank
        rc.Mention = result.Mention
        rc.FilePath = filePath
        rc.GeneratedAt = time.Now()

        if existing.Error != nil {
                database.DB.Create(&rc)
        } else {
                database.DB.Save(&rc)
        }
        return rc
}

// =============================================================
// GÉNÉRATION PDF DU BULLETIN
// =============================================================

// generateBulletinPDF crée le PDF d'un bulletin de notes.
// Utilise go-pdf/fpdf avec les core fonts (Helvetica) + traduction
// UTF-8 → CP1252 pour gérer les accents français.
func generateBulletinPDF(result *StudentResult, session *SessionResults, student *models.Student) ([]byte, error) {
        pdf := fpdf.New("P", "mm", "A4", "")
        pdf.AddPage()
        pdf.SetMargins(15, 15, 15)
        pdf.SetAutoPageBreak(true, 20)

        // Traducteur UTF-8 → CP1252 (pour les accents français avec core fonts)
        tr := pdf.UnicodeTranslatorFromDescriptor("cp1252")

        // === En-tête institutionnel ===
        pdf.SetFont("Helvetica", "B", 8)
        pdf.SetTextColor(40, 40, 40)
        pdf.CellFormat(0, 4, tr("RÉPUBLIQUE DE CÔTE D'IVOIRE"), "", 1, "L", false, 0, "")
        pdf.SetFont("Helvetica", "", 7)
        pdf.CellFormat(0, 3.5, tr("Ministère de l'Éducation Nationale et de l'Alphabétisation"), "", 1, "L", false, 0, "")
        pdf.CellFormat(0, 3.5, tr("SYGREN — Système de Gestion de Relevé Électronique de Note"), "", 1, "L", false, 0, "")
        if session.SchoolName != "" {
                pdf.CellFormat(0, 3.5, tr("École: "+session.SchoolName), "", 1, "L", false, 0, "")
        }

        // Ligne séparatrice
        pdf.SetDrawColor(0, 100, 50) // vert
        pdf.SetLineWidth(0.8)
        pdf.Line(15, pdf.GetY()+1, 195, pdf.GetY()+1)
        pdf.Ln(4)

        // === Titre ===
        pdf.SetFont("Helvetica", "B", 18)
        pdf.SetTextColor(0, 100, 50) // vert institutionnel
        pdf.CellFormat(0, 10, tr("BULLETIN DE NOTES"), "", 1, "C", false, 0, "")
        pdf.SetTextColor(0, 0, 0)

        // Session
        pdf.SetFont("Helvetica", "", 11)
        monthLabel := monthLabelFR(session.Month)
        pdf.CellFormat(0, 6, tr(fmt.Sprintf("Session de %s %d", monthLabel, session.Year)), "", 1, "C", false, 0, "")
        pdf.Ln(3)

        // === Cadre informations élève ===
        boxY := pdf.GetY()
        pdf.SetFillColor(248, 248, 245)
        pdf.Rect(15, boxY, 180, 22, "F")
        pdf.SetDrawColor(200, 200, 195)
        pdf.SetLineWidth(0.2)
        pdf.Rect(15, boxY, 180, 22, "D")

        pdf.SetFont("Helvetica", "B", 10)
        pdf.SetXY(18, boxY+2)
        pdf.CellFormat(0, 5, tr(fmt.Sprintf("Élève: %s %s", student.LastName, student.FirstName)), "", 0, "L", false, 0, "")
        pdf.SetXY(110, boxY+2)
        pdf.CellFormat(0, 5, tr(fmt.Sprintf("Matricule: %s", matriculeOrNA(student.Matricule))), "", 0, "L", false, 0, "")

        pdf.SetXY(18, boxY+9)
        pdf.CellFormat(0, 5, tr(fmt.Sprintf("Classe: %s", result.ClassName)), "", 0, "L", false, 0, "")
        pdf.SetXY(110, boxY+9)
        pdf.CellFormat(0, 5, tr(fmt.Sprintf("Effectif: %d", session.Statistics.StudentCount)), "", 0, "L", false, 0, "")

        pdf.SetXY(18, boxY+16)
        pdf.CellFormat(0, 5, tr(fmt.Sprintf("Sexe: %s", student.Gender)), "", 0, "L", false, 0, "")
        pdf.SetXY(110, boxY+16)
        pdf.CellFormat(0, 5, tr(fmt.Sprintf("Année scolaire: %d-%d", session.Year, session.Year+1)), "", 0, "L", false, 0, "")

        pdf.SetXY(15, boxY+22)
        pdf.Ln(3)

        // === Tableau des notes ===
        // En-tête du tableau
        pdf.SetFont("Helvetica", "B", 10)
        pdf.SetFillColor(0, 100, 50) // vert
        pdf.SetTextColor(255, 255, 255)
        pdf.CellFormat(75, 7, tr("Matière"), "1", 0, "C", true, 0, "")
        pdf.CellFormat(20, 7, tr("Coef."), "1", 0, "C", true, 0, "")
        pdf.CellFormat(35, 7, tr("Note"), "1", 0, "C", true, 0, "")
        pdf.CellFormat(50, 7, tr("Appréciation"), "1", 1, "C", true, 0, "")

        // Lignes du tableau
        pdf.SetFont("Helvetica", "", 10)
        pdf.SetTextColor(0, 0, 0)
        for _, sg := range result.SubjectGrades {
                // Couleur alternée
                pdf.SetFillColor(250, 250, 248)
                pdf.CellFormat(75, 6.5, tr(sg.SubjectName), "1", 0, "L", false, 0, "")
                pdf.CellFormat(20, 6.5, fmt.Sprintf("%.1f", sg.Coefficient), "1", 0, "C", false, 0, "")

                if sg.HasGrade {
                        // Afficher value/max (ex: 8/10, 25/30, 45/50)
                        noteStr := fmt.Sprintf("%.2f/%d", sg.Grade, sg.MaxScore)
                        // Couleur de la note selon valeur normalisée sur /20
                        if sg.IsDraft {
                                pdf.SetTextColor(180, 120, 0) // orange pour brouillon
                        } else if sg.NormalizedValue >= 10 {
                                pdf.SetTextColor(0, 120, 50) // vert
                        } else {
                                pdf.SetTextColor(180, 40, 20) // rouge
                        }
                        pdf.CellFormat(35, 6.5, noteStr, "1", 0, "C", false, 0, "")
                        pdf.SetTextColor(0, 0, 0)
                } else {
                        pdf.SetTextColor(150, 150, 150)
                        pdf.CellFormat(35, 6.5, "-", "1", 0, "C", false, 0, "")
                        pdf.SetTextColor(0, 0, 0)
                }
                pdf.CellFormat(50, 6.5, tr(getSubjectAppreciationNormalized(sg.NormalizedValue, sg.HasGrade)), "1", 1, "L", false, 0, "")
        }

        pdf.Ln(4)

        // === Cadre récapitulatif ===
        recapY := pdf.GetY()
        pdf.SetFont("Helvetica", "B", 11)
        pdf.SetFillColor(240, 240, 235)
        pdf.Rect(15, recapY, 180, 16, "F")
        pdf.SetDrawColor(0, 100, 50)
        pdf.SetLineWidth(0.5)
        pdf.Rect(15, recapY, 180, 16, "D")

        // En-tête récap
        pdf.SetTextColor(0, 0, 0)
        pdf.SetXY(15, recapY)
        pdf.CellFormat(60, 8, tr("MOYENNE GÉNÉRALE"), "R", 0, "C", false, 0, "")
        pdf.CellFormat(60, 8, tr("RANG"), "R", 0, "C", false, 0, "")
        pdf.CellFormat(60, 8, tr("MENTION"), "", 1, "C", false, 0, "")

        // Valeurs récap
        pdf.SetFont("Helvetica", "B", 14)
        pdf.SetTextColor(0, 100, 50)
        // Afficher la moyenne sur l'échelle du niveau de l'élève
        // (Approche A : chaque élève a sa propre classe/level → AverageScale)
        avgStr := "-"
        avgScale := session.AverageScale
        if result.AverageScale > 0 {
                avgScale = result.AverageScale
        }
        if result.HasAverage {
                avgStr = fmt.Sprintf("%.2f/%d", result.Average, avgScale)
        }
        pdf.SetXY(15, recapY+8)
        pdf.CellFormat(60, 8, avgStr, "R", 0, "C", false, 0, "")
        pdf.CellFormat(60, 8, tr(result.RankLabel), "R", 0, "C", false, 0, "")
        pdf.CellFormat(60, 8, tr(result.Mention), "", 1, "C", false, 0, "")
        pdf.SetTextColor(0, 0, 0)

        pdf.Ln(6)

        // === Appréciation générale ===
        pdf.SetFont("Helvetica", "B", 10)
        pdf.CellFormat(0, 6, tr("Appréciation générale:"), "", 1, "L", false, 0, "")
        pdf.SetFont("Helvetica", "", 10)
        appreciation := getGeneralAppreciation(result.Average, result.HasAverage)
        pdf.MultiCell(180, 5, tr(appreciation), "", "J", false)

        pdf.Ln(8)

        // === Statistiques de classe ===
        pdf.SetFont("Helvetica", "B", 9)
        pdf.SetFillColor(245, 245, 240)
        pdf.CellFormat(0, 6, tr("Statistiques de classe"), "", 1, "L", true, 0, "")
        pdf.SetFont("Helvetica", "", 8)
        stats := session.Statistics
        pdf.CellFormat(0, 4.5, tr(fmt.Sprintf("Moyenne de classe: %.2f  |  Meilleure: %.2f  |  Plus basse: %.2f  |  Médiane: %.2f",
                stats.ClassAverage, stats.MaxAverage, stats.MinAverage, stats.MedianAverage)), "", 1, "L", false, 0, "")
        pdf.CellFormat(0, 4.5, tr(fmt.Sprintf("Taux de réussite: %.0f%%  |  Taux de distinction: %.0f%%  |  Taux de complétion: %.0f%%",
                stats.PassRate, stats.DistinctionRate, stats.CompletionRate)), "", 1, "L", false, 0, "")

        pdf.Ln(10)

        // === Signatures ===
        pdf.SetFont("Helvetica", "", 10)
        pdf.CellFormat(90, 6, tr("Le Directeur / La Directrice"), "", 0, "C", false, 0, "")
        pdf.CellFormat(90, 6, tr("L'Enseignant(e)"), "", 1, "C", false, 0, "")
        pdf.Ln(14)
        pdf.CellFormat(90, 1, "________________________", "", 0, "C", false, 0, "")
        pdf.CellFormat(90, 1, "________________________", "", 1, "C", false, 0, "")

        // === Pied de page ===
        pdf.Ln(6)
        pdf.SetFont("Helvetica", "", 7)
        pdf.SetTextColor(150, 150, 150)
        pdf.CellFormat(0, 4, tr(fmt.Sprintf("Document généré par SYGREN le %s",
                time.Now().Format("02/01/2006 à 15:04"))), "", 1, "C", false, 0, "")
        pdf.CellFormat(0, 4, tr("Ce document est officiel et fait foi."), "", 1, "C", false, 0, "")

        // Output
        var buf bytes.Buffer
        if err := pdf.Output(&buf); err != nil {
                return nil, err
        }
        return buf.Bytes(), nil
}

// monthLabelFR returns the French month name.
func monthLabelFR(month int) string {
        months := []string{
                "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
                "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
        }
        if month >= 1 && month <= 12 {
                return months[month-1]
        }
        return "—"
}

// getSubjectAppreciation returns the appreciation for a single subject grade.
// Deprecated: use getSubjectAppreciationNormalized (works on /20 scale)
func getSubjectAppreciation(grade float64, hasGrade bool) string {
        return getSubjectAppreciationNormalized(grade, hasGrade)
}

// getSubjectAppreciationNormalized returns the appreciation based on the
// normalized value (on /20). Works for all levels since normalized_value is
// always on /20 regardless of the raw barème.
func getSubjectAppreciationNormalized(normalized float64, hasGrade bool) string {
        if !hasGrade {
                return "Non évalué"
        }
        switch {
        case normalized >= 16:
                return "Excellent"
        case normalized >= 14:
                return "Très bien"
        case normalized >= 12:
                return "Bien"
        case normalized >= 10:
                return "Assez bien"
        case normalized >= 8:
                return "Passable"
        case normalized >= 5:
                return "Insuffisant"
        default:
                return "Très insuffisant"
        }
}

// getGeneralAppreciation returns the general appreciation text based on average.
func getGeneralAppreciation(avg float64, hasAvg bool) string {
        if !hasAvg {
                return "Aucune note n'a été saisie pour cette session. Veuillez contacter l'administration."
        }
        switch {
        case avg >= 16:
                return "Excellents résultats. Félicitations pour ce travail remarquable et la régularité dans l'effort. Continuez ainsi !"
        case avg >= 14:
                return "Très bons résultats d'ensemble. Continuez dans cette voie, l'année se présente sous les meilleurs auspices."
        case avg >= 12:
                return "Bons résultats d'ensemble. Des efforts soutenus permettront de viser l'excellence. Encouragements."
        case avg >= 10:
                return "Résultats satisfaisants. L'élève peut mieux faire avec davantage de rigueur et de régularité dans le travail."
        case avg >= 8:
                return "Résultats fragiles. Un soutien et un encadrement renforcés sont nécessaires pour progresser."
        case avg >= 5:
                return "Résultats insuffisants. Des difficultés importantes nécessitent un accompagnement personnalisé."
        default:
                return "Résultats très insuffisants. Une remédiation urgente est conseillée. Rencontre avec les parents recommandée."
        }
}
