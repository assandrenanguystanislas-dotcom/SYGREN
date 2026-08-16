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
	SubjectID   string  `json:"subject_id"`
	SubjectName string  `json:"subject_name"`
	Coefficient float64 `json:"coefficient"`
	Grade       float64 `json:"grade"`    // -1 si aucune note
	HasGrade    bool    `json:"has_grade"`
	IsDraft     bool    `json:"is_draft"`
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
	SchoolName   string           `json:"school_name"`
	Month        int              `json:"month"`
	Year         int              `json:"year"`
	Status       string           `json:"status"`
	Results      []StudentResult  `json:"results"`
	Statistics   ClassStatistics  `json:"statistics"`
}

// getMention détermine la mention selon la moyenne (système français/ivoirien)
func getMention(avg float64) (label, color string) {
	switch {
	case avg >= 16:
		return "Très Bien", "emerald"
	case avg >= 14:
		return "Bien", "green"
	case avg >= 12:
		return "Assez Bien", "lime"
	case avg >= 10:
		return "Passable", "amber"
	case avg >= 8:
		return "Faible", "orange"
	case avg >= 5:
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

	// 3. Charger toutes les matières
	var subjects []models.Subject
	if err := database.DB.Order("name ASC").Find(&subjects).Error; err != nil {
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
			Matricule: st.Matricule,
			FirstName: st.FirstName,
			LastName:  st.LastName,
			SubjectGrades: make([]SubjectGrade, 0, len(subjects)),
			TotalSubjects: len(subjects),
		}

		totalWeighted := 0.0
		totalCoef := 0.0
		gradedCount := 0
		hasDrafts := false

		for _, subj := range subjects {
			sg := SubjectGrade{
				SubjectID:   subj.ID,
				SubjectName: subj.Name,
				Coefficient: subj.Coefficient,
				Grade:       -1,
			}
			if g, ok := gradeMap[st.ID+"|"+subj.ID]; ok {
				sg.Grade = g.Value
				sg.HasGrade = true
				sg.IsDraft = g.IsDraft
				if g.IsDraft {
					hasDrafts = true
				}
				totalWeighted += g.Value * subj.Coefficient
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
			sr.Mention, sr.MentionColor = getMention(sr.Average)
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

	// 7. Statistiques de classe
	stats := computeClassStatistics(results)

	return &SessionResults{
		SessionID:  session.ID,
		ClassName:  cls.Name,
		SchoolName: school.Name,
		Month:      session.Month,
		Year:       session.Year,
		Status:     session.Status,
		Results:    results,
		Statistics: stats,
	}, nil
}

// computeClassStatistics calcule les statistiques agrégées de la classe
func computeClassStatistics(results []StudentResult) ClassStatistics {
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

	sum := 0.0
	passCount := 0
	distinctionCount := 0
	for _, a := range averages {
		sum += a
		if a >= 10 {
			passCount++
		}
		if a >= 14 {
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
		Matricule:    student.Matricule,
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
		annual.Mention, annual.MentionColor = getMention(annual.AnnualAverage)
	} else {
		annual.HasAnnual = false
		annual.Mention = "Non évalué"
		annual.MentionColor = "slate"
	}

	jsonResponse(w, http.StatusOK, annual)
}
