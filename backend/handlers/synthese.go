package handlers

import (
        "bytes"
        "fmt"
        "net/http"

        "sygren-api/database"
        "sygren-api/middleware"
        "sygren-api/models"

        "github.com/go-pdf/fpdf"
)

// === Synthèse des Résultats — Modèle officiel IEP ===
// Reproduction fidèle du document Resultat.png
// Couleur dominante : bleu marine (#000080)
// Tableau : 5 niveaux (CP1, CP2, CE1, CE2, CM1) × 3 sous-colonnes (G, F, T)
// Lignes : INSCRITS, PRÉSENTS, ADMIS, % ADMIS
// + récapitulatif + signatures

// NavyBlue RGB
const (
        nvR = 0   // 0x00
        nvG = 0   // 0x00
        nvB = 128 // 0x80
)

func setNavyBlue(pdf *fpdf.Fpdf) {
        pdf.SetTextColor(nvR, nvG, nvB)
}

func setNavyBlueDraw(pdf *fpdf.Fpdf) {
        pdf.SetDrawColor(nvR, nvG, nvB)
}

func setNavyBlueFill(pdf *fpdf.Fpdf) {
        pdf.SetFillColor(nvR, nvG, nvB)
}

// SyntheseStats contient les statistiques pour un niveau donné
type SyntheseStats struct {
        ClassName  string
        Inscrits   [3]int // [0]=G, [1]=F, [2]=T
        Presents   [3]int
        Admis      [3]int
        PctAdmis   [3]float64
}

// GenerateSynthesePDF génère un PDF de synthèse des résultats (modèle officiel IEP).
// Reproduction fidèle du document Resultat.png fourni par l'utilisateur.
func GenerateSynthesePDF(w http.ResponseWriter, r *http.Request) {
        sessionID := r.URL.Query().Get("session_id")
        if sessionID == "" {
                middleware.JSONError(w, "session_id est requis", http.StatusBadRequest)
                return
        }

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

        var iep models.IEP
        _ = database.DB.First(&iep, "id = ?", school.IEPID).Error

        // Récupérer toutes les classes actives de cette école
        var classes []models.Class
        database.DB.Where("school_id = ? AND active = ?", school.ID, true).Order("name ASC").Find(&classes)

        // 5 niveaux uniquement (pas CM2, conforme au modèle)
        classNames := []string{"CP1", "CP2", "CE1", "CE2", "CM1"}
        var allStats []SyntheseStats

        for _, cn := range classNames {
                stats := SyntheseStats{ClassName: cn}
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

                var classSession models.EvaluationSession
                database.DB.Where("class_id = ? AND year = ? AND eval_type = ? AND eval_number = ?",
                        targetClass.ID, session.Year, session.EvalType, session.EvalNumber).First(&classSession)

                if classSession.ID != "" {
                        result, err := computeSessionResults(classSession.ID)
                        if err == nil {
                                for _, res := range result.Results {
                                        if !res.HasAverage {
                                                continue
                                        }
                                        var stu models.Student
                                        if err := database.DB.First(&stu, "id = ?", res.StudentID).Error; err != nil {
                                                continue
                                        }
                                        if stu.Gender == "M" {
                                                stats.Presents[0]++
                                        } else {
                                                stats.Presents[1]++
                                        }
                                        stats.Presents[2]++

                                        scale := averageScaleForLevel(targetClass.Level)
                                        _, passThreshold, _ := GetSystemSettings()
                                        effectiveThreshold := passThreshold * scale / 20.0
                                        if res.Average >= effectiveThreshold {
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

                for i := 0; i < 3; i++ {
                        if stats.Presents[i] > 0 {
                                stats.PctAdmis[i] = float64(stats.Admis[i]) / float64(stats.Presents[i]) * 100
                        }
                }
                allStats = append(allStats, stats)
        }

        // Totaux
        var totG, totF, totT [3]int // inscrits, presents, admis
        for _, s := range allStats {
                totG[0] += s.Inscrits[0]; totG[1] += s.Presents[0]; totG[2] += s.Admis[0]
                totF[0] += s.Inscrits[1]; totF[1] += s.Presents[1]; totF[2] += s.Admis[1]
                totT[0] += s.Inscrits[2]; totT[1] += s.Presents[2]; totT[2] += s.Admis[2]
        }
        var pctG, pctF, pctT float64
        if totG[1] > 0 { pctG = float64(totG[2]) / float64(totG[1]) * 100 }
        if totF[1] > 0 { pctF = float64(totF[2]) / float64(totF[1]) * 100 }
        if totT[1] > 0 { pctT = float64(totT[2]) / float64(totT[1]) * 100 }

        // === Génération PDF (modèle officiel — PAYSAGE) ===
        pdf := fpdf.New("L", "mm", "A4", "") // L = Landscape
        pdf.AddPage()
        pdf.SetMargins(15, 15, 15)
        pdf.SetAutoPageBreak(true, 20)

        tr := pdf.UnicodeTranslatorFromDescriptor("")

        // === En-tête : Gauche (Ministère) + Droite (République + École) ===
        pdf.SetFont("Helvetica", "B", 9)
        setNavyBlue(pdf)

        // Colonne gauche : Administration
        leftText := "République de Côte d'Ivoire\n"
        leftText += "Ministère de l'Éducation Nationale\n"
        leftText += "Et de l'Alphabétisation\n"
        leftText += fmt.Sprintf("Direction Régionale de %s\n", iep.Region)
        leftText += fmt.Sprintf("Inspection de l'Enseignement\nPréscolaire et Primaire de %s\n", iep.Name)
        leftText += fmt.Sprintf("BP : %s / Tél : ............\n", school.Address)
        pdf.MultiCell(120, 4.5, tr(leftText), "", "L", false)

        // Colonne droite : République + École
        pdf.SetXY(155, 15)
        rightText := "Union - Discipline - Travail\n\n\n"
        rightText += fmt.Sprintf("ÉCOLE : %s\n", school.Name)
        pdf.MultiCell(130, 4.5, tr(rightText), "", "R", false)

        // Trait de séparation bleu
        pdf.Ln(2)
        setNavyBlueDraw(pdf)
        pdf.SetLineWidth(0.5)
        pdf.Line(15, pdf.GetY(), 282, pdf.GetY())
        pdf.Ln(5)

        // === Titre central (cadre arrondi bleu) ===
        pdf.SetFont("Helvetica", "B", 16)
        setNavyBlue(pdf)
        titleText := "SYNTHÈSE DES RESULTATS"
        evalLabel := "COMPOSITION"
        if session.EvalType == "exam_blanc" {
                evalLabel = "EXAMEN BLANC"
        }
        subtitleText := fmt.Sprintf("%s DU MOIS DE %s %d", evalLabel, monthLabelFR(session.Month), session.Year)

        // Cadre avec coins arrondis
        titleW := 150.0
        titleH := 16.0
        titleX := (297 - titleW) / 2 // centré en paysage (297mm de large)
        titleY := pdf.GetY()
        setNavyBlueDraw(pdf)
        pdf.SetLineWidth(1.0)
        pdf.RoundedRect(titleX, titleY, titleW, titleH, 3, "1111", "D")
        pdf.SetXY(titleX, titleY+2)
        pdf.CellFormat(titleW, 6, tr(titleText), "", 0, "C", false, 0, "")
        pdf.SetXY(titleX, titleY+8)
        pdf.SetFont("Helvetica", "B", 12)
        pdf.CellFormat(titleW, 6, tr(subtitleText), "", 0, "C", false, 0, "")
        pdf.Ln(titleH + 6)

        // === Tableau ===
        setNavyBlue(pdf)
        setNavyBlueDraw(pdf)
        pdf.SetLineWidth(0.3)

        // Calcul des largeurs de colonnes en paysage (297mm - 30mm marges = 267mm utilisables)
        // Première colonne (libellé) : 30mm
        // 5 niveaux × 3 sous-colonnes = 15 sous-colonnes → (267-30) / 15 = ~15.8mm chacune
        colLabel := 30.0
        colSub := 15.8
        tableStartX := 15.0
        tableW := colLabel + colSub*3*5 // largeur totale du tableau

        // Ligne 1 : En-têtes des niveaux (CP1, CP2, CE1, CE2, CM1)
        pdf.SetFont("Helvetica", "B", 10)
        setNavyBlueFill(pdf)
        pdf.SetTextColor(255, 255, 255) // texte blanc sur fond bleu marine

        pdf.SetX(tableStartX)
        pdf.CellFormat(colLabel, 8, "", "1", 0, "C", true, 0, "")
        for _, cn := range classNames {
                pdf.CellFormat(colSub*3, 8, tr(cn), "1", 0, "C", true, 0, "")
        }
        pdf.Ln(-1)

        // Ligne 2 : Sous-en-têtes G, F, T
        pdf.SetFont("Helvetica", "B", 9)
        pdf.SetX(tableStartX)
        pdf.CellFormat(colLabel, 6, "", "1", 0, "C", true, 0, "")
        for range classNames {
                pdf.CellFormat(colSub, 6, tr("G"), "1", 0, "C", true, 0, "")
                pdf.CellFormat(colSub, 6, tr("F"), "1", 0, "C", true, 0, "")
                pdf.CellFormat(colSub, 6, tr("T"), "1", 0, "C", true, 0, "")
        }
        pdf.Ln(-1)

        // Lignes de données : INSCRITS, PRÉSENTS, ADMIS, % ADMIS
        pdf.SetTextColor(nvR, nvG, nvB) // retour au bleu marine
        pdf.SetFont("Helvetica", "B", 9)

        rowLabels := []string{"INSCRITS", "PRÉSENTS", "ADMIS", "% ADMIS"}
        for rowIdx, label := range rowLabels {
                pdf.SetX(tableStartX)
                // Fond légèrement coloré pour les lignes paires
                if rowIdx%2 == 0 {
                        pdf.SetFillColor(245, 245, 248)
                        pdf.CellFormat(colLabel, 9, tr(label), "1", 0, "L", true, 0, "")
                } else {
                        pdf.CellFormat(colLabel, 9, tr(label), "1", 0, "L", false, 0, "")
                }

                for _, s := range allStats {
                        var vals [3]string
                        switch rowIdx {
                        case 0: // Inscrits
                                vals = [3]string{fmt.Sprintf("%d", s.Inscrits[0]), fmt.Sprintf("%d", s.Inscrits[1]), fmt.Sprintf("%d", s.Inscrits[2])}
                        case 1: // Présents
                                vals = [3]string{fmt.Sprintf("%d", s.Presents[0]), fmt.Sprintf("%d", s.Presents[1]), fmt.Sprintf("%d", s.Presents[2])}
                        case 2: // Admis
                                vals = [3]string{fmt.Sprintf("%d", s.Admis[0]), fmt.Sprintf("%d", s.Admis[1]), fmt.Sprintf("%d", s.Admis[2])}
                        case 3: // % Admis
                                vals = [3]string{
                                        fmt.Sprintf("%.2f", s.PctAdmis[0]),
                                        fmt.Sprintf("%.2f", s.PctAdmis[1]),
                                        fmt.Sprintf("%.2f", s.PctAdmis[2]),
                                }
                        }
                        for i := 0; i < 3; i++ {
                                if rowIdx%2 == 0 {
                                        pdf.CellFormat(colSub, 9, vals[i], "1", 0, "C", true, 0, "")
                                } else {
                                        pdf.CellFormat(colSub, 9, vals[i], "1", 0, "C", false, 0, "")
                                }
                        }
                }
                pdf.Ln(-1)
        }

        // === Ligne récapitulative : FILLES + GARÇONS (cellule fusionnée) ===
        pdf.SetX(tableStartX)
        pdf.SetFont("Helvetica", "B", 10)
        setNavyBlue(pdf)
        setNavyBlueDraw(pdf)
        pdf.SetLineWidth(0.5)

        // Cellule fusionnée : largeur = tableW
        pdf.CellFormat(tableW/2, 8, tr(fmt.Sprintf("FILLES : %.2f %%", pctF)), "1", 0, "C", false, 0, "")
        pdf.CellFormat(tableW/2, 8, tr(fmt.Sprintf("GARÇONS : %.2f %%", pctG)), "1", 1, "C", false, 0, "")

        // === Ligne totale global ===
        pdf.SetX(tableStartX)
        pdf.SetFont("Helvetica", "B", 14)
        pdf.CellFormat(tableW, 10, tr(fmt.Sprintf("%.2f %%", pctT)), "1", 1, "C", false, 0, "")

        // === Pied de page : Signatures ===
        pdf.Ln(15)
        pdf.SetFont("Helvetica", "", 10)
        setNavyBlue(pdf)

        // Date + lieu (aligné à droite)
        pdf.SetX(tableStartX)
        pdf.CellFormat(0, 5, tr(fmt.Sprintf("Fait à %s, le ...../...../.....", iep.Region)), "", 1, "R", false, 0, "")

        pdf.Ln(15) // Espace pour signatures

        // Labels signatures
        pdf.SetFont("Helvetica", "B", 10)
        pdf.SetX(tableStartX)
        pdf.CellFormat(120, 5, tr("Le Directeur"), "", 0, "C", false, 0, "")
        pdf.CellFormat(120, 5, tr("L'Inspecteur"), "", 1, "C", false, 0, "")

        // === Output PDF ===
        var buf bytes.Buffer
        if err := pdf.Output(&buf); err != nil {
                middleware.JSONError(w, "erreur génération PDF", http.StatusInternalServerError)
                return
        }
        pdfBytes := buf.Bytes()

        w.Header().Set("Content-Type", "application/pdf")
        w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="synthese_%s_%s_N%d_%d.pdf"`,
                school.Code, evalLabel, session.EvalNumber, session.Year))
        w.Header().Set("Content-Length", fmt.Sprintf("%d", len(pdfBytes)))
        w.Write(pdfBytes)
}
