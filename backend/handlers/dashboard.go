package handlers

import (
        "net/http"
        "strconv"

        "sygren-api/database"
        "sygren-api/middleware"
        "sygren-api/models"
)

// === Module 5 — Tableaux de Bord (cahier des charges §3) ===
//
// Vue macroscopique selon le rôle :
//   - admin    : vue globale (toutes les IEP/écoles)
//   - inspector: vue de sa circonscription (son IEP)
//   - director : vue de son école (ses classes)
//   - teacher  : vue de sa classe (redirigé vers la grille de saisie)
//
// Filtres supportés (query params) :
//   - year : année scolaire (défaut : année courante)
//   - gender : "M" | "F" | "" (tous)
//   - level : "CP" | "CE" | "CM" | "" (tous)
//
// Contenu :
//   - KPIs : écoles, classes, élèves, enseignants, sessions
//   - Jauges de complétion : % de saisie clôturée par période
//   - Comparatif multi-entités (écoles ou classes) avec moyennes
//   - Distribution des mentions (Très Bien → Très Insuffisant)
//   - Tendance mensuelle (évolution des moyennes)
//   - Comparaison inter-annuelle (year vs year-1)

// === Types de réponse ===

type SessionStats struct {
        Total    int `json:"total"`
        Draft    int `json:"draft"`
        Open     int `json:"open"`
        Closed   int `json:"closed"`
        Validated int `json:"validated"`
}

type MentionDistribution struct {
        Labels []string `json:"labels"`
        Values []int    `json:"values"`
}

type EntityPerformance struct {
        ID         string  `json:"id"`
        Name       string  `json:"name"`
        StudentCount int    `json:"student_count"`
        ClassCount  int    `json:"class_count,omitempty"`
        CompletionRate float64 `json:"completion_rate"`
        AvgPerformance  float64 `json:"avg_performance"`
        SessionCount int    `json:"session_count"`
}

type MonthlyTrend struct {
        Month       int     `json:"month"`
        Year        int     `json:"year"`
        Label       string  `json:"label"`
        CompletionRate float64 `json:"completion_rate"`
        AvgPerformance  float64 `json:"avg_performance"`
        StudentCount int    `json:"student_count"`
}

type DashboardData struct {
        // Périmètre affiché
        Scope       string `json:"scope"`        // global | iep | school
        ScopeName   string `json:"scope_name"`

        // Filtres actifs
        YearFilter   int    `json:"year_filter"`
        GenderFilter string `json:"gender_filter"` // "" | "M" | "F"
        LevelFilter  string `json:"level_filter"`  // "" | "CP" | "CE" | "CM"

        // KPIs globaux
        SchoolCount    int `json:"school_count"`
        ClassCount     int `json:"class_count"`
        StudentCount   int `json:"student_count"`
        TeacherCount   int `json:"teacher_count"`
        SessionStats   SessionStats `json:"session_stats"`

        // Taux de complétion global
        CompletionRate float64 `json:"completion_rate"`
        AvgPerformance float64 `json:"avg_performance"`
        PassRate       float64 `json:"pass_rate"`

        // Détails
        Schools       []EntityPerformance  `json:"schools,omitempty"`        // admin/inspector
        Classes       []EntityPerformance  `json:"classes,omitempty"`        // director
        Mentions      MentionDistribution  `json:"mentions"`
        MonthlyTrend  []MonthlyTrend        `json:"monthly_trend"`

        // Comparaison inter-annuelle
        YearComparison *YearComparison `json:"year_comparison,omitempty"`
}

// YearComparison : comparaison année courante vs année précédente
type YearComparison struct {
        CurrentYear  int     `json:"current_year"`
        PreviousYear int     `json:"previous_year"`
        CurrentPerf  float64 `json:"current_perf"`
        PreviousPerf float64 `json:"previous_perf"`
        PerfDelta    float64 `json:"perf_delta"` // current - previous
        CurrentPass  float64 `json:"current_pass_rate"`
        PreviousPass float64 `json:"previous_pass_rate"`
        PassDelta    float64 `json:"pass_delta"` // current - previous
}

// GetDashboard returns aggregated data based on the user's scope.
// Endpoint : GET /api/dashboard?year=2026&gender=M&level=CP
// Filtres optionnels : year (défaut: année courante), gender (M/F), level (CP/CE/CM)
func GetDashboard(w http.ResponseWriter, r *http.Request) {
        role := ctxRole(r)

        // Lire les filtres
        year := 0
        if v := r.URL.Query().Get("year"); v != "" {
                if n, err := strconv.Atoi(v); err == nil {
                        year = n
                }
        }
        if year == 0 {
                year = 2026 // défaut
        }
        gender := r.URL.Query().Get("gender") // "" | "M" | "F"
        level := r.URL.Query().Get("level")    // "" | "CP" | "CE" | "CM"

        // Stocker les filtres dans le context pour les sous-fonctions
        // On utilise des variables globales temporaires (simple, pas idéal mais efficace)
        dashboardFilters = DashboardFilters{
                Year:   year,
                Gender: gender,
                Level:  level,
        }

        switch role {
        case "admin":
                getAdminDashboard(w, r)
        case "inspector":
                getInspectorDashboard(w, r)
        case "director":
                getDirectorDashboard(w, r)
        case "teacher":
                getTeacherDashboard(w, r)
        default:
                middleware.JSONError(w, "rôle non reconnu", http.StatusForbidden)
        }
}

// DashboardFilters stocke les filtres actifs pour la requête courante
type DashboardFilters struct {
        Year   int
        Gender string
        Level  string
}

var dashboardFilters DashboardFilters

// === Admin Dashboard : vue globale (toutes les IEP/écoles) ===
func getAdminDashboard(w http.ResponseWriter, r *http.Request) {
        f := dashboardFilters

        // KPIs globaux (filtrés par level si applicable)
        classQuery := database.DB.Model(&models.Class{})
        studentQuery := database.DB.Model(&models.Student{})
        if f.Level != "" {
                classQuery = classQuery.Where("level = ?", f.Level).
                        Joins("JOIN classes c ON c.id = students.class_id").
                        Where("c.level = ?", f.Level)
        }
        var schoolCount, classCount, studentCount, teacherCount int64
        database.DB.Model(&models.School{}).Count(&schoolCount)
        classQuery.Count(&classCount)
        studentQuery.Count(&studentCount)
        database.DB.Model(&models.User{}).Where("role = ?", models.RoleTeacher).Count(&teacherCount)

        // Stats sessions (filtrées par année)
        sessionStats := computeSessionStats("")

        // Performance par école
        schools := computeSchoolsPerformance("")

        // Distribution mentions globale (filtrée)
        mentions := computeGlobalMentions()

        // Tendance mensuelle
        trend := computeMonthlyTrend("")

        // Moyenne performance globale + taux de réussite
        avgPerf, passRate := computeOverallPerformance("")

        // Comparaison inter-annuelle
        var yearComp *YearComparison
        prevPerf, prevPass := computeYearComparison(f.Year - 1)
        if prevPerf > 0 || prevPass > 0 || avgPerf > 0 {
                yearComp = &YearComparison{
                        CurrentYear:  f.Year,
                        PreviousYear: f.Year - 1,
                        CurrentPerf:  avgPerf,
                        PreviousPerf: prevPerf,
                        PerfDelta:    avgPerf - prevPerf,
                        CurrentPass:  passRate,
                        PreviousPass: prevPass,
                        PassDelta:    passRate - prevPass,
                }
        }

        dashboard := DashboardData{
                Scope:         "global",
                ScopeName:     "SYGREN — Vue globale",
                YearFilter:    f.Year,
                GenderFilter:  f.Gender,
                LevelFilter:   f.Level,
                SchoolCount:   int(schoolCount),
                ClassCount:    int(classCount),
                StudentCount:  int(studentCount),
                TeacherCount:  int(teacherCount),
                SessionStats:  sessionStats,
                CompletionRate: sessionStats.completionRate(),
                AvgPerformance: avgPerf,
                PassRate:      passRate,
                Schools:       schools,
                Mentions:      mentions,
                MonthlyTrend:  trend,
                YearComparison: yearComp,
        }

        jsonResponse(w, http.StatusOK, dashboard)
}

// computeYearComparison calcule perf + pass rate pour une année donnée
func computeYearComparison(year int) (avgPerf, passRate float64) {
        var sessions []models.EvaluationSession
        database.DB.Where("year = ?", year).Find(&sessions)
        return aggregateSessionsPerformance(sessions)
}

// === Inspector Dashboard : vue de son IEP ===
func getInspectorDashboard(w http.ResponseWriter, r *http.Request) {
        iepID := ctxIEPID(r)
        if iepID == "" {
                jsonResponse(w, http.StatusOK, DashboardData{
                        Scope:     "iep",
                        ScopeName: "Aucune IEP assignée",
                })
                return
        }

        var iep models.IEP
        if err := database.DB.First(&iep, "id = ?", iepID).Error; err != nil {
                middleware.JSONError(w, "IEP introuvable", http.StatusNotFound)
                return
        }

        // Écoles de l'IEP
        var schools []models.School
        database.DB.Where("iep_id = ?", iepID).Find(&schools)

        // KPIs de la circonscription
        var classCount, studentCount, teacherCount int64
        database.DB.Model(&models.Class{}).
                Joins("JOIN schools ON schools.id = classes.school_id").
                Where("schools.iep_id = ?", iepID).Count(&classCount)
        database.DB.Model(&models.Student{}).
                Joins("JOIN classes ON classes.id = students.class_id").
                Joins("JOIN schools ON schools.id = classes.school_id").
                Where("schools.iep_id = ?", iepID).Count(&studentCount)
        database.DB.Model(&models.User{}).
                Joins("JOIN schools ON schools.id = users.school_id").
                Where("schools.iep_id = ? AND users.role = ?", iepID, models.RoleTeacher).
                Count(&teacherCount)

        // Stats sessions (filtrées par IEP)
        sessionStats := computeSessionStatsForIEP(iepID)
        schoolsPerf := computeSchoolsPerformance(iepID)
        mentions := computeIEPMentions(iepID)
        trend := computeMonthlyTrendForIEP(iepID)
        avgPerf, passRate := computeIEPPerformance(iepID)

        dashboard := DashboardData{
                Scope:         "iep",
                ScopeName:     "IEP " + iep.Name,
                SchoolCount:   len(schools),
                ClassCount:    int(classCount),
                StudentCount:  int(studentCount),
                TeacherCount:  int(teacherCount),
                SessionStats:  sessionStats,
                CompletionRate: sessionStats.completionRate(),
                AvgPerformance: avgPerf,
                PassRate:      passRate,
                Schools:       schoolsPerf,
                Mentions:      mentions,
                MonthlyTrend:  trend,
        }

        jsonResponse(w, http.StatusOK, dashboard)
}

// === Director Dashboard : vue de son école ===
func getDirectorDashboard(w http.ResponseWriter, r *http.Request) {
        schoolID := ctxSchoolID(r)
        if schoolID == "" {
                jsonResponse(w, http.StatusOK, DashboardData{
                        Scope:     "school",
                        ScopeName: "Aucune école assignée",
                })
                return
        }

        var school models.School
        if err := database.DB.First(&school, "id = ?", schoolID).Error; err != nil {
                middleware.JSONError(w, "école introuvable", http.StatusNotFound)
                return
        }

        // Classes de l'école
        var classes []models.Class
        database.DB.Where("school_id = ?", schoolID).Find(&classes)

        // KPIs
        var studentCount, teacherCount int64
        database.DB.Model(&models.Student{}).
                Joins("JOIN classes ON classes.id = students.class_id").
                Where("classes.school_id = ?", schoolID).Count(&studentCount)
        database.DB.Model(&models.User{}).
                Where("school_id = ? AND role = ?", schoolID, models.RoleTeacher).
                Count(&teacherCount)

        // Stats sessions de l'école
        sessionStats := computeSessionStatsForSchool(schoolID)
        classesPerf := computeClassesPerformance(schoolID)
        mentions := computeSchoolMentions(schoolID)
        trend := computeMonthlyTrendForSchool(schoolID)
        avgPerf, passRate := computeSchoolPerformance(schoolID)

        dashboard := DashboardData{
                Scope:         "school",
                ScopeName:     school.Name,
                ClassCount:    len(classes),
                StudentCount:  int(studentCount),
                TeacherCount:  int(teacherCount),
                SessionStats:  sessionStats,
                CompletionRate: sessionStats.completionRate(),
                AvgPerformance: avgPerf,
                PassRate:      passRate,
                Classes:       classesPerf,
                Mentions:      mentions,
                MonthlyTrend:  trend,
        }

        jsonResponse(w, http.StatusOK, dashboard)
}

// === Teacher Dashboard : vue simplifiée de sa classe ===
func getTeacherDashboard(w http.ResponseWriter, r *http.Request) {
        userID := ctxUserID(r)

        // Trouver la classe de l'enseignant
        var cls models.Class
        if err := database.DB.First(&cls, "teacher_id = ?", userID).Error; err != nil {
                jsonResponse(w, http.StatusOK, DashboardData{
                        Scope:     "class",
                        ScopeName: "Aucune classe assignée",
                })
                return
        }

        var school models.School
        _ = database.DB.First(&school, "id = ?", cls.SchoolID).Error

        var studentCount int64
        database.DB.Model(&models.Student{}).Where("class_id = ?", cls.ID).Count(&studentCount)

        // Stats sessions de cette classe
        sessionStats := computeSessionStatsForClass(cls.ID)
        mentions := computeClassMentions(cls.ID)
        trend := computeMonthlyTrendForClass(cls.ID)
        avgPerf, passRate := computeClassPerformance(cls.ID)

        dashboard := DashboardData{
                Scope:         "class",
                ScopeName:     "Classe " + cls.Name + " — " + school.Name,
                StudentCount:  int(studentCount),
                SessionStats:  sessionStats,
                CompletionRate: sessionStats.completionRate(),
                AvgPerformance: avgPerf,
                PassRate:      passRate,
                Mentions:      mentions,
                MonthlyTrend:  trend,
        }

        jsonResponse(w, http.StatusOK, dashboard)
}

// === Helpers de calcul ===

// completionRate calcule le taux de complétion d'une SessionStats.
// Méthode : sessions non en draft / sessions total.
// (draft = pas encore ouvertes, donc ne compte pas dans la complétion)
func (s SessionStats) completionRate() float64 {
        active := s.Open + s.Closed + s.Validated
        if active == 0 {
                return 0
        }
        // Sont "complétées" les sessions closed+validated
        return float64(s.Closed+s.Validated) / float64(active) * 100
}

// computeSessionStats calcule les stats sessions globales ou filtrées.
// Si scopeIEP/scopeSchool/scopeClass non vide, filtre les sessions.
func computeSessionStats(scope string) SessionStats {
        var sessions []models.EvaluationSession
        database.DB.Find(&sessions)
        return countSessionStatuses(sessions)
}

func computeSessionStatsForIEP(iepID string) SessionStats {
        // Approche A : sessions rattachées directement à une école (school_id).
        // On JOIN schools pour filtrer par IEP.
        var sessions []models.EvaluationSession
        database.DB.
                Joins("JOIN schools ON schools.id = evaluation_sessions.school_id").
                Where("schools.iep_id = ?", iepID).
                Find(&sessions)
        return countSessionStatuses(sessions)
}

func computeSessionStatsForSchool(schoolID string) SessionStats {
        // Approche A : filtrage direct par school_id (pas de JOIN classes).
        var sessions []models.EvaluationSession
        database.DB.Where("evaluation_sessions.school_id = ?", schoolID).Find(&sessions)
        return countSessionStatuses(sessions)
}

func computeSessionStatsForClass(classID string) SessionStats {
        // Approche A : les sessions sont par école. On récupère l'école de la classe
        // puis on filtre par school_id (les classes d'une même école partagent la
        // même session).
        var cls models.Class
        if err := database.DB.First(&cls, "id = ?", classID).Error; err != nil {
                return SessionStats{}
        }
        var sessions []models.EvaluationSession
        database.DB.Where("school_id = ?", cls.SchoolID).Find(&sessions)
        return countSessionStatuses(sessions)
}

func countSessionStatuses(sessions []models.EvaluationSession) SessionStats {
        stats := SessionStats{Total: len(sessions)}
        for _, s := range sessions {
                switch s.Status {
                case "draft":
                        stats.Draft++
                case "open":
                        stats.Open++
                case "closed":
                        stats.Closed++
                case "validated":
                        stats.Validated++
                }
        }
        return stats
}

// computeSchoolsPerformance calcule les KPIs par école (filtrées par IEP si non vide)
func computeSchoolsPerformance(iepID string) []EntityPerformance {
        query := database.DB.Model(&models.School{})
        if iepID != "" {
                query = query.Where("iep_id = ?", iepID)
        }
        var schools []models.School
        query.Order("name ASC").Find(&schools)

        result := make([]EntityPerformance, 0, len(schools))
        for _, s := range schools {
                ep := EntityPerformance{ID: s.ID, Name: s.Name}
                var cc, sc int64
                database.DB.Model(&models.Class{}).Where("school_id = ?", s.ID).Count(&cc)
                database.DB.Model(&models.Student{}).
                        Joins("JOIN classes ON classes.id = students.class_id").
                        Where("classes.school_id = ?", s.ID).Count(&sc)
                ep.ClassCount = int(cc)
                ep.StudentCount = int(sc)

                ss := computeSessionStatsForSchool(s.ID)
                ep.CompletionRate = ss.completionRate()
                ep.SessionCount = ss.Total
                avgPerf, _ := computeSchoolPerformance(s.ID)
                ep.AvgPerformance = avgPerf
                result = append(result, ep)
        }
        return result
}

// computeClassesPerformance : KPIs par classe d'une école
func computeClassesPerformance(schoolID string) []EntityPerformance {
        var classes []models.Class
        database.DB.Where("school_id = ?", schoolID).Order("name ASC").Find(&classes)

        result := make([]EntityPerformance, 0, len(classes))
        for _, c := range classes {
                ep := EntityPerformance{ID: c.ID, Name: c.Name}
                var sc int64
                database.DB.Model(&models.Student{}).Where("class_id = ?", c.ID).Count(&sc)
                ep.StudentCount = int(sc)

                ss := computeSessionStatsForClass(c.ID)
                ep.CompletionRate = ss.completionRate()
                ep.SessionCount = ss.Total
                avgPerf, _ := computeClassPerformance(c.ID)
                ep.AvgPerformance = avgPerf
                result = append(result, ep)
        }
        return result
}

// computeOverallPerformance calcule la moyenne globale et le taux de réussite
func computeOverallPerformance(scope string) (avgPerf, passRate float64) {
        return computePerformanceFromSessions("")
}
func computeIEPPerformance(iepID string) (avgPerf, passRate float64) {
        // Approche A : JOIN schools directement sur evaluation_sessions.school_id.
        var sessions []models.EvaluationSession
        database.DB.
                Joins("JOIN schools ON schools.id = evaluation_sessions.school_id").
                Where("schools.iep_id = ?", iepID).
                Find(&sessions)
        return aggregateSessionsPerformance(sessions)
}
func computeSchoolPerformance(schoolID string) (avgPerf, passRate float64) {
        var sessions []models.EvaluationSession
        database.DB.Where("evaluation_sessions.school_id = ?", schoolID).Find(&sessions)
        return aggregateSessionsPerformance(sessions)
}
func computeClassPerformance(classID string) (avgPerf, passRate float64) {
        // Approche A : les sessions sont par école. On remonte à l'école de la classe.
        var cls models.Class
        if err := database.DB.First(&cls, "id = ?", classID).Error; err != nil {
                return 0, 0
        }
        var sessions []models.EvaluationSession
        database.DB.Where("school_id = ?", cls.SchoolID).Find(&sessions)
        return aggregateSessionsPerformance(sessions)
}

func aggregateSessionsPerformance(sessions []models.EvaluationSession) (avgPerf, passRate float64) {
        if len(sessions) == 0 {
                return 0, 0
        }
        f := dashboardFilters
        totalAvg := 0.0
        totalPass := 0
        totalStudents := 0
        _, passThreshold, _ := GetSystemSettings()
        for _, s := range sessions {
                // Filtre par année
                if f.Year > 0 && s.Year != f.Year {
                        continue
                }
                results, err := computeSessionResults(s.ID)
                if err != nil {
                        continue
                }
                // Approche A : la session couvre plusieurs classes (CP1, CP2, ..., CM2).
                // Le niveau est désormais porté par chaque StudentResult (r.ClassLevel).
                // On applique donc le filtre niveau + le seuil effectif PAR ÉLÈVE.
                for _, r := range results.Results {
                        if !r.HasAverage {
                                continue
                        }
                        level := r.ClassLevel
                        if level == "" {
                                level = "CM" // défaut
                        }
                        // Filtre par niveau (par élève)
                        if f.Level != "" && level != f.Level {
                                continue
                        }
                        // Filtre par genre
                        if f.Gender != "" {
                                var stu models.Student
                                if err := database.DB.First(&stu, "id = ?", r.StudentID).Error; err != nil {
                                        continue
                                }
                                if stu.Gender != f.Gender {
                                        continue
                                }
                        }
                        // Seuil effectif selon l'échelle du niveau de l'élève
                        ratio := 20.0
                        if level == "CP" || level == "CE" {
                                ratio = 10.0
                        }
                        effectivePassThreshold := passThreshold * ratio / 20.0
                        totalAvg += r.Average
                        totalStudents++
                        if r.Average >= effectivePassThreshold {
                                totalPass++
                        }
                }
        }
        if totalStudents == 0 {
                return 0, 0
        }
        return totalAvg / float64(totalStudents), float64(totalPass) / float64(totalStudents) * 100
}

func computePerformanceFromSessions(scope string) (avgPerf, passRate float64) {
        var sessions []models.EvaluationSession
        database.DB.Find(&sessions)
        return aggregateSessionsPerformance(sessions)
}

// === Distribution des mentions ===

// computeGlobalMentions : distribution des mentions sur toutes les sessions
func computeGlobalMentions() MentionDistribution {
        var sessions []models.EvaluationSession
        database.DB.Find(&sessions)
        return aggregateMentions(sessions)
}
func computeIEPMentions(iepID string) MentionDistribution {
        // Approche A : JOIN schools sur evaluation_sessions.school_id.
        var sessions []models.EvaluationSession
        database.DB.
                Joins("JOIN schools ON schools.id = evaluation_sessions.school_id").
                Where("schools.iep_id = ?", iepID).
                Find(&sessions)
        return aggregateMentions(sessions)
}
func computeSchoolMentions(schoolID string) MentionDistribution {
        var sessions []models.EvaluationSession
        database.DB.Where("evaluation_sessions.school_id = ?", schoolID).Find(&sessions)
        return aggregateMentions(sessions)
}
func computeClassMentions(classID string) MentionDistribution {
        // Approche A : on remonte à l'école de la classe pour trouver les sessions.
        var cls models.Class
        if err := database.DB.First(&cls, "id = ?", classID).Error; err != nil {
                return MentionDistribution{Labels: []string{}, Values: []int{}}
        }
        var sessions []models.EvaluationSession
        database.DB.Where("school_id = ?", cls.SchoolID).Find(&sessions)
        return aggregateMentions(sessions)
}

func aggregateMentions(sessions []models.EvaluationSession) MentionDistribution {
        dist := make(map[string]int)
        for _, s := range sessions {
                results, err := computeSessionResults(s.ID)
                if err != nil {
                        continue
                }
                for _, r := range results.Results {
                        if r.HasAverage {
                                dist[r.Mention]++
                        }
                }
        }
        // Ordre canonique des mentions
        order := []string{
                "Très Bien", "Bien", "Assez Bien", "Passable",
                "Faible", "Insuffisant", "Très Insuffisant",
        }
        labels := []string{}
        values := []int{}
        for _, m := range order {
                if v, ok := dist[m]; ok && v > 0 {
                        labels = append(labels, m)
                        values = append(values, v)
                }
        }
        return MentionDistribution{Labels: labels, Values: values}
}

// === Tendance mensuelle ===

func computeMonthlyTrend(scope string) []MonthlyTrend {
        var sessions []models.EvaluationSession
        database.DB.Order("year ASC, month ASC").Find(&sessions)
        return aggregateMonthlyTrend(sessions)
}
func computeMonthlyTrendForIEP(iepID string) []MonthlyTrend {
        // Approche A : JOIN schools directement.
        var sessions []models.EvaluationSession
        database.DB.
                Joins("JOIN schools ON schools.id = evaluation_sessions.school_id").
                Where("schools.iep_id = ?", iepID).
                Order("evaluation_sessions.year ASC, evaluation_sessions.month ASC").
                Find(&sessions)
        return aggregateMonthlyTrend(sessions)
}
func computeMonthlyTrendForSchool(schoolID string) []MonthlyTrend {
        var sessions []models.EvaluationSession
        database.DB.Where("evaluation_sessions.school_id = ?", schoolID).
                Order("year ASC, month ASC").Find(&sessions)
        return aggregateMonthlyTrend(sessions)
}
func computeMonthlyTrendForClass(classID string) []MonthlyTrend {
        // Approche A : remonte à l'école de la classe.
        var cls models.Class
        if err := database.DB.First(&cls, "id = ?", classID).Error; err != nil {
                return []MonthlyTrend{}
        }
        var sessions []models.EvaluationSession
        database.DB.Where("school_id = ?", cls.SchoolID).
                Order("year ASC, month ASC").Find(&sessions)
        return aggregateMonthlyTrend(sessions)
}

func aggregateMonthlyTrend(sessions []models.EvaluationSession) []MonthlyTrend {
        // Grouper par mois/année
        type key struct{ month, year int }
        grouped := make(map[key][]models.EvaluationSession)
        for _, s := range sessions {
                k := key{s.Month, s.Year}
                grouped[k] = append(grouped[k], s)
        }
        // Trier par ordre chronologique
        var keys []key
        for k := range grouped {
                keys = append(keys, k)
        }
        // Tri simple (bubble sort suffisant pour petite liste)
        for i := 0; i < len(keys); i++ {
                for j := i + 1; j < len(keys); j++ {
                        if keys[j].year < keys[i].year ||
                                (keys[j].year == keys[i].year && keys[j].month < keys[i].month) {
                                keys[i], keys[j] = keys[j], keys[i]
                        }
                }
        }

        result := make([]MonthlyTrend, 0, len(keys))
        for _, k := range keys {
                sessions := grouped[k]
                avgPerf, _ := aggregateSessionsPerformance(sessions)
                ss := countSessionStatuses(sessions)
                // Compter les élèves concernés
                studentCount := 0
                for _, s := range sessions {
                        results, err := computeSessionResults(s.ID)
                        if err == nil {
                                studentCount += results.Statistics.StudentCount
                        }
                }
                result = append(result, MonthlyTrend{
                        Month:          k.month,
                        Year:           k.year,
                        Label:          monthLabelFR(k.month) + " " + intToStr(k.year),
                        CompletionRate: ss.completionRate(),
                        AvgPerformance: avgPerf,
                        StudentCount:   studentCount,
                })
        }
        return result
}

func intToStr(n int) string {
        if n == 0 {
                return "0"
        }
        neg := false
        if n < 0 {
                neg = true
                n = -n
        }
        digits := []byte{}
        for n > 0 {
                digits = append([]byte{byte('0' + n%10)}, digits...)
                n /= 10
        }
        if neg {
                digits = append([]byte{'-'}, digits...)
        }
        return string(digits)
}
