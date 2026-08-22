package handlers

import (
	"bytes"
	"fmt"
	"net/http"
	"strconv"
	"sync"
	"time"

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
	Total     int `json:"total"`
	Draft     int `json:"draft"`
	Open      int `json:"open"`
	Closed    int `json:"closed"`
	Validated int `json:"validated"`
	// Statuts terminaux (annulation + archivage) — comptés séparément.
	// Ils ne participent pas au taux de complétion (ce ne sont pas des
	// sessions "actives" en cours de cycle).
	Cancelled int `json:"cancelled"`
	Archived  int `json:"archived"`
}

type MentionDistribution struct {
	Labels []string `json:"labels"`
	Values []int    `json:"values"`
}

type EntityPerformance struct {
	ID             string  `json:"id"`
	Name           string  `json:"name"`
	StudentCount   int     `json:"student_count"`
	ClassCount     int     `json:"class_count,omitempty"`
	CompletionRate float64 `json:"completion_rate"`
	AvgPerformance float64 `json:"avg_performance"`
	SessionCount   int     `json:"session_count"`
}

type MonthlyTrend struct {
	Month          int     `json:"month"`
	Year           int     `json:"year"`
	Label          string  `json:"label"`
	CompletionRate float64 `json:"completion_rate"`
	AvgPerformance float64 `json:"avg_performance"`
	StudentCount   int     `json:"student_count"`
}

type DashboardData struct {
	// Périmètre affiché
	Scope     string `json:"scope"` // global | iep | school
	ScopeName string `json:"scope_name"`

	// Filtres actifs
	YearFilter   int    `json:"year_filter"`
	GenderFilter string `json:"gender_filter"` // "" | "M" | "F"
	LevelFilter  string `json:"level_filter"`  // "" | "CP" | "CE" | "CM"

	// KPIs globaux
	SchoolCount  int          `json:"school_count"`
	ClassCount   int          `json:"class_count"`
	StudentCount int          `json:"student_count"`
	TeacherCount int          `json:"teacher_count"`
	SessionStats SessionStats `json:"session_stats"`

	// Taux de complétion global
	CompletionRate float64 `json:"completion_rate"`
	AvgPerformance float64 `json:"avg_performance"`
	PassRate       float64 `json:"pass_rate"`

	// Détails
	Schools      []EntityPerformance `json:"schools,omitempty"` // admin/inspector
	Classes      []EntityPerformance `json:"classes,omitempty"` // director
	Mentions     MentionDistribution `json:"mentions"`
	MonthlyTrend []MonthlyTrend      `json:"monthly_trend"`

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
// === Cache du dashboard (Fix C) ===
// Mémoire in-process, TTL 5 min, invalidé sur écriture (session/grade/student).
// Le dashboard = analytics, pas besoin de temps réel. Sur cache hit : ~0.1s
// au lieu de ~8.7s (N+1 computeSessionResults × 6 fonctions compute*).

const dashboardCacheTTL = 5 * time.Minute

type dashboardCacheEntry struct {
	data      []byte
	expiresAt time.Time
}

var (
	dashboardCache   = make(map[string]*dashboardCacheEntry)
	dashboardCacheMu sync.RWMutex
)

// dashboardCacheKey construit la clé selon rôle + filtres + scope user.
// admin : clé partagée (vue globale). Les autres : userID inclus (scope propre).
func dashboardCacheKey(role, userID string, year int, gender, level string) string {
	uid := userID
	if role == "admin" {
		uid = ""
	}
	return fmt.Sprintf("%s:%s:%d:%s:%s", role, uid, year, gender, level)
}

// InvalidateDashboardCache vide le cache. À appeler sur écriture
// (création/modification session, saisie note, import/bulk students).
// Exporté pour handlers/sessions.go, grades.go, students.go.
func InvalidateDashboardCache() {
	dashboardCacheMu.Lock()
	dashboardCache = make(map[string]*dashboardCacheEntry)
	dashboardCacheMu.Unlock()
}

// capturingResponseWriter capture les writes dans un buffer (pour mettre en
// cache la réponse JSON sans refactorer getAdminDashboard etc.).
type capturingResponseWriter struct {
	header http.Header
	buf    bytes.Buffer
	status int
}

func (c *capturingResponseWriter) Header() http.Header {
	if c.header == nil {
		c.header = make(http.Header)
	}
	return c.header
}
func (c *capturingResponseWriter) Write(b []byte) (int, error) {
	return c.buf.Write(b)
}
func (c *capturingResponseWriter) WriteHeader(code int) {
	c.status = code
}

// === Fix B : in-request cache de computeSessionResults ===
// Les 6 fonctions compute* du dashboard appellent toutes aggregateSessionsPerformance
// / aggregateMentions / aggregateMonthlyTrend, qui bouclent sur les sessions et
// rappellent computeSessionResultsCached(s.ID) à chaque fois. Avec N sessions, c'est
// N × (nombre de fonctions compute*) appels à computeSessionResults (chacun
// faisant ~10-15 queries). Ce cache memoize computeSessionResults par session
// AU SEIN d'une seule requête dashboard → N appels au lieu de N×6.
// Vidé au début de chaque GetDashboard (cache-miss path).
var (
	dashboardSessionResultsCache = make(map[string]*SessionResults)
	dashboardSessionCacheMu      sync.Mutex
)

// computeSessionResultsCached = computeSessionResults memoized par session.
// À utiliser dans les aggregate* du dashboard (pas ailleurs — le cache est
// global et vidé par GetDashboard à chaque cache-miss).
func computeSessionResultsCached(sessionID string) (*SessionResults, error) {
	dashboardSessionCacheMu.Lock()
	if cached, ok := dashboardSessionResultsCache[sessionID]; ok && cached != nil {
		dashboardSessionCacheMu.Unlock()
		return cached, nil
	}
	dashboardSessionCacheMu.Unlock()

	results, err := computeSessionResults(sessionID)
	if err != nil {
		return nil, err
	}

	dashboardSessionCacheMu.Lock()
	dashboardSessionResultsCache[sessionID] = results
	dashboardSessionCacheMu.Unlock()
	return results, nil
}

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
	level := r.URL.Query().Get("level")   // "" | "CP" | "CE" | "CM"

	// === Cache (Fix C) : check hit AVANT de calculer ===
	key := dashboardCacheKey(role, ctxUserID(r), year, gender, level)
	dashboardCacheMu.RLock()
	entry, ok := dashboardCache[key]
	dashboardCacheMu.RUnlock()
	if ok && time.Now().Before(entry.expiresAt) {
		w.Header().Set("Content-Type", "application/json")
		w.Write(entry.data)
		return
	}

	// Stocker les filtres dans le context pour les sous-fonctions
	dashboardFilters = DashboardFilters{
		Year:   year,
		Gender: gender,
		Level:  level,
	}

	// Clear the in-request session results cache (Fix B) — fresh per request.
	dashboardSessionCacheMu.Lock()
	dashboardSessionResultsCache = make(map[string]*SessionResults)
	dashboardSessionCacheMu.Unlock()

	// Miss : calculer en capturant la réponse (sans écrire dans le vrai w)
	crw := &capturingResponseWriter{}
	switch role {
	case "admin", "inspector":
		getAdminDashboard(crw, r)
	case "director":
		getDirectorDashboard(crw, r)
	case "teacher":
		getTeacherDashboard(crw, r)
	default:
		middleware.JSONError(w, "rôle non reconnu", http.StatusForbidden)
		return
	}

	// Si erreur (status >= 400), ne pas cacher — écrire direct + return
	if crw.status >= 400 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(crw.status)
		w.Write(crw.buf.Bytes())
		return
	}

	// Cache + write
	data := crw.buf.Bytes()
	dashboardCacheMu.Lock()
	dashboardCache[key] = &dashboardCacheEntry{data: data, expiresAt: time.Now().Add(dashboardCacheTTL)}
	dashboardCacheMu.Unlock()
	w.Header().Set("Content-Type", "application/json")
	if crw.status != 0 {
		w.WriteHeader(crw.status)
	}
	w.Write(data)
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
		Scope:          "global",
		ScopeName:      "SYGREN — Vue globale",
		YearFilter:     f.Year,
		GenderFilter:   f.Gender,
		LevelFilter:    f.Level,
		SchoolCount:    int(schoolCount),
		ClassCount:     int(classCount),
		StudentCount:   int(studentCount),
		TeacherCount:   int(teacherCount),
		SessionStats:   sessionStats,
		CompletionRate: sessionStats.completionRate(),
		AvgPerformance: avgPerf,
		PassRate:       passRate,
		Schools:        schools,
		Mentions:       mentions,
		MonthlyTrend:   trend,
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
		Scope:          "iep",
		ScopeName:      "IEP " + iep.Name,
		SchoolCount:    len(schools),
		ClassCount:     int(classCount),
		StudentCount:   int(studentCount),
		TeacherCount:   int(teacherCount),
		SessionStats:   sessionStats,
		CompletionRate: sessionStats.completionRate(),
		AvgPerformance: avgPerf,
		PassRate:       passRate,
		Schools:        schoolsPerf,
		Mentions:       mentions,
		MonthlyTrend:   trend,
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
		Scope:          "school",
		ScopeName:      school.Name,
		ClassCount:     len(classes),
		StudentCount:   int(studentCount),
		TeacherCount:   int(teacherCount),
		SessionStats:   sessionStats,
		CompletionRate: sessionStats.completionRate(),
		AvgPerformance: avgPerf,
		PassRate:       passRate,
		Classes:        classesPerf,
		Mentions:       mentions,
		MonthlyTrend:   trend,
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
		Scope:          "class",
		ScopeName:      "Classe " + cls.Name + " — " + school.Name,
		StudentCount:   int(studentCount),
		SessionStats:   sessionStats,
		CompletionRate: sessionStats.completionRate(),
		AvgPerformance: avgPerf,
		PassRate:       passRate,
		Mentions:       mentions,
		MonthlyTrend:   trend,
	}

	jsonResponse(w, http.StatusOK, dashboard)
}

// === Helpers de calcul ===

// completionRate calcule le taux de complétion d'une SessionStats.
// Méthode : sessions "complétées" (closed+validated) / sessions "actives"
// (open+closed+validated). Les sessions draft (pas encore ouvertes),
// cancelled (annulées — n'ont pas eu lieu) et archived (terminées d'une
// année antérieure, hors cycle courant) sont exclues du dénominateur.
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
		case "cancelled":
			stats.Cancelled++
		case "archived":
			stats.Archived++
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
	// Fix E : SQL aggregation sur student_session_results (précalculé).
	// Avant : boucle sessions × computeSessionResultsCached × iterate results
	// + 1 query/student (filtre gender) = N+1. Maintenant : 1 query SQL.
	f := dashboardFilters
	var sIDs []string
	for _, s := range sessions {
		if f.Year > 0 && s.Year != f.Year {
			continue
		}
		sIDs = append(sIDs, s.ID)
	}
	if len(sIDs) == 0 {
		return 0, 0
	}
	_, passThreshold, _ := GetSystemSettings()
	// Normalise average sur /20 : avg * 20 / scale, puis compare au seuil /20.
	// (évite le bug GORM qui passe les seuils en TEXT → "numeric >= text" error)
	var result struct {
		AvgPerf       *float64
		TotalStudents int64
		Passed        int64
	}
	query := `SELECT AVG(average) as avg_perf, COUNT(*) as total_students,
                SUM(CASE WHEN (average * 20.0 / average_scale) >= ? THEN 1 ELSE 0 END) as passed
                FROM student_session_results
                WHERE session_id IN ? AND has_average = true`
	args := []interface{}{passThreshold, sIDs}
	if f.Level != "" {
		query += " AND class_level = ?"
		args = append(args, f.Level)
	}
	if f.Gender != "" {
		query += " AND student_id IN (SELECT id FROM students WHERE gender = ?)"
		args = append(args, f.Gender)
	}
	database.DB.Raw(query, args...).Scan(&result)
	if result.TotalStudents == 0 {
		return 0, 0
	}
	if result.AvgPerf != nil {
		avgPerf = *result.AvgPerf
	}
	passRate = float64(result.Passed) * 100 / float64(result.TotalStudents)
	return
}

func aggregateMentions(sessions []models.EvaluationSession) MentionDistribution {
	// Fix E : SQL sur student_session_results avec mention calculée en SQL
	// (normalise average sur /20 : avg * 20 / scale, puis compare aux seuils /20).
	f := dashboardFilters
	var sIDs []string
	for _, s := range sessions {
		if f.Year > 0 && s.Year != f.Year {
			continue
		}
		sIDs = append(sIDs, s.ID)
	}
	if len(sIDs) == 0 {
		return MentionDistribution{Labels: []string{}, Values: []int{}}
	}
	tresBien, bien, assezBien, passable, faible, insuffisant := GetMentionThresholds()
	query := `SELECT mention, COUNT(*) as cnt FROM (
                SELECT CASE
                        WHEN average * 20.0 / average_scale >= ? THEN 'Très Bien'
                        WHEN average * 20.0 / average_scale >= ? THEN 'Bien'
                        WHEN average * 20.0 / average_scale >= ? THEN 'Assez Bien'
                        WHEN average * 20.0 / average_scale >= ? THEN 'Passable'
                        WHEN average * 20.0 / average_scale >= ? THEN 'Faible'
                        WHEN average * 20.0 / average_scale >= ? THEN 'Insuffisant'
                        ELSE 'Très Insuffisant'
                END AS mention
                FROM student_session_results
                WHERE session_id IN ? AND has_average = true`
	args := []interface{}{tresBien, bien, assezBien, passable, faible, insuffisant, sIDs}
	if f.Level != "" {
		query += " AND class_level = ?"
		args = append(args, f.Level)
	}
	if f.Gender != "" {
		query += " AND student_id IN (SELECT id FROM students WHERE gender = ?)"
		args = append(args, f.Gender)
	}
	query += ") sub GROUP BY mention"
	type mentionCount struct {
		Mention string
		Cnt     int
	}
	var rows []mentionCount
	database.DB.Raw(query, args...).Scan(&rows)
	dist := make(map[string]int, len(rows))
	for _, r := range rows {
		dist[r.Mention] = r.Cnt
	}
	order := []string{"Très Bien", "Bien", "Assez Bien", "Passable", "Faible", "Insuffisant", "Très Insuffisant"}
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

func aggregateMonthlyTrend(sessions []models.EvaluationSession) []MonthlyTrend {
	// Fix E : SQL GROUP BY month/year sur student_session_results.
	f := dashboardFilters
	var sIDs []string
	for _, s := range sessions {
		if f.Year > 0 && s.Year != f.Year {
			continue
		}
		sIDs = append(sIDs, s.ID)
	}
	if len(sIDs) == 0 {
		return []MonthlyTrend{}
	}
	type trendRow struct {
		Month        int
		Year         int
		AvgPerf      *float64
		StudentCount int64
	}
	query := `SELECT es.month, es.year, AVG(r.average) as avg_perf,
                COUNT(DISTINCT r.student_id) as student_count
                FROM student_session_results r
                JOIN evaluation_sessions es ON es.id = r.session_id
                WHERE r.session_id IN ? AND r.has_average = true`
	args := []interface{}{sIDs}
	if f.Level != "" {
		query += " AND r.class_level = ?"
		args = append(args, f.Level)
	}
	if f.Gender != "" {
		query += " AND r.student_id IN (SELECT id FROM students WHERE gender = ?)"
		args = append(args, f.Gender)
	}
	query += " GROUP BY es.month, es.year ORDER BY es.year ASC, es.month ASC"
	var rows []trendRow
	database.DB.Raw(query, args...).Scan(&rows)
	// Group sessions par month/year pour CompletionRate (countSessionStatuses).
	type key struct{ month, year int }
	grouped := make(map[key][]models.EvaluationSession)
	for _, s := range sessions {
		if f.Year > 0 && s.Year != f.Year {
			continue
		}
		k := key{s.Month, s.Year}
		grouped[k] = append(grouped[k], s)
	}
	result := make([]MonthlyTrend, 0, len(rows))
	for _, r := range rows {
		k := key{r.Month, r.Year}
		var ap float64
		if r.AvgPerf != nil {
			ap = *r.AvgPerf
		}
		ss := countSessionStatuses(grouped[k])
		result = append(result, MonthlyTrend{
			Month:          r.Month,
			Year:           r.Year,
			Label:          monthLabelFR(r.Month) + " " + intToStr(r.Year),
			CompletionRate: ss.completionRate(),
			AvgPerformance: ap,
			StudentCount:   int(r.StudentCount),
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

// === Wrappers (chargent les sessions puis délèguent aux aggregates SQL) ===

func computePerformanceFromSessions(scope string) (avgPerf, passRate float64) {
	var sessions []models.EvaluationSession
	database.DB.Find(&sessions)
	return aggregateSessionsPerformance(sessions)
}

// === Distribution des mentions ===

func computeGlobalMentions() MentionDistribution {
	var sessions []models.EvaluationSession
	database.DB.Find(&sessions)
	return aggregateMentions(sessions)
}
func computeIEPMentions(iepID string) MentionDistribution {
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
	var cls models.Class
	if err := database.DB.First(&cls, "id = ?", classID).Error; err != nil {
		return MentionDistribution{Labels: []string{}, Values: []int{}}
	}
	var sessions []models.EvaluationSession
	database.DB.Where("school_id = ?", cls.SchoolID).Find(&sessions)
	return aggregateMentions(sessions)
}

// === Tendance mensuelle ===

func computeMonthlyTrend(scope string) []MonthlyTrend {
	var sessions []models.EvaluationSession
	database.DB.Order("year ASC, month ASC").Find(&sessions)
	return aggregateMonthlyTrend(sessions)
}
func computeMonthlyTrendForIEP(iepID string) []MonthlyTrend {
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
	var cls models.Class
	if err := database.DB.First(&cls, "id = ?", classID).Error; err != nil {
		return []MonthlyTrend{}
	}
	var sessions []models.EvaluationSession
	database.DB.Where("school_id = ?", cls.SchoolID).
		Order("year ASC, month ASC").Find(&sessions)
	return aggregateMonthlyTrend(sessions)
}
