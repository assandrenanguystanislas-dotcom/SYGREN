package handlers

import (
        "fmt"
        "net/http"

        "sygren-api/database"
        "sygren-api/middleware"
        "sygren-api/models"
)

// === Synthèse des Résultats — Données JSON pour rendu HTML frontend ===
// Le frontend génère le document HTML/CSS (paysage A4) avec l'écusson de la CI,
// reproduisant fidèlement le modèle Resultat.png fourni par l'utilisateur.

// SyntheseLevelData — stats pour un niveau
type SyntheseLevelData struct {
        ClassName string `json:"class_name"`
        Inscrits  [3]int `json:"inscrits"`   // [G, F, T]
        Presents  [3]int `json:"presents"`
        Admis     [3]int `json:"admis"`
        PctAdmis  [3]float64 `json:"pct_admis"`
}

// SyntheseData — données complètes pour le document de synthèse
type SyntheseData struct {
        IEPName      string             `json:"iep_name"`
        IEPRegion    string             `json:"iep_region"`
        SchoolName   string             `json:"school_name"`
        SchoolCode   string             `json:"school_code"`
        SchoolAddr   string             `json:"school_addr"`
        EvalLabel    string             `json:"eval_label"`
        EvalNumber   int                `json:"eval_number"`
        Month        int                `json:"month"`
        Year         int                `json:"year"`
        Levels       []SyntheseLevelData `json:"levels"`
        Totals       SyntheseTotals     `json:"totals"`
}

type SyntheseTotals struct {
        InscritsG int     `json:"inscrits_g"`
        InscritsF int     `json:"inscrits_f"`
        InscritsT int     `json:"inscrits_t"`
        PresentsG int     `json:"presents_g"`
        PresentsF int     `json:"presents_f"`
        PresentsT int     `json:"presents_t"`
        AdmisG    int     `json:"admis_g"`
        AdmisF    int     `json:"admis_f"`
        AdmisT    int     `json:"admis_t"`
        PctG      float64 `json:"pct_g"`
        PctF      float64 `json:"pct_f"`
        PctT      float64 `json:"pct_t"`
}

// GetSyntheseData returns JSON data for the synthese document.
// Paramètres : school_code (requis) + eval_type + eval_number + year
// Au lieu de session_id, on part d'une ÉCOLE + une ÉVALUATION → toutes les classes
func GetSyntheseData(w http.ResponseWriter, r *http.Request) {
        schoolCode := r.URL.Query().Get("school_code")
        if schoolCode == "" {
                // Rétrocompatibilité : si session_id est fourni, retrouver l'école
                sessionID := r.URL.Query().Get("session_id")
                if sessionID == "" {
                        middleware.JSONError(w, "school_code ou session_id est requis", http.StatusBadRequest)
                        return
                }
                var session models.EvaluationSession
                if err := database.DB.First(&session, "id = ?", sessionID).Error; err != nil {
                        middleware.JSONError(w, "session introuvable", http.StatusNotFound)
                        return
                }
                var cls models.Class
                database.DB.First(&cls, "id = ?", session.ClassID)
                var sch models.School
                database.DB.First(&sch, "id = ?", cls.SchoolID)
                schoolCode = sch.Code
                // Refill query params
                q := r.URL.Query()
                q.Set("school_code", schoolCode)
                q.Set("eval_type", session.EvalType)
                q.Set("eval_number", fmt.Sprintf("%d", session.EvalNumber))
                q.Set("year", fmt.Sprintf("%d", session.Year))
                r.URL.RawQuery = q.Encode()
                schoolCode = q.Get("school_code")
        }

        evalType := r.URL.Query().Get("eval_type")
        if evalType == "" {
                evalType = "composition"
        }
        evalNumberStr := r.URL.Query().Get("eval_number")
        if evalNumberStr == "" {
                evalNumberStr = "1"
        }
        evalNumber := 1
        fmt.Sscanf(evalNumberStr, "%d", &evalNumber)
        yearStr := r.URL.Query().Get("year")
        if yearStr == "" {
                yearStr = "2026"
        }
        year := 2026
        fmt.Sscanf(yearStr, "%d", &year)

        // Trouver l'école par code
        var school models.School
        if err := database.DB.Where("code = ?", schoolCode).First(&school).Error; err != nil {
                middleware.JSONError(w, "école introuvable avec ce code", http.StatusBadRequest)
                return
        }

        // RBAC
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

        var classes []models.Class
        database.DB.Where("school_id = ? AND active = ?", school.ID, true).Order("name ASC").Find(&classes)

        classNames := []string{"CP1", "CP2", "CE1", "CE2", "CM1", "CM2"}
        var levels []SyntheseLevelData

        for _, cn := range classNames {
                lvl := SyntheseLevelData{ClassName: cn}
                var targetClass *models.Class
                for _, c := range classes {
                        if c.Name == cn {
                                targetClass = &c
                                break
                        }
                }
                if targetClass == nil {
                        levels = append(levels, lvl)
                        continue
                }

                var students []models.Student
                database.DB.Where("class_id = ?", targetClass.ID).Find(&students)
                for _, s := range students {
                        if s.Gender == "M" {
                                lvl.Inscrits[0]++
                        } else {
                                lvl.Inscrits[1]++
                        }
                        lvl.Inscrits[2]++
                }

                // Trouver la session pour cette classe + évaluation
                var classSession models.EvaluationSession
                database.DB.Where("class_id = ? AND year = ? AND eval_type = ? AND eval_number = ?",
                        targetClass.ID, year, evalType, evalNumber).First(&classSession)

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
                                                lvl.Presents[0]++
                                        } else {
                                                lvl.Presents[1]++
                                        }
                                        lvl.Presents[2]++

                                        scale := averageScaleForLevel(targetClass.Level)
                                        _, passThreshold, _ := GetSystemSettings()
                                        effectiveThreshold := passThreshold * scale / 20.0
                                        if res.Average >= effectiveThreshold {
                                                if stu.Gender == "M" {
                                                        lvl.Admis[0]++
                                                } else {
                                                        lvl.Admis[1]++
                                                }
                                                lvl.Admis[2]++
                                        }
                                }
                        }
                }

                for i := 0; i < 3; i++ {
                        if lvl.Presents[i] > 0 {
                                lvl.PctAdmis[i] = float64(lvl.Admis[i]) / float64(lvl.Presents[i]) * 100
                        }
                }
                levels = append(levels, lvl)
        }

        // Totaux
        var totals SyntheseTotals
        for _, l := range levels {
                totals.InscritsG += l.Inscrits[0]; totals.InscritsF += l.Inscrits[1]; totals.InscritsT += l.Inscrits[2]
                totals.PresentsG += l.Presents[0]; totals.PresentsF += l.Presents[1]; totals.PresentsT += l.Presents[2]
                totals.AdmisG += l.Admis[0]; totals.AdmisF += l.Admis[1]; totals.AdmisT += l.Admis[2]
        }
        if totals.PresentsG > 0 {
                totals.PctG = float64(totals.AdmisG) / float64(totals.PresentsG) * 100
        }
        if totals.PresentsF > 0 {
                totals.PctF = float64(totals.AdmisF) / float64(totals.PresentsF) * 100
        }
        if totals.PresentsT > 0 {
                totals.PctT = float64(totals.AdmisT) / float64(totals.PresentsT) * 100
        }

        evalLabel := "Composition"
        if evalType == "exam_blanc" {
                evalLabel = "Examen Blanc"
        }

        data := SyntheseData{
                IEPName:    iep.Name,
                IEPRegion:  iep.Region,
                SchoolName: school.Name,
                SchoolCode: school.Code,
                SchoolAddr: school.Address,
                EvalLabel:  evalLabel,
                EvalNumber: evalNumber,
                Month:      0, // non utilisé maintenant (synthèse par école, pas par mois)
                Year:       year,
                Levels:     levels,
                Totals:     totals,
        }

        jsonResponse(w, http.StatusOK, data)
}
