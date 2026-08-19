package handlers

import (
        "fmt"
        "net/http"
        "sort"

        "sygren-api/database"
        "sygren-api/middleware"
        "sygren-api/models"

        "github.com/go-chi/chi/v5"
)

// === Module 3 — Traitement Mathématique (cahier des charges §3) ===
//
// Calculs :
//   - Moyenne par matière : la note elle-même (1 note par élève/matière/session)
//   - Moyenne mensuelle (session) : moyenne pondérée par coefficient
//     (Somme des notes×coef / Somme des coefs)
//     Le cahier des charges stipule "Somme des notes / Nombre de matières",
//     mais avec coef=1 par défaut les deux méthodes sont équivalentes.
//     On utilise la pondération pour rester correct si coef != 1.
//   - Moyenne annuelle : moyenne des moyennes mensuelles (sessions validées)
//
// Classement : standard competition ranking ("1224") avec gestion des ex-aequo.
//   Ex : moyennes [18, 15, 15, 12] → rangs [1er, 2ème ex-aequo, 2ème ex-aequo, 4ème]
//
// Mentions automatiques (système français/ivoirien) :
//   < 5   : Très Insuffisant
//   5-8   : Insuffisant
//   8-10  : Faible
//   10-12 : Passable
//   12-14 : Assez Bien
//   14-16 : Bien
//   16-20 : Très Bien

// SubjectGrade — note d'un élève dans une matière
type SubjectGrade struct {
        SubjectID       string  `json:"subject_id"`
        SubjectName     string  `json:"subject_name"`
        Coefficient     float64 `json:"coefficient"`
        Grade           float64 `json:"grade"`            // -1 si aucune note (valeur brute)
        MaxScore        int     `json:"max_score"`         // barème (10, 20, 30, 50...)
        NormalizedValue float64 `json:"normalized_value"` // note normalisée sur /20
        HasGrade        bool    `json:"has_grade"`
        IsDraft         bool    `json:"is_draft"`
}

// StudentResult — résultat complet d'un élève pour une session
type StudentResult struct {
        StudentID    string         `json:"student_id"`
        Matricule    string         `json:"matricule"`
        FirstName    string         `json:"first_name"`
        LastName     string         `json:"last_name"`
        SubjectGrades []SubjectGrade `json:"subject_grades"`
        Average      float64        `json:"average"`     // moyenne pondérée
        HasAverage   bool           `json:"has_average"`  // false si aucune note
        Rank         int            `json:"rank"`         // 1-based
        RankLabel    string         `json:"rank_label"`   // "1er", "2ème ex-aequo"
        Mention      string         `json:"mention"`      // "Très Bien", etc.
        MentionColor string         `json:"mention_color"`
        GradedCount  int            `json:"graded_count"` // nombre de notes saisies
        TotalSubjects int           `json:"total_subjects"`
        HasDrafts    bool           `json:"has_drafts"`    // true si notes en brouillon
}

// ClassStatistics — statistiques agrégées de la classe
type ClassStatistics struct {
        StudentCount      int     `json:"student_count"`
        ClassAverage      float64 `json:"class_average"`
        MaxAverage        float64 `json:"max_average"`
        MinAverage        float64 `json:"min_average"`
        MedianAverage     float64 `json:"median_average"`
        PassRate          float64 `json:"pass_rate"`          // % élèves >= 10
        DistinctionRate   float64 `json:"distinction_rate"`   // % élèves >= 14
        CompletionRate    float64 `json:"completion_rate"`   // % notes saisies
        MentionDistribution map[string]int `json:"mention_distribution"`
}

// SessionResults — résultats complets d'une session
type SessionResults struct {
        SessionID    string           `json:"session_id"`
        ClassName    string           `json:"class_name"`
        ClassLevel   string           `json:"class_level"` // CP | CE | CM
        AverageScale int              `json:"average_scale"` // 10 (CP/CE) ou 20 (CM)
        SchoolName   string           `json:"school_name"`
        Month        int              `json:"month"`
        Year         int              `json:"year"`
        Status       string           `json:"status"`
        Results      []StudentResult  `json:"results"`
        Statistics   ClassStatistics  `json:"statistics"`
}

// averageScaleForLevel retourne l'échelle de la moyenne pour un niveau donné.
// CP et CE → /10, CM → /20 (cahier des charges §3 Module 2).
func averageScaleForLevel(level string) float64 {
        switch level {
        case "CP", "CE":
                return 10.0
        case "CM":
                return 20.0
        default:
                return 20.0
        }
}

// getMention détermine la mention selon la moyenne et le niveau.
// Les seuils sont lus depuis Settings (configurés sur /20) puis convertis
// proportionnellement selon l'échelle du niveau :
//   - CP/CE (moyenne /10) : seuil_effectif = seuil_settings × 10 / 20 = seuil_settings / 2
//     ex: Très Bien ≥ 16/20 → ≥ 8/10 pour CP/CE
//   - CM (moyenne /20) : seuil_effectif = seuil_settings (inchangé)
func getMention(avg float64, level string) (label, color string) {
        tresBien, bien, assezBien, passable, faible, insuffisant := GetMentionThresholds()
        scale := averageScaleForLevel(level)
        // Conversion proportionnelle des seuils (de /20 vers l'échelle du niveau)
        ratio := scale / 20.0
        tresBien *= ratio
        bien *= ratio
        assezBien *= ratio
        passable *= ratio
        faible *= ratio
        insuffisant *= ratio
        switch {
        case avg >= tresBien:
                return "Très Bien", "emerald"
        case avg >= bien:
                return "Bien", "green"
        case avg >= assezBien:
                return "Assez Bien", "lime"
        case avg >= passable:
                return "Passable", "amber"
        case avg >= faible:
                return "Faible", "orange"
        case avg >= insuffisant:
                return "Insuffisant", "red"
        default:
                return "Très Insuffisant", "rose"
        }
}

// rankLabel génère le label du rang avec gestion des ex-aequo
// rank est 1-based
func rankLabel(rank int, isExAequo bool) string {
        suffix := "er"
        if rank > 1 {
                suffix = "ème"
        }
        label := fmt.Sprintf("%d%s", rank, suffix)
        if isExAequo {
                label += " ex-aequo"
        }
        return label
}

// computeSessionResults calcule les résultats complets d'une session
func computeSessionResults(sessionID string) (*SessionResults, error) {
        // 1. Charger la session + classe + école
        var session models.EvaluationSession
        if err := database.DB.First(&session, "id = ?", sessionID).Error; err != nil {
                return nil, fmt.Errorf("session introuvable")
        }
        var cls models.Class
        if err := database.DB.First(&cls, "id = ?", session.ClassID).Error; err != nil {
                return nil, fmt.Errorf("classe introuvable")
        }
        var school models.School
        _ = database.DB.First(&school, "id = ?", cls.SchoolID).Error

        // 2. Charger les élèves de la classe (triés par nom)
        var students []models.Student
        if err := database.DB.Where("class_id = ?", cls.ID).
                Order("last_name ASC, first_name ASC").Find(&students).Error; err != nil {
                return nil, err
        }

        // 3. Charger les matières applicables à cette session
        //    - Composition : toutes les matières SAUF EPS (sauf si EPS est configurée
        //      pour le niveau de la classe via ses "levels")
        //    - Examen Blanc (CM2 uniquement) : toutes les matières, EPS INCLUSE
        var subjects []models.Subject
        subjectQuery := database.DB.Order("name ASC")
        if session.EvalType == "exam_blanc" {
                // Examen Blanc : toutes les matières, EPS incluse (réservé CM2)
                // Pas de filtre supplémentaire
        } else {
                // Composition : exclure EPS (qui est réservée aux examens blancs CM2)
                // sauf si EPS est explicitement configurée pour une classe de ce niveau
                // via Subject.levels (ex: "CM2" ou "CM1,CM2")
                subjectQuery = subjectQuery.Where("name != ?", "EPS").
                        Or("levels LIKE ?", "%"+cls.Name+"%")
        }
        if err := subjectQuery.Find(&subjects).Error; err != nil {
                return nil, err
        }

        // 4. Charger toutes les notes de la session
        var grades []models.Grade
        if err := database.DB.Where("session_id = ?", sessionID).Find(&grades).Error; err != nil {
                return nil, err
        }

        // Index des notes : studentId+subjectId → Grade
        gradeMap := make(map[string]models.Grade)
        for _, g := range grades {
                gradeMap[g.StudentID+"|"+g.SubjectID] = g
        }

        // 5. Construire les résultats par élève
        results := make([]StudentResult, 0, len(students))
        for _, st := range students {
                sr := StudentResult{
                        StudentID: st.ID,
                        Matricule: matriculeOrNA(st.Matricule),
                        FirstName: st.FirstName,
                        LastName:  st.LastName,
                        SubjectGrades: make([]SubjectGrade, 0, len(subjects)),
                        TotalSubjects: len(subjects),
                }

                totalWeighted := 0.0
                totalCoef := 0.0
                gradedCount := 0
                hasDrafts := false
                averageScale := averageScaleForLevel(cls.Level)

                for _, subj := range subjects {
                        // Récupérer le barème max pour cette matière + niveau de la classe
                        maxScore := getMaxScore(cls.Level, subj.ID)
                        sg := SubjectGrade{
                                SubjectID:   subj.ID,
                                SubjectName: subj.Name,
                                Coefficient: subj.Coefficient,
                                Grade:       -1,
                                MaxScore:    maxScore,
                        }
                        if g, ok := gradeMap[st.ID+"|"+subj.ID]; ok {
                                sg.Grade = g.Value
                                sg.HasGrade = true
                                sg.IsDraft = g.IsDraft
                                // Normaliser la note sur l'échelle du niveau :
                                //   CP/CE → /10, CM → /20
                                //   normalized = value × averageScale / max_score
                                sg.NormalizedValue = g.Value * averageScale / float64(maxScore)
                                if g.IsDraft {
                                        hasDrafts = true
                                }
                                totalWeighted += sg.NormalizedValue * subj.Coefficient
                                totalCoef += subj.Coefficient
                                gradedCount++
                        }
                        sr.SubjectGrades = append(sr.SubjectGrades, sg)
                }

                sr.GradedCount = gradedCount
                sr.HasDrafts = hasDrafts
                if totalCoef > 0 && gradedCount > 0 {
                        sr.Average = totalWeighted / totalCoef
                        sr.HasAverage = true
                        // getMention prend maintenant le niveau pour convertir les seuils proportionnellement
                        sr.Mention, sr.MentionColor = getMention(sr.Average, cls.Level)
                } else {
                        sr.HasAverage = false
                        sr.Mention = "Non évalué"
                        sr.MentionColor = "slate"
                }

                results = append(results, sr)
        }

        // 6. Calculer le classement (standard competition ranking avec ex-aequo)
        // Trier par moyenne décroissante (ceux sans moyenne à la fin)
        sort.SliceStable(results, func(i, j int) bool {
                if results[i].HasAverage != results[j].HasAverage {
                        return results[i].HasAverage // moyennes d'abord
                }
                if !results[i].HasAverage {
                        return false // aucun rang pour les sans-moyenne
                }
                return results[i].Average > results[j].Average
        })

        // Attribution des rangs avec ex-aequo
        currentRank := 0
        prevAvg := -1.0
        exAequoCount := 0
        for i := range results {
                if !results[i].HasAverage {
                        results[i].Rank = 0
                        results[i].RankLabel = "—"
                        continue
                }
                if results[i].Average == prevAvg {
                        // Ex-aequo : même rang que le précédent
                        exAequoCount++
                } else {
                        currentRank = i + 1 // 1-based
                        exAequoCount = 0
                }
                results[i].Rank = currentRank
                results[i].RankLabel = rankLabel(currentRank, exAequoCount > 0)
                prevAvg = results[i].Average
        }

        // 7. Statistiques de classe (avec niveau pour conversion des seuils)
        stats := computeClassStatistics(results, cls.Level)

        return &SessionResults{
                SessionID:    session.ID,
                ClassName:     cls.Name,
                ClassLevel:    cls.Level,
                AverageScale:  int(averageScaleForLevel(cls.Level)),
                SchoolName:    school.Name,
                Month:         session.Month,
                Year:          session.Year,
                Status:        session.Status,
                Results:    results,
                Statistics: stats,
        }, nil
}

// computeClassStatistics calcule les statistiques agrégées de la classe.
// level est utilisé pour convertir proportionnellement les seuils de réussite/distinction
// (configurés sur /20 dans Settings) selon l'échelle du niveau (CP/CE → /10, CM → /20).
func computeClassStatistics(results []StudentResult, level string) ClassStatistics {
        stats := ClassStatistics{
                StudentCount:        len(results),
                MentionDistribution: make(map[string]int),
        }

        // Collecter les moyennes valides
        averages := make([]float64, 0, len(results))
        for _, r := range results {
                if r.HasAverage {
                        averages = append(averages, r.Average)
                        stats.MentionDistribution[r.Mention]++
                }
        }
        if len(averages) == 0 {
                return stats
        }

        // Tri pour min/max/médiane
        sorted := make([]float64, len(averages))
        copy(sorted, averages)
        sort.Float64s(sorted)

        // Seuils dynamiques depuis les Settings (configurables via Paramètres)
        // Conversion proportionnelle selon l'échelle du niveau
        _, passThreshold, distinctionThreshold := GetSystemSettings()
        ratio := averageScaleForLevel(level) / 20.0
        passThreshold *= ratio
        distinctionThreshold *= ratio

        sum := 0.0
        passCount := 0
        distinctionCount := 0
        for _, a := range averages {
                sum += a
                if a >= passThreshold {
                        passCount++
                }
                if a >= distinctionThreshold {
                        distinctionCount++
                }
        }

        stats.ClassAverage = sum / float64(len(averages))
        stats.MaxAverage = sorted[len(sorted)-1]
        stats.MinAverage = sorted[0]
        // Médiane
        mid := len(sorted) / 2
        if len(sorted)%2 == 0 {
                stats.MedianAverage = (sorted[mid-1] + sorted[mid]) / 2
        } else {
                stats.MedianAverage = sorted[mid]
        }
        stats.PassRate = float64(passCount) / float64(len(averages)) * 100
        stats.DistinctionRate = float64(distinctionCount) / float64(len(averages)) * 100

        // Taux de complétion (notes saisies / attendues)
        totalGraded := 0
        totalExpected := 0
        for _, r := range results {
                totalGraded += r.GradedCount
                totalExpected += r.TotalSubjects
        }
        if totalExpected > 0 {
                stats.CompletionRate = float64(totalGraded) / float64(totalExpected) * 100
        }

        return stats
}

// === Endpoints HTTP ===

// GetSessionResults retourne les résultats complets d'une session.
// Accessible à tous les rôles authentifiés (RBAC par périmètre vérifié).
func GetSessionResults(w http.ResponseWriter, r *http.Request) {
        sessionID := chi.URLParam(r, "id")
        if sessionID == "" {
                middleware.JSONError(w, "id de session requis", http.StatusBadRequest)
                return
        }

        // Vérifier l'accès (RBAC par périmètre)
        if _, err := getSessionForUser(r, sessionID); err != nil {
                middleware.JSONError(w, err.Error(), http.StatusForbidden)
                return
        }

        results, err := computeSessionResults(sessionID)
        if err != nil {
                middleware.JSONError(w, err.Error(), http.StatusInternalServerError)
                return
        }

        jsonResponse(w, http.StatusOK, results)
}

// AnnualResult — résultat annuel d'un élève (agrégation des sessions)
type AnnualResult struct {
        StudentID      string             `json:"student_id"`
        Matricule      string             `json:"matricule"`
        FirstName      string             `json:"first_name"`
        LastName       string             `json:"last_name"`
        ClassName      string             `json:"class_name"`
        Year           int                `json:"year"`
        SessionCount   int                `json:"session_count"`
        AnnualAverage  float64            `json:"annual_average"`
        HasAnnual      bool               `json:"has_annual"`
        Mention        string             `json:"mention"`
        MentionColor   string             `json:"mention_color"`
        Sessions       []SessionSummary   `json:"sessions"`
}

// SessionSummary — résumé d'une session pour le bilan annuel
type SessionSummary struct {
        SessionID string  `json:"session_id"`
        Month    int     `json:"month"`
        Year     int     `json:"year"`
        Average  float64  `json:"average"`
        HasAverage bool   `json:"has_average"`
        Rank     int     `json:"rank"`
        Mention  string  `json:"mention"`
}

// GetStudentAnnualResults retourne le bilan annuel d'un élève.
// Agrège les moyennes de toutes les sessions (validées ou non) de l'année.
func GetStudentAnnualResults(w http.ResponseWriter, r *http.Request) {
        studentID := chi.URLParam(r, "id")
        yearStr := r.URL.Query().Get("year")
        if studentID == "" {
                middleware.JSONError(w, "id d'élève requis", http.StatusBadRequest)
                return
        }

        var student models.Student
        if err := database.DB.First(&student, "id = ?", studentID).Error; err != nil {
                middleware.JSONError(w, "élève introuvable", http.StatusNotFound)
                return
        }

        // Vérifier l'accès : l'élève doit appartenir au périmètre de l'utilisateur
        role := ctxRole(r)
        var cls models.Class
        if err := database.DB.First(&cls, "id = ?", student.ClassID).Error; err != nil {
                middleware.JSONError(w, "classe introuvable", http.StatusInternalServerError)
                return
        }
        switch role {
        case "inspector":
                var school models.School
                if err := database.DB.First(&school, "id = ?", cls.SchoolID).Error; err != nil {
                        middleware.JSONError(w, "accès refusé", http.StatusForbidden)
                        return
                }
                if school.IEPID != ctxIEPID(r) {
                        middleware.JSONError(w, "accès refusé", http.StatusForbidden)
                        return
                }
        case "director":
                if cls.SchoolID != ctxSchoolID(r) {
                        middleware.JSONError(w, "accès refusé", http.StatusForbidden)
                        return
                }
        case "teacher":
                if cls.TeacherID == nil || *cls.TeacherID != ctxUserID(r) {
                        middleware.JSONError(w, "accès refusé", http.StatusForbidden)
                        return
                }
        }

        // Année : paramètre ou année courante
        year := 0
        if yearStr != "" {
                fmt.Sscanf(yearStr, "%d", &year)
        }
        if year == 0 {
                year = 2026 // année par défaut dans le sandbox
        }

        // Charger toutes les sessions de la classe de l'élève pour l'année
        var sessions []models.EvaluationSession
        if err := database.DB.Where("class_id = ? AND year = ?", student.ClassID, year).
                Order("month ASC").Find(&sessions).Error; err != nil {
                middleware.JSONError(w, "erreur récupération sessions", http.StatusInternalServerError)
                return
        }

        // Calculer les résultats pour chaque session et extraire la moyenne de l'élève
        summaries := make([]SessionSummary, 0, len(sessions))
        sumAvg := 0.0
        validCount := 0
        for _, s := range sessions {
                results, err := computeSessionResults(s.ID)
                if err != nil {
                        continue
                }
                // Trouver l'élève dans les résultats
                for _, r := range results.Results {
                        if r.StudentID == studentID {
                                summaries = append(summaries, SessionSummary{
                                        SessionID: s.ID,
                                        Month:    s.Month,
                                        Year:     s.Year,
                                        Average:  r.Average,
                                        HasAverage: r.HasAverage,
                                        Rank:     r.Rank,
                                        Mention:  r.Mention,
                                })
                                if r.HasAverage {
                                        sumAvg += r.Average
                                        validCount++
                                }
                                break
                        }
                }
        }

        annual := AnnualResult{
                StudentID:    student.ID,
                Matricule:    matriculeOrNA(student.Matricule),
                FirstName:    student.FirstName,
                LastName:     student.LastName,
                ClassName:    cls.Name,
                Year:         year,
                SessionCount: len(sessions),
                Sessions:     summaries,
        }
        if validCount > 0 {
                annual.AnnualAverage = sumAvg / float64(validCount)
                annual.HasAnnual = true
                annual.Mention, annual.MentionColor = getMention(annual.AnnualAverage, cls.Level)
        } else {
                annual.HasAnnual = false
                annual.Mention = "Non évalué"
                annual.MentionColor = "slate"
        }

        jsonResponse(w, http.StatusOK, annual)
}
