package handlers

// === PDA IEPP — Plan d'Action Pluriannuel (examens blancs CE/CM) ===
//
// Implémente le document officiel « SUIVI DU PLAN D'ACTION PLURIANNUEL DE
// L'IEPP — RÉSULTAT DE L'EXAMEN BLANC N°X ». Les notes sont saisies par
// élève (3 matières : Exploitation de texte, Mathématiques, Dictée) et les
// tableaux agrégés du document sont calculés côté serveur (source unique
// de vérité, consommée par le composant d'impression frontend).
//
// Barème PDA (échelle mixte du projet) : CE → /10, CM → /20.
// Maîtrise (« Admis ») : Present && note >= barème × exam.Threshold/100.
// Un élève présent sans note dans une matière ne compte ni Admis ni
// Non Admis dans cette matière (saisie incomplète visible dans l'UI).
//
// RBAC : lecture = tout user authentifié (scope vérifié dans les handlers) ;
// écriture = RequireModule(models.ModuleGrades, "write") dans le routeur
// (mêmes droits que la saisie des notes : teacher+director+admin+inspector).

import (
	"encoding/json"
	"fmt"
	"math"
	"net/http"
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

// getPDAExamForUser charge l'examen blanc et vérifie le périmètre du user.
func getPDAExamForUser(r *http.Request, examID string) (*models.PDAExam, error) {
	var exam models.PDAExam
	if err := database.DB.First(&exam, "id = ?", examID).Error; err != nil {
		return nil, &pdaExamError{http.StatusNotFound, "examen blanc introuvable"}
	}
	if scope := pdaSchoolScopeForUser(r); scope != "" && exam.SchoolID != scope {
		return nil, &pdaExamError{http.StatusForbidden, "accès refusé : cet examen appartient à une autre école"}
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
// l'examen et qu'elle est d'un niveau concerné par le plan (CE ou CM).
func pdaClassForExam(exam *models.PDAExam, classID string) (*models.Class, error) {
	var cls models.Class
	if err := database.DB.First(&cls, "id = ?", classID).Error; err != nil {
		return nil, fmt.Errorf("classe introuvable")
	}
	if cls.SchoolID != exam.SchoolID {
		return nil, fmt.Errorf("la classe n'appartient pas à l'école de cet examen")
	}
	if pdaMaxScore(cls.Level) == 0 {
		return nil, fmt.Errorf("le plan d'action concerne uniquement les niveaux CE et CM (classe %s exclue)", cls.Name)
	}
	return &cls, nil
}

// === Liste des examens blancs ===
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
	if err := query.Order("year DESC, number ASC").Find(&exams).Error; err != nil {
		middleware.JSONError(w, "erreur récupération examens blancs", http.StatusInternalServerError)
		return
	}

	// Enrichissement avec le nom de l'école (cache mémoire par requête).
	type examWithSchool struct {
		models.PDAExam
		SchoolName string `json:"school_name,omitempty"`
	}
	out := make([]examWithSchool, 0, len(exams))
	cache := map[string]string{}
	for _, e := range exams {
		name, ok := cache[e.SchoolID]
		if !ok {
			var sch models.School
			if err := database.DB.Select("name").First(&sch, "id = ?", e.SchoolID).Error; err == nil {
				name = sch.Name
			}
			cache[e.SchoolID] = name
		}
		out = append(out, examWithSchool{PDAExam: e, SchoolName: name})
	}

	jsonResponse(w, http.StatusOK, map[string]interface{}{"exams": out, "count": len(out)})
}

// === Création d'un examen blanc ===
// POST /api/pda/exams {school_id?, number?, year?, exam_date?, threshold?}
// number absent/0 → auto-incrémenté par école + année. Unicité (école,
// année, numéro) → 409 si doublon.
func CreatePDAExam(w http.ResponseWriter, r *http.Request) {
	var req struct {
		SchoolID  string `json:"school_id"`
		Number    int    `json:"number"`
		Year      int    `json:"year"`
		ExamDate  string `json:"exam_date"` // "2006-01-02" (optionnel)
		Threshold int    `json:"threshold"` // % du barème (optionnel, défaut 50)
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		middleware.JSONError(w, "payload invalide", http.StatusBadRequest)
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

	// Année scolaire (défaut : année civile courante).
	year := req.Year
	if year == 0 {
		year = time.Now().Year()
	}
	if year < 2000 || year > 2100 {
		middleware.JSONError(w, "année scolaire invalide (attendu entre 2000 et 2100)", http.StatusBadRequest)
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

	// Numéro : auto = MAX(number)+1 pour (école, année) si absent.
	number := req.Number
	if number == 0 {
		var maxNum int
		database.DB.Model(&models.PDAExam{}).
			Where("school_id = ? AND year = ?", schoolID, year).
			Select("COALESCE(MAX(number), 0)").Scan(&maxNum)
		number = maxNum + 1
	}
	if number < 1 || number > 100 {
		middleware.JSONError(w, "numéro d'examen invalide (attendu entre 1 et 100)", http.StatusBadRequest)
		return
	}
	var dup int64
	database.DB.Model(&models.PDAExam{}).
		Where("school_id = ? AND year = ? AND number = ?", schoolID, year, number).
		Count(&dup)
	if dup > 0 {
		middleware.JSONError(w, fmt.Sprintf("l'Examen Blanc N°%d existe déjà pour l'année %d", number, year), http.StatusConflict)
		return
	}

	exam := models.PDAExam{SchoolID: schoolID, Number: number, Year: year, Threshold: threshold}
	if req.ExamDate != "" {
		d, err := time.Parse("2006-01-02", req.ExamDate)
		if err != nil {
			middleware.JSONError(w, "date d'examen invalide (format attendu AAAA-MM-JJ)", http.StatusBadRequest)
			return
		}
		exam.ExamDate = &d
	}
	if err := database.DB.Create(&exam).Error; err != nil {
		middleware.JSONError(w, "erreur création examen blanc", http.StatusInternalServerError)
		return
	}
	jsonResponse(w, http.StatusCreated, exam)
}

// === Suppression d'un examen blanc (cascade résultats + remédiation) ===
// DELETE /api/pda/exams/{id}
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
		middleware.JSONError(w, "erreur suppression examen blanc", http.StatusInternalServerError)
		return
	}
	jsonResponse(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// === Résultats d'une classe pour un examen blanc ===
// GET /api/pda/exams/{id}/results?class_id=
// Retourne le roster complet de la classe avec les notes saisies et les
// flags de maîtrise calculés (admis_exploitation/math/dictee/global).
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

	// Résultats existants (map par élève).
	ids := make([]string, len(students))
	for i, s := range students {
		ids[i] = s.ID
	}
	byStudent := map[string]models.PDAResult{}
	if len(ids) > 0 {
		var results []models.PDAResult
		if err := database.DB.Where("exam_id = ? AND student_id IN ?", exam.ID, ids).Find(&results).Error; err == nil {
			for _, res := range results {
				byStudent[res.StudentID] = res
			}
		}
	}

	seuil := pdaSeuil(exam, cls.Level)
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
		res := byStudent[s.ID]
		admExp := res.Present && res.NoteExploitation != nil && *res.NoteExploitation >= seuil
		admMath := res.Present && res.NoteMath != nil && *res.NoteMath >= seuil
		admDic := res.Present && res.NoteDictee != nil && *res.NoteDictee >= seuil
		rows = append(rows, pdaStudentRow{
			StudentID:         s.ID,
			Matricule:         matriculeOrNA(s.Matricule),
			LastName:          s.LastName,
			FirstName:         s.FirstName,
			Gender:            s.Gender,
			Present:           res.Present,
			NoteExploitation:  res.NoteExploitation,
			NoteMath:          res.NoteMath,
			NoteDictee:        res.NoteDictee,
			AdmisExploitation: admExp,
			AdmisMath:         admMath,
			AdmisDictee:       admDic,
			AdmisGlobal:       admExp && admMath && admDic,
		})
	}

	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"exam": exam,
		"class": map[string]interface{}{
			"id": cls.ID, "name": cls.Name, "level": cls.Level,
			"max_score": pdaMaxScore(cls.Level), "seuil": seuil,
		},
		"students": rows,
		"count":    len(rows),
	})
}

// === Saisie en lot des résultats ===
// POST /api/pda/exams/{id}/results
// {class_id, results: [{student_id, present, note_exploitation?, note_math?, note_dictee?}]}
// Note null = effacer. Validation : élèves de la classe, notes 0..barème.
func SavePDAResults(w http.ResponseWriter, r *http.Request) {
	exam, err := getPDAExamForUser(r, chi.URLParam(r, "id"))
	if err != nil {
		writePdaErr(w, err)
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
//   - Présents          = élèves avec Present=true
//   - Admis (matière)   = Présent ET note >= seuil
//   - Non Admis (matière) = Présent ET note saisie ET note < seuil
//   - Admis (global)    = Admis dans les 3 matières (seuil de maîtrise en
//     lecture du document : Exploitation de texte, Mathématiques, Dictée)
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

	// Roster + résultats (même logique que GetPDAResults).
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
	byStudent := map[string]models.PDAResult{}
	if len(ids) > 0 {
		var results []models.PDAResult
		if err := database.DB.Where("exam_id = ? AND student_id IN ?", exam.ID, ids).Find(&results).Error; err == nil {
			for _, res := range results {
				byStudent[res.StudentID] = res
			}
		}
	}

	seuil := pdaSeuil(exam, cls.Level)

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
		res, ok := byStudent[s.ID]
		if !ok || !res.Present {
			continue // seuls les présents alimentent les tableaux
		}
		fille := s.Gender == "F"
		bump(&t1Presents, fille)

		admExp := res.NoteExploitation != nil && *res.NoteExploitation >= seuil
		admMath := res.NoteMath != nil && *res.NoteMath >= seuil
		admDic := res.NoteDictee != nil && *res.NoteDictee >= seuil

		for _, m := range []struct {
			key  string
			note *float64
			adm  bool
		}{{"exploitation", res.NoteExploitation, admExp}, {"math", res.NoteMath, admMath}, {"dictee", res.NoteDictee, admDic}} {
			st := t2[m.key]
			bump(&st.Presents, fille)
			if m.adm {
				bump(&st.Admis, fille)
			} else if m.note != nil {
				bump(&st.NonAdmis, fille)
			}
		}

		if admExp && admMath && admDic {
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

	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"exam":   exam,
		"school": map[string]interface{}{"id": school.ID, "name": school.Name, "code": school.Code},
		"iep":    iep,
		"class": map[string]interface{}{
			"id": cls.ID, "name": cls.Name, "level": cls.Level,
			"max_score": pdaMaxScore(cls.Level), "seuil": seuil,
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
