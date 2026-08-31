package handlers

// === PDA IEPP — Plan d'Action Pluriannuel (compositions + examens blancs) ===
//
// Implémente le document officiel « SUIVI DU PLAN D'ACTION PLURIANNUEL DE
// L'IEPP » (niveaux CE et CM). Le plan suit TOUTES les évaluations de
// l'année dans les 3 matières désignées (Exploitation de texte,
// Mathématiques, Dictée) :
//
//   - kind="composition" : composition mensuelle — les notes sont DÉRIVÉES
//     du module Notes (EvaluationSession + Grade, barème réel GradeScale du
//     niveau et de la matière). Grille PDA en lecture seule : aucune double
//     saisie pour l'enseignant.
//   - kind="blanc" : examen blanc — saisie manuelle des 3 notes dans le PDA
//     (barème PDA fixe CE=/10, CM=/20).
//
// Les tableaux agrégés du document sont calculés côté serveur (source
// unique de vérité, consommée par le composant d'impression frontend).
//
// Maîtrise (« Admis ») : Present && note >= barème × exam.Threshold/100.
// Le barème est celui de la SOURCE :
//   - examen blanc  : barème PDA fixe (CE=/10, CM=/20) ;
//   - composition   : barème réel de la matière pour le niveau (GradeScale,
//     ex: CE=/30, CM=/50, Dictée /20).
// Un élève présent sans note dans une matière ne compte ni Admis ni
// Non Admis dans cette matière (saisie incomplète visible dans l'UI).
//
// Présence en composition : un élève ayant AU MOINS UNE note saisie dans la
// session (toutes matières) est considéré présent — le module Notes ne
// dispose pas de flag d'absence (une note 0 enregistrée pour un absent
// compte donc comme présent avec 0, sémantique existante du module Notes).
//
// RBAC : lecture = tout user authentifié (scope vérifié dans les handlers) ;
// écriture = RequireModule(models.ModuleGrades, "write") dans le routeur
// (mêmes droits que la saisie des notes : teacher+director+admin+inspector).

import (
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"sygren-api/database"
	"sygren-api/middleware"
	"sygren-api/models"

	"github.com/go-chi/chi/v5"
	"gorm.io/gorm"
)

// pdaMaxScore retourne le barème PDA d'un niveau (CE → /10, CM → /20).
// 0 = niveau non concerné par le plan d'action (CP exclu).
func pdaMaxScore(level string) int {
	switch level {
	case "CE":
		return 10
	case "CM":
		return 20
	}
	return 0
}

// pdaSeuil retourne le seuil absolu de maîtrise pour un niveau donné
// (ex: CE avec seuil 50 % → 5 ; CM avec seuil 50 % → 10).
func pdaSeuil(exam *models.PDAExam, level string) float64 {
	return float64(pdaMaxScore(level)) * float64(exam.Threshold) / 100
}

// === Les 3 matières désignées du plan d'action ===
// Index canoniques dans les tableaux [3] (exploitation, math, dictée).
var pdaSubjectKeys = [3]string{"exploitation", "math", "dictee"}

var pdaSubjectLabels = [3]string{"Exploitation de texte", "Mathématiques", "Dictée"}

// Alias de correspondance (noms normalisés : minuscules, sans accents,
// apostrophes unifiées, espaces réduits). La matière est rapprochée par le
// NOM exact normalisé — les écoles nomment parfois différemment (Maths…).
var pdaSubjectAliases = [3][]string{
	{"exploitation de texte", "exploitation des textes"},
	{"mathematiques", "maths"},
	{"dictee", "dictee d'orthographe"},
}

// pdaAccentReplacer unifie les variantes d'écriture des noms de matières.
var pdaAccentReplacer = strings.NewReplacer(
	"à", "a", "â", "a", "ä", "a", "á", "a",
	"é", "e", "è", "e", "ê", "e", "ë", "e",
	"î", "i", "ï", "i", "í", "i",
	"ô", "o", "ö", "o", "ó", "o",
	"ù", "u", "û", "u", "ü", "u", "ú", "u",
	"ç", "c", "œ", "oe",
	"'", "'", "‘", "'", "’", "'",
)

// pdaNormalizeName normalise un nom de matière pour la correspondance.
func pdaNormalizeName(s string) string {
	s = pdaAccentReplacer.Replace(strings.ToLower(strings.TrimSpace(s)))
	return strings.Join(strings.Fields(s), " ")
}

// pdaResolvePdaSubjects rapproche les 3 matières désignées avec les
// matières configurées (Subject, liste globale). Retourne une map
// clé → Subject ; clé absente = matière non notée dans les compositions
// (le reste du code la traite comme neutre : aucun Admis/Non Admis possible
// et un avertissement est retourné au frontend).
func pdaResolvePdaSubjects() map[string]*models.Subject {
	out := map[string]*models.Subject{}
	var subjects []models.Subject
	if err := database.DB.Find(&subjects).Error; err != nil {
		return out
	}
	aliasIdx := map[string]int{}
	for i := range pdaSubjectKeys {
		for _, a := range pdaSubjectAliases[i] {
			aliasIdx[a] = i
		}
	}
	for i := range subjects {
		if idx, ok := aliasIdx[pdaNormalizeName(subjects[i].Name)]; ok {
			key := pdaSubjectKeys[idx]
			if out[key] == nil {
				out[key] = &subjects[i]
			}
		}
	}
	return out
}

// pdaSubjectInfo — état d'une matière désignée pour une évaluation donnée
// (barème applicable + seuil de maîtrise absolu). Pour les examens blancs
// le barème est uniforme (PDA) ; pour les compositions il vient du
// GradeScale réel du niveau et de la matière.
type pdaSubjectInfo struct {
	Key         string  `json:"key"`
	Label       string  `json:"label"`
	Matched     bool    `json:"matched"`
	SubjectID   string  `json:"subject_id,omitempty"`
	SubjectName string  `json:"subject_name,omitempty"`
	MaxScore    float64 `json:"max_score"` // barème (0 = matière non notée)
	Seuil       float64 `json:"seuil"`     // MaxScore × Threshold %
}

// pdaSubjectInfosBlanc — barème PDA uniforme pour les 3 matières.
func pdaSubjectInfosBlanc(level string, threshold int) [3]pdaSubjectInfo {
	max := float64(pdaMaxScore(level))
	seuil := max * float64(threshold) / 100
	var out [3]pdaSubjectInfo
	for i, key := range pdaSubjectKeys {
		out[i] = pdaSubjectInfo{
			Key: key, Label: pdaSubjectLabels[i],
			Matched: true, SubjectName: pdaSubjectLabels[i],
			MaxScore: max, Seuil: seuil,
		}
	}
	return out
}

// pdaSubjectInfosComposition — barème réel (GradeScale) par matière.
func pdaSubjectInfosComposition(level string, threshold int, subs map[string]*models.Subject) [3]pdaSubjectInfo {
	var out [3]pdaSubjectInfo
	for i, key := range pdaSubjectKeys {
		info := pdaSubjectInfo{Key: key, Label: pdaSubjectLabels[i]}
		if s := subs[key]; s != nil {
			info.Matched = true
			info.SubjectID = s.ID
			info.SubjectName = s.Name
			info.MaxScore = float64(getMaxScore(level, s.ID))
		}
		info.Seuil = info.MaxScore * float64(threshold) / 100
		out[i] = info
	}
	return out
}

// === Source unifiée des notes (blanc = PDAResult, composition = Grade) ===
type pdaSourceRow struct {
	Present bool
	Notes   [3]*float64 // exploitation, math, dictée (nil = non saisie)
}

// pdaLoadBlancSources charge les résultats saisis manuellement pour un lot
// d'examens blancs → map[examID][studentID]row.
func pdaLoadBlancSources(examIDs []string, studentIDs []string) (map[string]map[string]pdaSourceRow, error) {
	out := map[string]map[string]pdaSourceRow{}
	if len(examIDs) == 0 || len(studentIDs) == 0 {
		return out, nil
	}
	var results []models.PDAResult
	if err := database.DB.
		Where("exam_id IN ? AND student_id IN ?", examIDs, studentIDs).
		Find(&results).Error; err != nil {
		return nil, err
	}
	for _, res := range results {
		m, ok := out[res.ExamID]
		if !ok {
			m = map[string]pdaSourceRow{}
			out[res.ExamID] = m
		}
		m[res.StudentID] = pdaSourceRow{
			Present: res.Present,
			Notes:   [3]*float64{res.NoteExploitation, res.NoteMath, res.NoteDictee},
		}
	}
	return out, nil
}

// pdaLoadCompositionSources dérive les notes des compositions depuis le
// module Notes (Grade) pour un lot de sessions → map[sessionID][studentID]row.
// Présence = au moins une note dans la session (toutes matières confondues).
func pdaLoadCompositionSources(sessionIDs []string, studentIDs []string, subs map[string]*models.Subject) (map[string]map[string]pdaSourceRow, error) {
	out := map[string]map[string]pdaSourceRow{}
	if len(sessionIDs) == 0 || len(studentIDs) == 0 {
		return out, nil
	}
	var grades []models.Grade
	if err := database.DB.
		Where("session_id IN ? AND student_id IN ?", sessionIDs, studentIDs).
		Order("updated_at ASC").
		Find(&grades).Error; err != nil {
		return nil, err
	}
	subjectIdx := map[string]int{}
	for i, key := range pdaSubjectKeys {
		if s := subs[key]; s != nil {
			subjectIdx[s.ID] = i
		}
	}
	for _, g := range grades {
		m, ok := out[g.SessionID]
		if !ok {
			m = map[string]pdaSourceRow{}
			out[g.SessionID] = m
		}
		row := m[g.StudentID]
		if idx, ok := subjectIdx[g.SubjectID]; ok {
			v := g.Value
			row.Notes[idx] = &v
		}
		row.Present = true
		m[g.StudentID] = row
	}
	return out, nil
}

// pdaCountRow — effectifs (Total | Filles | Garçons) d'une ligne du document.
type pdaCountRow struct {
	Total   int `json:"total"`
	Filles  int `json:"filles"`
	Garcons int `json:"garcons"`
}

// pct1 — pourcentage arrondi à 1 décimale (0 si dénominateur nul).
func pct1(a, b int) float64 {
	if b == 0 {
		return 0
	}
	return math.Round(float64(a)/float64(b)*1000) / 10
}

// pdaSchoolScopeForUser retourne l'école imposée au user (director/teacher)
// ou "" si le user est admin/inspector (périmètre large). Fallback enseignant
// via les classes enseignées (identique à getSessionForUser).
func pdaSchoolScopeForUser(r *http.Request) string {
	switch ctxRole(r) {
	case models.RoleDirector:
		return ctxSchoolID(r)
	case models.RoleTeacher:
		if sid := ctxSchoolID(r); sid != "" {
			return sid
		}
		var cls models.Class
		if err := database.DB.Where("teacher_id = ?", ctxUserID(r)).First(&cls).Error; err == nil {
			return cls.SchoolID
		}
	}
	return ""
}

// pdaExamError — erreur de scope avec statut HTTP associé.
type pdaExamError struct {
	status int
	msg    string
}

func (e *pdaExamError) Error() string { return e.msg }

// getPDAExamForUser charge l'évaluation du plan et vérifie le périmètre du user.
func getPDAExamForUser(r *http.Request, examID string) (*models.PDAExam, error) {
	var exam models.PDAExam
	if err := database.DB.First(&exam, "id = ?", examID).Error; err != nil {
		return nil, &pdaExamError{http.StatusNotFound, "évaluation du plan introuvable"}
	}
	if scope := pdaSchoolScopeForUser(r); scope != "" && exam.SchoolID != scope {
		return nil, &pdaExamError{http.StatusForbidden, "accès refusé : cette évaluation appartient à une autre école"}
	}
	return &exam, nil
}

// writePdaErr écrit la réponse d'erreur adaptée (404 / 403 / 400…).
func writePdaErr(w http.ResponseWriter, err error) {
	if pe, ok := err.(*pdaExamError); ok {
		middleware.JSONError(w, pe.msg, pe.status)
		return
	}
	middleware.JSONError(w, err.Error(), http.StatusBadRequest)
}

// pdaClassForExam vérifie que la classe cible appartient à l'école de
// l'évaluation et qu'elle est d'un niveau concerné par le plan (CE ou CM).
func pdaClassForExam(exam *models.PDAExam, classID string) (*models.Class, error) {
	var cls models.Class
	if err := database.DB.First(&cls, "id = ?", classID).Error; err != nil {
		return nil, fmt.Errorf("classe introuvable")
	}
	if cls.SchoolID != exam.SchoolID {
		return nil, fmt.Errorf("la classe n'appartient pas à l'école de cette évaluation")
	}
	if pdaMaxScore(cls.Level) == 0 {
		return nil, fmt.Errorf("le plan d'action concerne uniquement les niveaux CE et CM (classe %s exclue)", cls.Name)
	}
	return &cls, nil
}

// === Liste des évaluations du plan (compositions + examens blancs) ===
// GET /api/pda/exams?school_id=&year=
// director/teacher : périmètre imposé ; admin/inspector : tout ou school_id.
func ListPDAExams(w http.ResponseWriter, r *http.Request) {
	query := database.DB.Model(&models.PDAExam{})
	if scope := pdaSchoolScopeForUser(r); scope != "" {
		query = query.Where("school_id = ?", scope)
	} else if v := r.URL.Query().Get("school_id"); v != "" {
		query = query.Where("school_id = ?", v)
	}
	if v := r.URL.Query().Get("year"); v != "" {
		query = query.Where("year = ?", v)
	}

	var exams []models.PDAExam
	if err := query.Order("year DESC, created_at ASC").Find(&exams).Error; err != nil {
		middleware.JSONError(w, "erreur récupération évaluations du plan", http.StatusInternalServerError)
		return
	}

	// Enrichissement : nom de l'école + infos session (compositions).
	type examWithSchool struct {
		models.PDAExam
		SchoolName    string `json:"school_name,omitempty"`
		SessionMonth  *int   `json:"session_month,omitempty"`
		SessionStatus string `json:"session_status,omitempty"`
	}
	out := make([]examWithSchool, 0, len(exams))
	cache := map[string]string{}
	sessMap := map[string]models.EvaluationSession{}
	var compIDs []string
	for _, e := range exams {
		if e.Kind == models.PDAKindComposition && e.SessionID != nil {
			compIDs = append(compIDs, *e.SessionID)
		}
	}
	if len(compIDs) > 0 {
		var sessions []models.EvaluationSession
		if err := database.DB.Where("id IN ?", compIDs).Find(&sessions).Error; err == nil {
			for _, s := range sessions {
				sessMap[s.ID] = s
			}
		}
	}
	for _, e := range exams {
		name, ok := cache[e.SchoolID]
		if !ok {
			var sch models.School
			if err := database.DB.Select("name").First(&sch, "id = ?", e.SchoolID).Error; err == nil {
				name = sch.Name
			}
			cache[e.SchoolID] = name
		}
		item := examWithSchool{PDAExam: e, SchoolName: name}
		if e.Kind == models.PDAKindComposition && e.SessionID != nil {
			if s, ok := sessMap[*e.SessionID]; ok {
				m := s.Month
				item.SessionMonth = &m
				item.SessionStatus = s.Status
			}
		}
		out = append(out, item)
	}

	jsonResponse(w, http.StatusOK, map[string]interface{}{"exams": out, "count": len(out)})
}

// === Création d'une évaluation du plan (examen blanc OU composition) ===
// POST /api/pda/exams
//   - {kind:"blanc", school_id?, number?, year?, exam_date?, threshold?}
//     (comportement historique : numéro auto par école + année)
//   - {kind:"composition", session_id, school_id?, threshold?}
//     numéro + année imposés par la session (eval_number), unicité par
//     session → 409 si la composition est déjà suivie.
func CreatePDAExam(w http.ResponseWriter, r *http.Request) {
	var req struct {
		SchoolID  string `json:"school_id"`
		Kind      string `json:"kind"`       // "blanc" (défaut) | "composition"
		SessionID string `json:"session_id"` // requis si composition
		Number    int    `json:"number"`
		Year      int    `json:"year"`
		ExamDate  string `json:"exam_date"` // "2006-01-02" (optionnel, blancs)
		Threshold int    `json:"threshold"` // % du barème (optionnel, défaut 50)
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		middleware.JSONError(w, "payload invalide", http.StatusBadRequest)
		return
	}

	kind := req.Kind
	if kind == "" {
		kind = models.PDAKindBlanc
	}
	if kind != models.PDAKindBlanc && kind != models.PDAKindComposition {
		middleware.JSONError(w, "kind invalide (attendu : blanc|composition)", http.StatusBadRequest)
		return
	}

	// Résolution de l'école : director/teacher = périmètre imposé.
	schoolID := req.SchoolID
	if scope := pdaSchoolScopeForUser(r); scope != "" {
		schoolID = scope
	}
	if schoolID == "" {
		middleware.JSONError(w, "school_id est requis", http.StatusBadRequest)
		return
	}
	var school models.School
	if err := database.DB.First(&school, "id = ?", schoolID).Error; err != nil {
		middleware.JSONError(w, "école introuvable", http.StatusBadRequest)
		return
	}

	// Seuil de maîtrise en % du barème (défaut 50 %).
	threshold := req.Threshold
	if threshold == 0 {
		threshold = 50
	}
	if threshold < 1 || threshold > 100 {
		middleware.JSONError(w, "seuil invalide (attendu entre 1 et 100 %)", http.StatusBadRequest)
		return
	}

	var session *models.EvaluationSession
	year := req.Year
	number := req.Number

	if kind == models.PDAKindComposition {
		// === Composition mensuelle — dérivée du module Notes ===
		if req.SessionID == "" {
			middleware.JSONError(w, "session_id est requis pour suivre une composition mensuelle", http.StatusBadRequest)
			return
		}
		var s models.EvaluationSession
		if err := database.DB.First(&s, "id = ?", req.SessionID).Error; err != nil {
			middleware.JSONError(w, "session introuvable", http.StatusBadRequest)
			return
		}
		if s.SchoolID != schoolID {
			middleware.JSONError(w, "la session n'appartient pas à cette école", http.StatusBadRequest)
			return
		}
		if s.EvalType != "composition" {
			middleware.JSONError(w, "la session doit être une composition mensuelle (eval_type=composition) — les examens blancs sont saisis manuellement dans le plan", http.StatusBadRequest)
			return
		}
		if s.Status == "draft" {
			middleware.JSONError(w, "la session est en brouillon (aucune note saisissable) — ouvrez-la avant de la suivre dans le plan d'action", http.StatusBadRequest)
			return
		}
		if s.Status == "cancelled" {
			middleware.JSONError(w, "la session est annulée — elle ne peut pas être suivie dans le plan d'action", http.StatusBadRequest)
			return
		}
		year = s.Year
		number = s.EvalNumber
		session = &s
	} else {
		// === Examen blanc — comportement historique ===
		if year == 0 {
			year = time.Now().Year()
		}
		if year < 2000 || year > 2100 {
			middleware.JSONError(w, "année scolaire invalide (attendu entre 2000 et 2100)", http.StatusBadRequest)
			return
		}
		// Numéro : auto = MAX(number)+1 pour (école, année, blanc) si absent.
		if number == 0 {
			var maxNum int
			database.DB.Model(&models.PDAExam{}).
				Where("school_id = ? AND year = ? AND kind = ?", schoolID, year, models.PDAKindBlanc).
				Select("COALESCE(MAX(number), 0)").Scan(&maxNum)
			number = maxNum + 1
		}
	}

	if year < 2000 || year > 2100 {
		middleware.JSONError(w, "année scolaire invalide (attendu entre 2000 et 2100)", http.StatusBadRequest)
		return
	}
	if number < 1 || number > 100 {
		label := "numéro d'examen invalide"
		if kind == models.PDAKindComposition {
			label = "numéro de composition invalide"
		}
		middleware.JSONError(w, fmt.Sprintf("%s (attendu entre 1 et 100)", label), http.StatusBadRequest)
		return
	}

	// Unicité : par session (compositions) et par numéro (par école+année+kind).
	var dup int64
	if kind == models.PDAKindComposition {
		database.DB.Model(&models.PDAExam{}).
			Where("session_id = ?", session.ID).Count(&dup)
		if dup > 0 {
			middleware.JSONError(w, "cette composition mensuelle est déjà suivie dans le plan d'action", http.StatusConflict)
			return
		}
	} else {
		database.DB.Model(&models.PDAExam{}).
			Where("school_id = ? AND year = ? AND number = ? AND kind = ?", schoolID, year, number, kind).
			Count(&dup)
		if dup > 0 {
			middleware.JSONError(w, fmt.Sprintf("l'Examen Blanc N°%d existe déjà pour l'année %d", number, year), http.StatusConflict)
			return
		}
	}
	database.DB.Model(&models.PDAExam{}).
		Where("school_id = ? AND year = ? AND kind = ? AND number = ?", schoolID, year, kind, number).
		Count(&dup)
	if dup > 0 {
		if kind == models.PDAKindComposition {
			middleware.JSONError(w, fmt.Sprintf("la Composition N°%d est déjà suivie pour l'année %d", number, year), http.StatusConflict)
		} else {
			middleware.JSONError(w, fmt.Sprintf("l'Examen Blanc N°%d existe déjà pour l'année %d", number, year), http.StatusConflict)
		}
		return
	}

	exam := models.PDAExam{SchoolID: schoolID, Kind: kind, Number: number, Year: year, Threshold: threshold}
	if session != nil {
		sid := session.ID
		exam.SessionID = &sid
	}
	if kind == models.PDAKindBlanc && req.ExamDate != "" {
		d, err := time.Parse("2006-01-02", req.ExamDate)
		if err != nil {
			middleware.JSONError(w, "date d'examen invalide (format attendu AAAA-MM-JJ)", http.StatusBadRequest)
			return
		}
		exam.ExamDate = &d
	}
	if err := database.DB.Create(&exam).Error; err != nil {
		middleware.JSONError(w, "erreur création évaluation du plan", http.StatusInternalServerError)
		return
	}
	jsonResponse(w, http.StatusCreated, exam)
}

// === Suppression d'une évaluation du plan (cascade résultats + remédiation) ===
// DELETE /api/pda/exams/{id} — pour une composition, les notes du module
// Notes ne sont JAMAIS touchées (source de vérité préservée).
func DeletePDAExam(w http.ResponseWriter, r *http.Request) {
	exam, err := getPDAExamForUser(r, chi.URLParam(r, "id"))
	if err != nil {
		writePdaErr(w, err)
		return
	}
	if err := database.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("exam_id = ?", exam.ID).Delete(&models.PDAResult{}).Error; err != nil {
			return err
		}
		if err := tx.Where("exam_id = ?", exam.ID).Delete(&models.PDARemediation{}).Error; err != nil {
			return err
		}
		return tx.Delete(exam).Error
	}); err != nil {
		middleware.JSONError(w, "erreur suppression évaluation du plan", http.StatusInternalServerError)
		return
	}
	jsonResponse(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// === Résultats d'une classe pour une évaluation du plan ===
// GET /api/pda/exams/{id}/results?class_id=
// Retourne le roster complet de la classe avec les notes (saisies pour un
// blanc, dérivées de la session pour une composition) et les flags de
// maîtrise calculés (admis_exploitation/math/dictee/global).
func GetPDAResults(w http.ResponseWriter, r *http.Request) {
	exam, err := getPDAExamForUser(r, chi.URLParam(r, "id"))
	if err != nil {
		writePdaErr(w, err)
		return
	}
	classID := r.URL.Query().Get("class_id")
	if classID == "" {
		middleware.JSONError(w, "class_id est requis", http.StatusBadRequest)
		return
	}
	cls, err := pdaClassForExam(exam, classID)
	if err != nil {
		middleware.JSONError(w, err.Error(), http.StatusBadRequest)
		return
	}

	// Roster complet (tri alphabétique, même ordre que les autres grilles).
	var students []models.Student
	if err := database.DB.Where("class_id = ?", classID).
		Order("last_name ASC, first_name ASC").Find(&students).Error; err != nil {
		middleware.JSONError(w, "erreur récupération élèves", http.StatusInternalServerError)
		return
	}
	ids := make([]string, len(students))
	for i, s := range students {
		ids[i] = s.ID
	}

	// Source des notes selon le kind + barèmes par matière.
	readOnly := exam.Kind == models.PDAKindComposition
	var subjects [3]pdaSubjectInfo
	var source map[string]pdaSourceRow
	if readOnly {
		subs := pdaResolvePdaSubjects()
		subjects = pdaSubjectInfosComposition(cls.Level, exam.Threshold, subs)
		if exam.SessionID != nil {
			src, err := pdaLoadCompositionSources([]string{*exam.SessionID}, ids, subs)
			if err != nil {
				middleware.JSONError(w, "erreur récupération notes de la composition", http.StatusInternalServerError)
				return
			}
			source = src[*exam.SessionID]
		}
	} else {
		subjects = pdaSubjectInfosBlanc(cls.Level, exam.Threshold)
		src, err := pdaLoadBlancSources([]string{exam.ID}, ids)
		if err != nil {
			middleware.JSONError(w, "erreur récupération résultats", http.StatusInternalServerError)
			return
		}
		source = src[exam.ID]
	}

	type pdaStudentRow struct {
		StudentID         string   `json:"student_id"`
		Matricule         string   `json:"matricule"`
		LastName          string   `json:"last_name"`
		FirstName         string   `json:"first_name"`
		Gender            string   `json:"gender"`
		Present           bool     `json:"present"`
		NoteExploitation  *float64 `json:"note_exploitation"`
		NoteMath          *float64 `json:"note_math"`
		NoteDictee        *float64 `json:"note_dictee"`
		AdmisExploitation bool     `json:"admis_exploitation"`
		AdmisMath         bool     `json:"admis_math"`
		AdmisDictee       bool     `json:"admis_dictee"`
		AdmisGlobal       bool     `json:"admis_global"`
	}
	rows := make([]pdaStudentRow, 0, len(students))
	for _, s := range students {
		res := source[s.ID]
		adm := func(idx int) bool {
			return res.Present && res.Notes[idx] != nil && *res.Notes[idx] >= subjects[idx].Seuil
		}
		admExp, admMath, admDic := adm(0), adm(1), adm(2)
		rows = append(rows, pdaStudentRow{
			StudentID:         s.ID,
			Matricule:         matriculeOrNA(s.Matricule),
			LastName:          s.LastName,
			FirstName:         s.FirstName,
			Gender:            s.Gender,
			Present:           res.Present,
			NoteExploitation:  res.Notes[0],
			NoteMath:          res.Notes[1],
			NoteDictee:        res.Notes[2],
			AdmisExploitation: admExp,
			AdmisMath:         admMath,
			AdmisDictee:       admDic,
			AdmisGlobal:       admExp && admMath && admDic,
		})
	}

	// class.max_score / class.seuil = barème PDA uniforme (blancs). Pour une
	// composition les barèmes sont PAR MATIÈRE → subjects[] (max_score=0 ici).
	var maxScore, seuil float64
	if !readOnly {
		maxScore = subjects[0].MaxScore
		seuil = subjects[0].Seuil
	}

	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"exam":      exam,
		"read_only": readOnly,
		"subjects":  subjects,
		"class": map[string]interface{}{
			"id": cls.ID, "name": cls.Name, "level": cls.Level,
			"max_score": maxScore, "seuil": seuil,
		},
		"students": rows,
		"count":    len(rows),
	})
}

// === Saisie en lot des résultats (examens blancs uniquement) ===
// POST /api/pda/exams/{id}/results
// {class_id, results: [{student_id, present, note_exploitation?, note_math?, note_dictee?}]}
// Note null = effacer. Validation : élèves de la classe, notes 0..barème.
// Les compositions mensuelles sont dérivées du module Notes → 400.
func SavePDAResults(w http.ResponseWriter, r *http.Request) {
	exam, err := getPDAExamForUser(r, chi.URLParam(r, "id"))
	if err != nil {
		writePdaErr(w, err)
		return
	}
	if exam.Kind == models.PDAKindComposition {
		middleware.JSONError(w, "les résultats d'une composition mensuelle sont dérivés automatiquement des notes saisies dans le module Notes (grille en lecture seule)", http.StatusBadRequest)
		return
	}
	var req struct {
		ClassID string `json:"class_id"`
		Results []struct {
			StudentID        string   `json:"student_id"`
			Present          bool     `json:"present"`
			NoteExploitation *float64 `json:"note_exploitation"`
			NoteMath         *float64 `json:"note_math"`
			NoteDictee       *float64 `json:"note_dictee"`
		} `json:"results"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		middleware.JSONError(w, "payload invalide", http.StatusBadRequest)
		return
	}
	if req.ClassID == "" || len(req.Results) == 0 {
		middleware.JSONError(w, "class_id et results sont requis", http.StatusBadRequest)
		return
	}
	cls, err := pdaClassForExam(exam, req.ClassID)
	if err != nil {
		middleware.JSONError(w, err.Error(), http.StatusBadRequest)
		return
	}

	// Tous les élèves doivent appartenir à la classe.
	ids := make([]string, len(req.Results))
	seen := map[string]bool{}
	for i, item := range req.Results {
		if item.StudentID == "" || seen[item.StudentID] {
			middleware.JSONError(w, "student_id vide ou dupliqué dans results", http.StatusBadRequest)
			return
		}
		seen[item.StudentID] = true
		ids[i] = item.StudentID
	}
	var count int64
	database.DB.Model(&models.Student{}).
		Where("class_id = ? AND id IN ?", req.ClassID, ids).Count(&count)
	if count != int64(len(ids)) {
		middleware.JSONError(w, "un ou plusieurs élèves n'appartiennent pas à cette classe", http.StatusBadRequest)
		return
	}

	// Validation des notes (0..barème du niveau).
	maxScore := float64(pdaMaxScore(cls.Level))
	check := func(label string, n *float64) bool {
		return n == nil || (*n >= 0 && *n <= maxScore)
	}
	for _, item := range req.Results {
		if !check("exploitation", item.NoteExploitation) ||
			!check("mathématiques", item.NoteMath) ||
			!check("dictée", item.NoteDictee) {
			middleware.JSONError(w, fmt.Sprintf("note invalide : attendu entre 0 et %v (barème %s)", maxScore, cls.Level), http.StatusBadRequest)
			return
		}
	}

	if err := database.DB.Transaction(func(tx *gorm.DB) error {
		var existing []models.PDAResult
		if err := tx.Where("exam_id = ? AND student_id IN ?", exam.ID, ids).Find(&existing).Error; err != nil {
			return err
		}
		exMap := map[string]models.PDAResult{}
		for _, e := range existing {
			exMap[e.StudentID] = e
		}
		now := time.Now()
		for _, item := range req.Results {
			if e, ok := exMap[item.StudentID]; ok {
				if err := tx.Model(&models.PDAResult{}).Where("id = ?", e.ID).Updates(map[string]interface{}{
					"present":           item.Present,
					"note_exploitation": item.NoteExploitation,
					"note_math":         item.NoteMath,
					"note_dictee":       item.NoteDictee,
					"updated_at":        now,
				}).Error; err != nil {
					return err
				}
			} else {
				nr := models.PDAResult{
					ExamID:           exam.ID,
					StudentID:        item.StudentID,
					Present:          item.Present,
					NoteExploitation: item.NoteExploitation,
					NoteMath:         item.NoteMath,
					NoteDictee:       item.NoteDictee,
				}
				if err := tx.Create(&nr).Error; err != nil {
					return err
				}
			}
		}
		return nil
	}); err != nil {
		middleware.JSONError(w, "erreur enregistrement résultats", http.StatusInternalServerError)
		return
	}
	jsonResponse(w, http.StatusOK, map[string]interface{}{"status": "saved", "count": len(req.Results)})
}

// === Remédiation (lignes 2-3 du tableau 3 — saisie manuelle) ===
// GET /api/pda/exams/{id}/remediation?class_id=
func GetPDARemediation(w http.ResponseWriter, r *http.Request) {
	exam, err := getPDAExamForUser(r, chi.URLParam(r, "id"))
	if err != nil {
		writePdaErr(w, err)
		return
	}
	classID := r.URL.Query().Get("class_id")
	if classID == "" {
		middleware.JSONError(w, "class_id est requis", http.StatusBadRequest)
		return
	}
	if _, err := pdaClassForExam(exam, classID); err != nil {
		middleware.JSONError(w, err.Error(), http.StatusBadRequest)
		return
	}

	var row models.PDARemediation
	if err := database.DB.First(&row, "exam_id = ? AND class_id = ?", exam.ID, classID).Error; err != nil {
		// Aucune saisie → ligne à zéro (le composant d'impression affiche 0).
		row = models.PDARemediation{ExamID: exam.ID, ClassID: classID}
	}
	jsonResponse(w, http.StatusOK, row)
}

// === Saisie de la remédiation ===
// PUT /api/pda/exams/{id}/remediation {class_id, mise_a_niveau_*, remediation_*}
func SavePDARemediation(w http.ResponseWriter, r *http.Request) {
	exam, err := getPDAExamForUser(r, chi.URLParam(r, "id"))
	if err != nil {
		writePdaErr(w, err)
		return
	}
	var req models.PDARemediation
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		middleware.JSONError(w, "payload invalide", http.StatusBadRequest)
		return
	}
	if req.ClassID == "" {
		middleware.JSONError(w, "class_id est requis", http.StatusBadRequest)
		return
	}
	if _, err := pdaClassForExam(exam, req.ClassID); err != nil {
		middleware.JSONError(w, err.Error(), http.StatusBadRequest)
		return
	}
	counters := []int{
		req.MiseANiveauTotal, req.MiseANiveauGarcons, req.MiseANiveauFilles,
		req.RemediationTotal, req.RemediationGarcons, req.RemediationFilles,
	}
	for _, c := range counters {
		if c < 0 || c > 999 {
			middleware.JSONError(w, "compteur invalide (attendu entre 0 et 999)", http.StatusBadRequest)
			return
		}
	}

	var row models.PDARemediation
	if err := database.DB.First(&row, "exam_id = ? AND class_id = ?", exam.ID, req.ClassID).Error; err != nil {
		row = models.PDARemediation{ExamID: exam.ID, ClassID: req.ClassID}
	}
	row.MiseANiveauTotal = req.MiseANiveauTotal
	row.MiseANiveauGarcons = req.MiseANiveauGarcons
	row.MiseANiveauFilles = req.MiseANiveauFilles
	row.RemediationTotal = req.RemediationTotal
	row.RemediationGarcons = req.RemediationGarcons
	row.RemediationFilles = req.RemediationFilles

	if err := database.DB.Save(&row).Error; err != nil {
		middleware.JSONError(w, "erreur enregistrement remédiation", http.StatusInternalServerError)
		return
	}
	jsonResponse(w, http.StatusOK, row)
}

// === Synthèse agrégée (les 3 tableaux du document officiel) ===
// GET /api/pda/exams/{id}/summary?class_id=
// Source unique de vérité : le frontend d'impression ne recalcule rien.
//
// Définitions :
//   - Présents          = élèves présents à l'évaluation (blanc : flag saisi ;
//     composition : au moins une note dans la session)
//   - Admis (matière)   = Présent ET note >= seuil de la matière
//   - Non Admis (matière) = Présent ET note saisie ET note < seuil
//   - Admis (global)    = Admis dans les 3 matières
//   - En difficulté     = Présent ET NON admis global
func GetPDASummary(w http.ResponseWriter, r *http.Request) {
	exam, err := getPDAExamForUser(r, chi.URLParam(r, "id"))
	if err != nil {
		writePdaErr(w, err)
		return
	}
	classID := r.URL.Query().Get("class_id")
	if classID == "" {
		middleware.JSONError(w, "class_id est requis", http.StatusBadRequest)
		return
	}
	cls, err := pdaClassForExam(exam, classID)
	if err != nil {
		middleware.JSONError(w, err.Error(), http.StatusBadRequest)
		return
	}

	// Roster + source des notes (même logique que GetPDAResults).
	var students []models.Student
	if err := database.DB.Where("class_id = ?", classID).
		Order("last_name ASC, first_name ASC").Find(&students).Error; err != nil {
		middleware.JSONError(w, "erreur récupération élèves", http.StatusInternalServerError)
		return
	}
	ids := make([]string, len(students))
	for i, s := range students {
		ids[i] = s.ID
	}

	readOnly := exam.Kind == models.PDAKindComposition
	var subjects [3]pdaSubjectInfo
	var source map[string]pdaSourceRow
	if readOnly {
		subs := pdaResolvePdaSubjects()
		subjects = pdaSubjectInfosComposition(cls.Level, exam.Threshold, subs)
		if exam.SessionID != nil {
			src, err := pdaLoadCompositionSources([]string{*exam.SessionID}, ids, subs)
			if err != nil {
				middleware.JSONError(w, "erreur récupération notes de la composition", http.StatusInternalServerError)
				return
			}
			source = src[*exam.SessionID]
		}
	} else {
		subjects = pdaSubjectInfosBlanc(cls.Level, exam.Threshold)
		src, err := pdaLoadBlancSources([]string{exam.ID}, ids)
		if err != nil {
			middleware.JSONError(w, "erreur récupération résultats", http.StatusInternalServerError)
			return
		}
		source = src[exam.ID]
	}

	// Agrégats (Tableau 1, Tableau 2, Tableau 3 ligne 1).
	t1Presents := pdaCountRow{}
	t1Admis := pdaCountRow{}
	type subjectStats struct {
		Presents    pdaCountRow `json:"presents"`
		Admis       pdaCountRow `json:"admis"`
		NonAdmis    pdaCountRow `json:"non_admis"`
		PctAdmis    float64     `json:"pct_admis"`
		PctNonAdmis float64     `json:"pct_non_admis"`
	}
	t2 := map[string]*subjectStats{
		"exploitation": {},
		"math":         {},
		"dictee":       {},
	}
	difficultes := pdaCountRow{}

	bump := func(row *pdaCountRow, fille bool) {
		row.Total++
		if fille {
			row.Filles++
		} else {
			row.Garcons++
		}
	}

	for _, s := range students {
		res, ok := source[s.ID]
		if !ok || !res.Present {
			continue // seuls les présents alimentent les tableaux
		}
		fille := s.Gender == "F"
		bump(&t1Presents, fille)

		admis := [3]bool{}
		for k := 0; k < 3; k++ {
			st := t2[pdaSubjectKeys[k]]
			bump(&st.Presents, fille)
			admis[k] = res.Notes[k] != nil && *res.Notes[k] >= subjects[k].Seuil
			if admis[k] {
				bump(&st.Admis, fille)
			} else if res.Notes[k] != nil {
				bump(&st.NonAdmis, fille)
			}
		}

		if admis[0] && admis[1] && admis[2] {
			bump(&t1Admis, fille)
		} else {
			bump(&difficultes, fille)
		}
	}

	t1Pct := pct1(t1Admis.Total, t1Presents.Total)
	for _, st := range t2 {
		st.PctAdmis = pct1(st.Admis.Total, st.Presents.Total)
		st.PctNonAdmis = pct1(st.NonAdmis.Total, st.Presents.Total)
	}

	// Lignes 2-3 du tableau 3 (saisie manuelle).
	var rem models.PDARemediation
	if err := database.DB.First(&rem, "exam_id = ? AND class_id = ?", exam.ID, classID).Error; err != nil {
		rem = models.PDARemediation{ExamID: exam.ID, ClassID: classID}
	}

	// École + IEP pour l'en-tête officiel du document.
	var school models.School
	if err := database.DB.First(&school, "id = ?", exam.SchoolID).Error; err != nil {
		middleware.JSONError(w, "école introuvable", http.StatusInternalServerError)
		return
	}
	var iep *models.IEP
	if school.IEPID != "" {
		var i models.IEP
		if err := database.DB.First(&i, "id = ?", school.IEPID).Error; err == nil {
			iep = &i
		}
	}

	// class.max_score / class.seuil = barème PDA uniforme (blancs) ;
	// composition → 0 (barèmes PAR MATIÈRE dans subjects[]).
	var maxScore, seuil float64
	if !readOnly {
		maxScore = subjects[0].MaxScore
		seuil = subjects[0].Seuil
	}

	// Examen enrichi du mois de la session (compositions) pour le titre
	// du document officiel (« RESULTAT DE LA COMPOSITION N°X — OCTOBRE 2026 »).
	type examEnriched struct {
		models.PDAExam
		SessionMonth *int `json:"session_month,omitempty"`
	}
	examOut := examEnriched{PDAExam: *exam}
	if readOnly && exam.SessionID != nil {
		var s models.EvaluationSession
		if err := database.DB.Select("month").First(&s, "id = ?", *exam.SessionID).Error; err == nil {
			m := s.Month
			examOut.SessionMonth = &m
		}
	}

	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"exam":      examOut,
		"read_only": readOnly,
		"subjects":  subjects,
		"school":    map[string]interface{}{"id": school.ID, "name": school.Name, "code": school.Code},
		"iep":       iep,
		"class": map[string]interface{}{
			"id": cls.ID, "name": cls.Name, "level": cls.Level,
			"max_score": maxScore, "seuil": seuil,
		},
		"table1": map[string]interface{}{
			"presents":  t1Presents,
			"admis":     t1Admis,
			"pct_admis": t1Pct,
		},
		"table2": t2,
		"table3": map[string]interface{}{
			"difficultes":   difficultes,
			"mise_a_niveau": pdaCountRow{Total: rem.MiseANiveauTotal, Garcons: rem.MiseANiveauGarcons, Filles: rem.MiseANiveauFilles},
			"remediation":   pdaCountRow{Total: rem.RemediationTotal, Garcons: rem.RemediationGarcons, Filles: rem.RemediationFilles},
		},
	})
}

// === Suivi pluriannuel (matrice élève × évaluations) ===
// GET /api/pda/timeline?class_id=&year=
// Agrège TOUTES les évaluations du plan de l'année pour une classe CE/CM
// (compositions mensuelles dérivées + examens blancs saisis), triées par
// ordre de création (= ordre de déroulé du plan). Objectif : voir le niveau
// d'étude de chaque élève dans les matières désignées, évaluation après
// évaluation.
type pdaTimelineEval struct {
	ID            string     `json:"id"`
	Kind          string     `json:"kind"`
	Label         string     `json:"label"`
	ShortLabel    string     `json:"short_label"`
	Number        int        `json:"number"`
	Year          int        `json:"year"`
	Month         *int       `json:"month,omitempty"`
	Threshold     int        `json:"threshold"`
	ReadOnly      bool       `json:"read_only"`
	SubjectMaxes  [3]float64 `json:"subject_maxes"`
	SubjectSeuils [3]float64 `json:"subject_seuils"`
}

type pdaTimelineCell struct {
	Present     bool        `json:"present"`
	Notes       [3]*float64 `json:"notes"`
	Admis       [3]bool     `json:"admis"`
	AdmisGlobal bool        `json:"admis_global"`
}

type pdaTimelineStudent struct {
	StudentID        string                     `json:"student_id"`
	Matricule        string                     `json:"matricule"`
	LastName         string                     `json:"last_name"`
	FirstName        string                     `json:"first_name"`
	Gender           string                     `json:"gender"`
	Cells            map[string]pdaTimelineCell `json:"cells"`
	Presents         int                        `json:"presents"`
	AdmisGlobalCount int                        `json:"admis_global_count"`
	PctAdmis         float64                    `json:"pct_admis"`
}

type pdaTimelineSubject struct {
	Key            string  `json:"key"`
	Label          string  `json:"label"`
	Matched        bool    `json:"matched"`
	SubjectID      string  `json:"subject_id,omitempty"`
	SubjectName    string  `json:"subject_name,omitempty"`
	MaxComposition float64 `json:"max_composition"` // barème compositions (0 = non notée)
	MaxBlanc       float64 `json:"max_blanc"`       // barème PDA des examens blancs
}

// pdaMonthsFr — libellés des mois pour les évaluations du plan.
var pdaMonthsFr = [12]string{
	"Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
	"Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
}

func GetPDATimeline(w http.ResponseWriter, r *http.Request) {
	classID := r.URL.Query().Get("class_id")
	yearStr := r.URL.Query().Get("year")
	if classID == "" || yearStr == "" {
		middleware.JSONError(w, "class_id et year sont requis", http.StatusBadRequest)
		return
	}
	year, err := strconv.Atoi(yearStr)
	if err != nil || year < 2000 || year > 2100 {
		middleware.JSONError(w, "année scolaire invalide (attendu entre 2000 et 2100)", http.StatusBadRequest)
		return
	}

	var cls models.Class
	if err := database.DB.First(&cls, "id = ?", classID).Error; err != nil {
		middleware.JSONError(w, "classe introuvable", http.StatusBadRequest)
		return
	}
	if scope := pdaSchoolScopeForUser(r); scope != "" && cls.SchoolID != scope {
		middleware.JSONError(w, "accès refusé : cette classe appartient à une autre école", http.StatusForbidden)
		return
	}
	if pdaMaxScore(cls.Level) == 0 {
		middleware.JSONError(w, "le plan d'action concerne uniquement les niveaux CE et CM (classe "+cls.Name+" exclue)", http.StatusBadRequest)
		return
	}

	// Roster.
	var students []models.Student
	if err := database.DB.Where("class_id = ?", classID).
		Order("last_name ASC, first_name ASC").Find(&students).Error; err != nil {
		middleware.JSONError(w, "erreur récupération élèves", http.StatusInternalServerError)
		return
	}
	ids := make([]string, len(students))
	for i, s := range students {
		ids[i] = s.ID
	}

	// Évaluations du plan de l'année (ordre de création = déroulé du plan).
	var exams []models.PDAExam
	if err := database.DB.Where("school_id = ? AND year = ?", cls.SchoolID, year).
		Order("created_at ASC").Find(&exams).Error; err != nil {
		middleware.JSONError(w, "erreur récupération évaluations du plan", http.StatusInternalServerError)
		return
	}

	// Chargement en masse des sources (blancs + compositions).
	blancIDs := []string{}
	compSessionIDs := []string{}
	for _, e := range exams {
		if e.Kind == models.PDAKindComposition && e.SessionID != nil {
			compSessionIDs = append(compSessionIDs, *e.SessionID)
		} else {
			blancIDs = append(blancIDs, e.ID)
		}
	}
	subs := pdaResolvePdaSubjects()
	blancSources, err := pdaLoadBlancSources(blancIDs, ids)
	if err != nil {
		middleware.JSONError(w, "erreur récupération résultats des examens blancs", http.StatusInternalServerError)
		return
	}
	compSources, err := pdaLoadCompositionSources(compSessionIDs, ids, subs)
	if err != nil {
		middleware.JSONError(w, "erreur récupération notes des compositions", http.StatusInternalServerError)
		return
	}

	// Métadonnées de session (mois) pour les compositions.
	sessMonth := map[string]int{}
	if len(compSessionIDs) > 0 {
		var sessions []models.EvaluationSession
		if err := database.DB.Select("id, month").
			Where("id IN ?", compSessionIDs).Find(&sessions).Error; err == nil {
			for _, s := range sessions {
				sessMonth[s.ID] = s.Month
			}
		}
	}

	// Barèmes : composition = GradeScale réel par matière ; blanc = PDA fixe.
	blancMax := float64(pdaMaxScore(cls.Level))
	subjectsOut := make([]pdaTimelineSubject, 0, 3)
	for i, key := range pdaSubjectKeys {
		ts := pdaTimelineSubject{
			Key: key, Label: pdaSubjectLabels[i], MaxBlanc: blancMax,
		}
		if s := subs[key]; s != nil {
			ts.Matched = true
			ts.SubjectID = s.ID
			ts.SubjectName = s.Name
			ts.MaxComposition = float64(getMaxScore(cls.Level, s.ID))
		}
		subjectsOut = append(subjectsOut, ts)
	}

	// Construction de la matrice.
	evals := make([]pdaTimelineEval, 0, len(exams))
	warnings := []string{}
	for _, e := range exams {
		te := pdaTimelineEval{
			ID: e.ID, Kind: e.Kind, Number: e.Number, Year: e.Year,
			Threshold: e.Threshold, ReadOnly: e.Kind == models.PDAKindComposition,
		}
		if e.Kind == models.PDAKindComposition && e.SessionID != nil {
			m := sessMonth[*e.SessionID]
			te.Month = &m
			if m >= 1 && m <= 12 {
				te.Label = fmt.Sprintf("Composition N°%d — %s %d", e.Number, pdaMonthsFr[m-1], e.Year)
			} else {
				te.Label = fmt.Sprintf("Composition N°%d — %d", e.Number, e.Year)
			}
			te.ShortLabel = fmt.Sprintf("C%d", e.Number)
			for i, key := range pdaSubjectKeys {
				max := 0.0
				if s := subs[key]; s != nil {
					max = float64(getMaxScore(cls.Level, s.ID))
				}
				te.SubjectMaxes[i] = max
				te.SubjectSeuils[i] = max * float64(e.Threshold) / 100
			}
			if len(compSources[*e.SessionID]) == 0 {
				warnings = append(warnings, fmt.Sprintf(
					"Aucune note saisie pour la %s dans le module Notes — la grille restera vide tant que les notes n'existent pas.",
					te.Label))
			}
		} else {
			te.Label = fmt.Sprintf("Examen blanc N°%d", e.Number)
			te.ShortLabel = fmt.Sprintf("EB%d", e.Number)
			for i := range pdaSubjectKeys {
				te.SubjectMaxes[i] = blancMax
				te.SubjectSeuils[i] = blancMax * float64(e.Threshold) / 100
			}
		}
		evals = append(evals, te)
	}

	// Assemblage des lignes élèves.
	studentsOut := make([]pdaTimelineStudent, 0, len(students))
	for _, s := range students {
		st := pdaTimelineStudent{
			StudentID: s.ID,
			Matricule: matriculeOrNA(s.Matricule),
			LastName:  s.LastName,
			FirstName: s.FirstName,
			Gender:    s.Gender,
			Cells:     map[string]pdaTimelineCell{},
		}
		for _, e := range exams {
			var row pdaSourceRow
			if e.Kind == models.PDAKindComposition && e.SessionID != nil {
				row = compSources[*e.SessionID][s.ID]
			} else {
				row = blancSources[e.ID][s.ID]
			}
			cell := pdaTimelineCell{Present: row.Present, Notes: row.Notes}
			for k := 0; k < 3; k++ {
				var seuil float64
				if e.Kind == models.PDAKindComposition && e.SessionID != nil {
					max := 0.0
					if sub := subs[pdaSubjectKeys[k]]; sub != nil {
						max = float64(getMaxScore(cls.Level, sub.ID))
					}
					seuil = max * float64(e.Threshold) / 100
				} else {
					seuil = blancMax * float64(e.Threshold) / 100
				}
				cell.Admis[k] = row.Present && row.Notes[k] != nil && *row.Notes[k] >= seuil
			}
			cell.AdmisGlobal = cell.Admis[0] && cell.Admis[1] && cell.Admis[2]
			if row.Present {
				st.Presents++
			}
			if cell.AdmisGlobal {
				st.AdmisGlobalCount++
			}
			st.Cells[e.ID] = cell
		}
		st.PctAdmis = pct1(st.AdmisGlobalCount, len(exams))
		studentsOut = append(studentsOut, st)
	}

	// Avertissements matières non notées dans les compositions.
	compCount := len(compSessionIDs)
	if compCount > 0 {
		for i, key := range pdaSubjectKeys {
			if subs[key] == nil {
				warnings = append(warnings, fmt.Sprintf(
					"« %s » n'est pas notée dans les compositions mensuelles : créez la matière « %s » puis saisissez les notes dans le module Notes pour la suivre dans le plan.",
					pdaSubjectLabels[i], pdaSubjectLabels[i]))
			}
		}
	}

	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"class":       map[string]interface{}{"id": cls.ID, "name": cls.Name, "level": cls.Level},
		"year":        year,
		"evaluations": evals,
		"students":    studentsOut,
		"subjects":    subjectsOut,
		"warnings":    warnings,
		"count":       len(studentsOut),
	})
}
