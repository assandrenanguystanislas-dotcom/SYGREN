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
//
// Approche A — Une session couvre toute l'école. On cherche donc UNE session
// par (school_id, year, eval_type, eval_number) et on filtre les résultats par
// classe pour remplir chaque ligne du tableau de synthèse. Les classes
// exemptées via SessionExemption sont ignorées (aucun admis/présent).

// SyntheseLevelData — stats pour un niveau
type SyntheseLevelData struct {
        ClassName string  `json:"class_name"`
        Inscrits  [3]int     `json:"inscrits"`   // [G, F, T]
        Presents  [3]int     `json:"presents"`
        Admis     [3]int     `json:"admis"`
        PctAdmis  [3]float64 `json:"pct_admis"`
}

// SyntheseData — données complètes pour le document de synthèse
type SyntheseData struct {
        IEPName    string               `json:"iep_name"`
        IEPRegion  string               `json:"iep_region"`
        SchoolName string               `json:"school_name"`
        SchoolCode string               `json:"school_code"`
        SchoolAddr string               `json:"school_addr"`
        EvalLabel  string               `json:"eval_label"`
        EvalNumber int                  `json:"eval_number"`
        Month      int                  `json:"month"`
        Year       int                  `json:"year"`
        Levels     []SyntheseLevelData  `json:"levels"`
        Totals     SyntheseTotals       `json:"totals"`
        // LevelGroup indique le périmètre du document (transmis au frontend
        // pour adapter le titre et le rendu) :
        //   "primary" → CP1 au CM1 (document principal)
        //   "cm2"     → CM2 seulement (document dédié fin de cycle)
        //   "all"     → toutes les 6 classes (rétrocompatibilité)
        LevelGroup   string             `json:"level_group"`
        // DocumentLabel est le sous-titre lisible affiché dans le document
        // (ex: "CP1 au CM1" ou "CM2 — Fin de cycle primaire").
        DocumentLabel string            `json:"document_label"`

        // === Infos pour les signatures et l'en-tête du document ===
        // DirectorName : nom du directeur de l'école (User role=director,
        // school_id = école de la session). Affiché sous "Le Directeur".
        DirectorName string             `json:"director_name"`
        // Infos de l'inspecteur titulaire de l'IEP (depuis le modèle IEP).
        // Affichées sous "L'Inspecteur" et dans l'en-tête (BP/Tel/Courriel).
        InspectorName  string           `json:"inspector_name"`
        InspectorEmail string           `json:"inspector_email"`
        InspectorPhone string           `json:"inspector_phone"`
        IEPBP          string           `json:"iep_bp"`
}

type SyntheseTotals struct {
        InscritsG  int     `json:"inscrits_g"`
        InscritsF  int     `json:"inscrits_f"`
        InscritsT  int     `json:"inscrits_t"`
        PresentsG  int     `json:"presents_g"`
        PresentsF  int     `json:"presents_f"`
        PresentsT  int     `json:"presents_t"`
        AdmisG     int     `json:"admis_g"`
        AdmisF     int     `json:"admis_f"`
        AdmisT     int     `json:"admis_t"`
        PctG       float64 `json:"pct_g"`
        PctF       float64 `json:"pct_f"`
        PctT       float64 `json:"pct_t"`
}

// GetSyntheseData returns JSON data for the synthese document.
// Paramètres : school_code (requis) + eval_type + eval_number + year
// Au lieu de session_id, on part d'une ÉCOLE + une ÉVALUATION → toutes les classes
//
// Avec l'Approche A, il n'existe qu'une seule session par (école, année,
// eval_type, eval_number). On la charge une fois, on calcule ses résultats
// (qui incluent tous les élèves de l'école sauf exemptions), puis on filtre
// par classe pour remplir chaque ligne CP1/CP2/.../CM2 du tableau.
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
                var sch models.School
                database.DB.First(&sch, "id = ?", session.SchoolID)
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

        // Approche A : 1 session unique pour (école, année, eval_type, eval_number)
        var session models.EvaluationSession
        database.DB.Where("school_id = ? AND year = ? AND eval_type = ? AND eval_number = ?",
                school.ID, year, evalType, evalNumber).First(&session)

        // Calculer les résultats UNE FOIS (couvre toutes les classes de l'école)
        // si la session existe. Indexer par student_id pour lookup rapide.
        studentResults := make(map[string]StudentResult)
        if session.ID != "" {
                results, err := computeSessionResults(session.ID)
                if err == nil {
                        for _, res := range results.Results {
                                studentResults[res.StudentID] = res
                        }
                }
        }

        // _, passThreshold, _ := GetSystemSettings() — lu ci-dessous par classe

        // === Séparation en deux documents de synthèse ===
        // level_group filtre les classes affichées dans le document :
        //   "primary" (défaut si absent) → CP1, CP2, CE1, CE2, CM1 (5 classes)
        //   "cm2"                      → CM2 seulement (document dédié fin de cycle)
        //   "all"                      → toutes les 6 classes (rétrocompatibilité)
        // Justification pédagogique : le CM2 a son propre document car c'est
        // la classe de fin de cycle primaire avec un examen spécifique. Avoir
        // un document séparé améliore la lisibilité et permet de l'archiver
        // indépendamment (examen de fin d'études).
        levelGroup := r.URL.Query().Get("level_group")
        if levelGroup == "" {
                levelGroup = "primary" // défaut : document CP1-CM1
        }
        var classNames []string
        switch levelGroup {
        case "cm2":
                classNames = []string{"CM2"}
        case "all":
                classNames = []string{"CP1", "CP2", "CE1", "CE2", "CM1", "CM2"}
        default: // "primary" ou toute autre valeur
                classNames = []string{"CP1", "CP2", "CE1", "CE2", "CM1"}
                levelGroup = "primary"
        }
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

                // Inscrits : tous les élèves de la classe
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

                // Skip les calculs presents/admis si la classe est exemptée
                if !isExempted(session.ID, targetClass.ID, targetClass.Level) {
                        // Seuil effectif selon l'échelle du niveau (CP/CE /10, CM /20)
                        scale := averageScaleForLevel(targetClass.Level)
                        _, passThreshold, _ := GetSystemSettings()
                        effectiveThreshold := passThreshold * scale / 20.0

                        for _, s := range students {
                                res, ok := studentResults[s.ID]
                                if !ok || !res.HasAverage {
                                        continue
                                }
                                if s.Gender == "M" {
                                        lvl.Presents[0]++
                                } else {
                                        lvl.Presents[1]++
                                }
                                lvl.Presents[2]++

                                if res.Average >= effectiveThreshold {
                                        if s.Gender == "M" {
                                                lvl.Admis[0]++
                                        } else {
                                                lvl.Admis[1]++
                                        }
                                        lvl.Admis[2]++
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

        // DocumentLabel : sous-titre lisible précisant le périmètre du document.
        // Affiché dans le document pour éviter toute confusion entre les 2 versions.
        documentLabel := "CP1 au CM1"
        if levelGroup == "cm2" {
                documentLabel = "CM2 — Fin de cycle primaire"
        } else if levelGroup == "all" {
                documentLabel = "CP1 au CM2 (toutes classes)"
        }

        // === Récupérer le nom du directeur de l'école (User role=director) ===
        // Lookup par school_id. Si aucun directeur n'est affecté à l'école,
        // on laisse le champ vide (le frontend affichera un placeholder).
        var director models.User
        directorName := ""
        if err := database.DB.First(&director, "role = ? AND school_id = ?", models.RoleDirector, school.ID).Error; err == nil {
                directorName = director.FullName
        }

        data := SyntheseData{
                IEPName:        iep.Name,
                IEPRegion:      iep.Region,
                SchoolName:     school.Name,
                SchoolCode:     school.Code,
                SchoolAddr:     school.Address,
                EvalLabel:      evalLabel,
                EvalNumber:     evalNumber,
                Month:          0, // non utilisé maintenant (synthèse par école, pas par mois)
                Year:           year,
                Levels:         levels,
                Totals:         totals,
                LevelGroup:     levelGroup,
                DocumentLabel:  documentLabel,
                DirectorName:   directorName,
                InspectorName:  iep.InspectorName,
                InspectorEmail: iep.InspectorEmail,
                InspectorPhone: iep.InspectorPhone,
                IEPBP:          iep.BP,
        }

        jsonResponse(w, http.StatusOK, data)
}
