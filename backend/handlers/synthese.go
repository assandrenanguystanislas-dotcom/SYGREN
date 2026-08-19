package handlers

import (
        "bytes"
        "fmt"
        "net/http"
        "os"
        "strings"
        "time"

        "sygren-api/database"
        "sygren-api/middleware"
        "sygren-api/models"

        "github.com/go-pdf/fpdf"
)

// === Synthèse des Résultats (cahier des charges §3 Module 5) ===
// Document officiel récapitulatif des résultats par niveau (CP1→CM2) et par genre.
// Format : tableau 5-6 niveaux × 3 sous-colonnes (Garçons/Filles/Total)
// Lignes : Inscrits, Présents, Admis, % Admis
// + récapitulatif global + signatures Directeur/Inspecteur

// SyntheseStats contient les statistiques pour un niveau donné
type SyntheseStats struct {
        Level    string
        ClassName string // CP1, CP2, CE1, CE2, CM1, CM2
        Inscrits [3]int // [0]=Garçons, [1]=Filles, [2]=Total
        Presents [3]int
        Admis    [3]int
        PctAdmis [3]float64 // [0]=G, [1]=F, [2]=T
}

// GenerateSynthesePDF génère un PDF de synthèse des résultats pour une session.
// Le document couvre toutes les classes de l'école de la session sélectionnée.
// RBAC : admin (toutes), director (son école), inspector (son IEP)
func GenerateSynthesePDF(w http.ResponseWriter, r *http.Request) {
        sessionID := r.URL.Query().Get("session_id")
        if sessionID == "" {
                middleware.JSONError(w, "session_id est requis", http.StatusBadRequest)
                return
        }

        // Charger la session + classe + école
        var session models.EvaluationSession
        if err := database.DB.First(&session, "id = ?", sessionID).Error; err != nil {
                middleware.JSONError(w, "session introuvable", http.StatusNotFound)
                return
        }
        var cls models.Class
        if err := database.DB.First(&cls, "id = ?", session.ClassID).Error; err != nil {
                middleware.JSONError(w, "classe introuvable", http.StatusInternalServerError)
                return
        }
        var school models.School
        if err := database.DB.First(&school, "id = ?", cls.SchoolID).Error; err != nil {
                middleware.JSONError(w, "école introuvable", http.StatusInternalServerError)
                return
        }

        // Vérifier RBAC
        role := ctxRole(r)
        if role == "director" && school.ID != ctxSchoolID(r) {
                middleware.JSONError(w, "accès refusé : vous ne pouvez générer la synthèse que pour votre école", http.StatusForbidden)
                return
        }
        if role == "inspector" {
                var iep models.IEP
                if err := database.DB.First(&iep, "id = ?", school.IEPID).Error; err != nil {
                        middleware.JSONError(w, "accès refusé", http.StatusForbidden)
                        return
                }
                if iep.ID != ctxIEPID(r) {
                        middleware.JSONError(w, "accès refusé : cette école n'est pas dans votre IEP", http.StatusForbidden)
                        return
                }
        }

        // Récupérer l'IEP pour l'en-tête
        var iep models.IEP
        _ = database.DB.First(&iep, "id = ?", school.IEPID).Error

        // Récupérer toutes les classes actives de cette école
        var classes []models.Class
        database.DB.Where("school_id = ? AND active = ?", school.ID, true).Order("name ASC").Find(&classes)

        // Pour chaque classe, calculer les stats
        classNames := []string{"CP1", "CP2", "CE1", "CE2", "CM1", "CM2"}
        var allStats []SyntheseStats

        for _, cn := range classNames {
                stats := SyntheseStats{Level: cn[:2], ClassName: cn}
                // Trouver la classe correspondante
                var targetClass *models.Class
                for _, c := range classes {
                        if c.Name == cn {
                                targetClass = &c
                                break
                        }
                }
                if targetClass == nil {
                        allStats = append(allStats, stats)
                        continue
                }

                // Compter les élèves inscrits par genre
                var students []models.Student
                database.DB.Where("class_id = ?", targetClass.ID).Find(&students)
                for _, s := range students {
                        if s.Gender == "M" {
                                stats.Inscrits[0]++
                        } else {
                                stats.Inscrits[1]++
                        }
                        stats.Inscrits[2]++
                }

                // Récupérer les résultats de cette classe pour cette période (même année)
                // Chercher une session pour cette classe avec même année + même eval_type + eval_number
                var classSession models.EvaluationSession
                database.DB.Where("class_id = ? AND year = ? AND eval_type = ? AND eval_number = ?",
                        targetClass.ID, session.Year, session.EvalType, session.EvalNumber).First(&classSession)

                if classSession.ID != "" {
                        // Calculer les résultats pour cette session
                        result, err := computeSessionResults(classSession.ID)
                        if err == nil {
                                for _, r := range result.Results {
                                        if !r.HasAverage {
                                                continue
                                        }
                                        // Trouver le genre de l'élève
                                        var stu models.Student
                                        if err := database.DB.First(&stu, "id = ?", r.StudentID).Error; err != nil {
                                                continue
                                        }
                                        // Présent = a une moyenne
                                        if stu.Gender == "M" {
                                                stats.Presents[0]++
                                        } else {
                                                stats.Presents[1]++
                                        }
                                        stats.Presents[2]++

                                        // Admis = moyenne >= pass threshold (sur l'échelle du niveau)
                                        scale := averageScaleForLevel(targetClass.Level)
                                        _, passThreshold, _ := GetSystemSettings()
                                        effectiveThreshold := passThreshold * scale / 20.0
                                        if r.Average >= effectiveThreshold {
                                                if stu.Gender == "M" {
                                                        stats.Admis[0]++
                                                } else {
                                                        stats.Admis[1]++
                                                }
                                                stats.Admis[2]++
                                        }
                                }
                        }
                }

                // Calculer les pourcentages
                for i := 0; i < 3; i++ {
                        if stats.Presents[i] > 0 {
                                stats.PctAdmis[i] = float64(stats.Admis[i]) / float64(stats.Presents[i]) * 100
                        }
                }
                allStats = append(allStats, stats)
        }

        // Calculer les totaux
        var totalG, totalF, totalT [4]int // [inscrits, presents, admis]
        for _, s := range allStats {
                totalG[0] += s.Inscrits[0]
                totalG[1] += s.Presents[0]
                totalG[2] += s.Admis[0]
                totalF[0] += s.Inscrits[1]
                totalF[1] += s.Presents[1]
                totalF[2] += s.Admis[1]
                totalT[0] += s.Inscrits[2]
                totalT[1] += s.Presents[2]
                totalT[2] += s.Admis[2]
        }
        var pctG, pctF, pctT float64
        if totalG[1] > 0 {
                pctG = float64(totalG[2]) / float64(totalG[1]) * 100
        }
        if totalF[1] > 0 {
                pctF = float64(totalF[2]) / float64(totalF[1]) * 100
        }
        if totalT[1] > 0 {
                pctT = float64(totalT[2]) / float64(totalT[1]) * 100
        }

        // === Génération PDF ===
        pdf := fpdf.New("P", "mm", "A4", "")
        pdf.AddPage()
        pdf.SetMargins(15, 15, 15)
        pdf.SetAutoPageBreak(true, 20)

        // Helper de traduction UTF-8 → CP1252
        tr := pdf.UnicodeTranslatorFromDescriptor("")

        // === En-tête ===
        pdf.SetFont("Helvetica", "B", 9)
        pdf.SetTextColor(0, 0, 0)

        // Colonne gauche : Administration
        pdf.MultiCell(90, 4, tr("République de Côte d'Ivoire\nMinistère de l'Éducation Nationale\nEt de l'Alphabétisation\nDirection Régionale de "+iep.Region+"\nInspection de l'Enseignement Préscolaire et Primaire\nde "+iep.Name), "", "L", false)

        // Colonne droite : École
        pdf.SetXY(110, 15)
        pdf.MultiCell(85, 4, tr("Union - Discipline - Travail\n\nÉCOLE : "+school.Name+"\n\nBP : "+school.Address+"\n"+iep.Name), "", "R", false)

        pdf.Ln(4)
        pdf.SetTextColor(0, 0, 0)

        // === Titre central ===
        pdf.SetFont("Helvetica", "B", 14)
        pdf.SetTextColor(0, 50, 100)
        evalLabel := "Composition"
        if session.EvalType == "exam_blanc" {
                evalLabel = "Examen Blanc"
        }
        pdf.CellFormat(0, 10, tr(fmt.Sprintf("SYNTHÈSE DES RÉSULTATS\n%s N°%d du mois de %s %d",
                evalLabel, session.EvalNumber, monthLabel(session.Month), session.Year)),
                "", 0, "C", false, 0, "")
        pdf.Ln(12)

        // === Tableau ===
        pdf.SetTextColor(0, 0, 0)
        pdf.SetFont("Helvetica", "B", 9)

        // En-tête du tableau : Niveaux × (G, F, T)
        colW := 28.0 // mm par sous-colonne
        // Première colonne (libellé)
        pdf.SetFillColor(0, 100, 50)
        pdf.SetTextColor(255, 255, 255)
        pdf.CellFormat(25, 8, "", "1", 0, "C", true, 0, "")

        for _, cn := range classNames {
                pdf.CellFormat(colW*3, 4, tr(cn), "1", 0, "C", true, 0, "")
        }
        pdf.Ln(-1)

        // Sous-en-tête G/F/T
        pdf.SetFont("Helvetica", "B", 8)
        pdf.CellFormat(25, 4, "", "1", 0, "C", true, 0, "")
        for range classNames {
                pdf.CellFormat(colW, 4, tr("G"), "1", 0, "C", true, 0, "")
                pdf.CellFormat(colW, 4, tr("F"), "1", 0, "C", true, 0, "")
                pdf.CellFormat(colW, 4, tr("T"), "1", 0, "C", true, 0, "")
        }
        pdf.Ln(-1)

        // Lignes de données
        pdf.SetTextColor(0, 0, 0)
        pdf.SetFont("Helvetica", "", 9)

        rowLabels := []string{"INSCRITS", "PRÉSENTS", "ADMIS", "% ADMIS"}
        for rowIdx, label := range rowLabels {
                // Couleur alternée
                if rowIdx%2 == 0 {
                        pdf.SetFillColor(245, 245, 240)
                } else {
                        pdf.SetFillColor(255, 255, 255)
                }
                pdf.CellFormat(25, 7, tr(label), "1", 0, "L", true, 0, "")

                for _, s := range allStats {
                        var vals [3]string
                        if rowIdx == 0 { // Inscrits
                                vals = [3]string{fmt.Sprintf("%d", s.Inscrits[0]), fmt.Sprintf("%d", s.Inscrits[1]), fmt.Sprintf("%d", s.Inscrits[2])}
                        } else if rowIdx == 1 { // Présents
                                vals = [3]string{fmt.Sprintf("%d", s.Presents[0]), fmt.Sprintf("%d", s.Presents[1]), fmt.Sprintf("%d", s.Presents[2])}
                        } else if rowIdx == 2 { // Admis
                                vals = [3]string{fmt.Sprintf("%d", s.Admis[0]), fmt.Sprintf("%d", s.Admis[1]), fmt.Sprintf("%d", s.Admis[2])}
                        } else { // % Admis
                                vals = [3]string{
                                        fmt.Sprintf("%.1f%%", s.PctAdmis[0]),
                                        fmt.Sprintf("%.1f%%", s.PctAdmis[1]),
                                        fmt.Sprintf("%.1f%%", s.PctAdmis[2]),
                                }
                        }
                        pdf.CellFormat(colW, 7, vals[0], "1", 0, "C", true, 0, "")
                        pdf.CellFormat(colW, 7, vals[1], "1", 0, "C", true, 0, "")
                        pdf.CellFormat(colW, 7, vals[2], "1", 0, "C", true, 0, "")
                }
                pdf.Ln(-1)
        }

        // === Récapitulatif global ===
        pdf.Ln(3)
        pdf.SetFont("Helvetica", "B", 11)
        pdf.SetFillColor(240, 240, 235)
        pdf.SetDrawColor(0, 100, 50)
        pdf.SetLineWidth(0.5)

        recapY := pdf.GetY()
        pdf.Rect(15, recapY, 180, 14, "D")
        pdf.SetXY(15, recapY)

        // % Filles
        pdf.SetFont("Helvetica", "B", 10)
        pdf.CellFormat(60, 7, tr("FILLES"), "1", 0, "C", true, 0, "")
        pdf.CellFormat(60, 7, tr("GARÇONS"), "1", 0, "C", true, 0, "")
        pdf.CellFormat(60, 7, tr("TOTAL"), "1", 1, "C", true, 0, "")

        pdf.SetFont("Helvetica", "B", 14)
        pdf.SetTextColor(0, 100, 50)
        pdf.CellFormat(60, 7, fmt.Sprintf("%.2f %%", pctF), "1", 0, "C", false, 0, "")
        pdf.CellFormat(60, 7, fmt.Sprintf("%.2f %%", pctG), "1", 0, "C", false, 0, "")
        pdf.CellFormat(60, 7, fmt.Sprintf("%.2f %%", pctT), "1", 1, "C", false, 0, "")
        pdf.SetTextColor(0, 0, 0)

        // === Pied de page : Signatures ===
        pdf.Ln(15)
        pdf.SetFont("Helvetica", "", 10)

        // Lieu + Date
        pdf.CellFormat(0, 5, tr(fmt.Sprintf("Fait à %s, le ...../...../.....", iep.Region)), "", 1, "R", false, 0, "")

        pdf.Ln(10)

        // Signatures
        pdf.SetFont("Helvetica", "B", 10)
        pdf.CellFormat(90, 5, tr("Le Directeur"), "", 0, "C", false, 0, "")
        pdf.CellFormat(90, 5, tr("L'Inspecteur"), "", 1, "C", false, 0, "")

        pdf.Ln(20) // Espace pour signatures

        // === Génération du PDF ===
        var buf bytes.Buffer
        if err := pdf.Output(&buf); err != nil {
                middleware.JSONError(w, "erreur génération PDF", http.StatusInternalServerError)
                return
        }
        pdfBytes := buf.Bytes()

        // Servir le PDF
        w.Header().Set("Content-Type", "application/pdf")
        w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="synthese_%s_%s_N%d_%d.pdf"`,
                school.Code, evalLabel, session.EvalNumber, session.Year))
        w.Header().Set("Content-Length", fmt.Sprintf("%d", len(pdfBytes)))
        w.Write(pdfBytes)
}

// monthLabel returns the French month name
func monthLabel(month int) string {
        months := []string{"Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
                "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"}
        if month >= 1 && month <= 12 {
                return months[month-1]
        }
        return "—"
}

// init ensures we don't have unused imports
var _ = os.ReadFile
var _ = strings.TrimSpace
var _ = time.Now
