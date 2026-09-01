package handlers

// === PDA IEPP — Document « PLAN D'ACTION PLURIANNUEL DE L'IEPP » (global) ===
//
// Agrégat RÉSEAU (toutes les écoles du périmètre) pour UNE évaluation du
// plan identifiée par (année, numéro, kind) — ex : « EXAMEN BLANC N°1 DU
// 13/03/2025 ». Reproduction de l'architecture des documents officiels
// reçus de l'IEPP :
//
//   Section A — « NOMBRE D'ÉLÈVES DU CM2 AYANT ATTEINT LE SEUIL SUFFISANT
//   DE MAÎTRISE EN LECTURE (EXPLOITATION DE TEXTE), MATHÉMATIQUES » :
//   une ligne par école, GROUPÉES PAR CENTRE D'EXAMEN, avec par discipline
//   (Exploitation de texte, Mathématiques) :
//     Total (inscrits) | Filles (inscrites) | Présents | % Admis |
//     Admis (Filles) | % Admis (Filles)
//   Convention de calcul (alignée sur GetPDASummary, corrective des
//   formules Excel erronées du modèle papier — % divisés par les PRÉSENTS,
//   jamais par les inscrits) :
//     % Admis        = Admis / Présents
//     % Admis Filles = Admises / Filles présentes
//
//   Section B — « ACCROÎTRE LES ACQUIS SCOLAIRES ET LA PERFORMANCE AUX
//   EXAMENS DES ÉLÈVES DE TOUS LES NIVEAUX » : par école, le nombre
//   d'élèves en difficultés d'apprentissage (présents non admis aux 3
//   matières — même définition que le tableau 3 du document par école),
//   le nombre ayant bénéficié des cours de mise à niveau et le nombre
//   ayant bénéficié des mécanismes de remédiation (saisie manuelle
//   PDARemediation, classe CM2).
//
// Le classe CM2 est la classe portant le NOM « CM2 » de chaque école
// (les 6 classes standard sont auto-créées : un seul CM2 par école ;
// toutes les classes actives portant ce nom sont agrégées par sécurité).
//
// Correspondance de l'évaluation : chaque école possède SON PDAExam
// (kind, number, year) — l'examen blanc N°1 est organisé par l'IEPP pour
// toutes les écoles sous le même numéro ; les compositions partagent le
// EvalNumber de leur session. Filtrer par (kind, number, year) aligne donc
// les écoles sur la même évaluation du plan.
//
// Performance : ~10 requêtes au total quel que soit le nombre d'écoles
// (écoles, centres, classes CM2, élèves, évaluations, sources de notes,
// remédiation, IEP) — pattern anti-N+1 des autres handlers.
//
// RBAC : lecture authentifiée (scope dans le handler, comme GetPDASummary) :
//   - admin            : toutes les écoles (param iep_id optionnel pour
//                        restreindre le document à une IEP)
//   - inspector        : écoles de son IEP
//   - director/teacher : leur école seule

import (
	"fmt"
	"net/http"
	"strconv"

	"sygren-api/database"
	"sygren-api/middleware"
	"sygren-api/models"
)

// planDisciplineStats — stats de maîtrise d'une discipline (section A).
type planDisciplineStats struct {
	Presents       pdaCountRow `json:"presents"`
	Admis          pdaCountRow `json:"admis"`
	PctAdmis       float64     `json:"pct_admis"`        // Admis / Présents
	PctAdmisFilles float64     `json:"pct_admis_filles"` // Admises / Filles présentes
}

// planSchoolRow — une ligne école des documents A et B (et l'agrégat
// d'un groupe centre, SchoolID vide + SchoolName « TOTAL »).
type planSchoolRow struct {
	SchoolID    string                          `json:"school_id"`
	SchoolName  string                          `json:"school_name"`
	ClassID     string                          `json:"class_id,omitempty"`
	HasData     bool                            `json:"has_data"` // évaluation suivie + classe CM2 + notes
	Inscrits    pdaCountRow                     `json:"inscrits"`
	Disciplines map[string]*planDisciplineStats `json:"disciplines"` // exploitation | math
	// Section B — effectifs Total | Filles (architecture du document reçu).
	Difficultes pdaCountRow `json:"difficultes"`
	MiseANiveau pdaCountRow `json:"mise_a_niveau"`
	Remediation pdaCountRow `json:"remediation"`
}

// planCenterGroup — un groupe CENTRE D'EXAMEN (ou le groupe des écoles
// non affectées, ID vide).
type planCenterGroup struct {
	ID       string          `json:"id"`
	Name     string          `json:"name"`
	Position int             `json:"position"`
	Schools  []planSchoolRow `json:"schools"`
	Totals   planSchoolRow   `json:"totals"`
}

// planActionDisciplines — les 2 disciplines de la section A (l'ordre
// importe pour le rendu du document).
var planActionDisciplines = [2]string{"exploitation", "math"}

// addCountRow — somme d'effectifs.
func addCountRow(dst *pdaCountRow, src pdaCountRow) {
	dst.Total += src.Total
	dst.Filles += src.Filles
	dst.Garcons += src.Garcons
}

// GetPDAPlanAction — GET /api/pda/plan-action?year=&number=&kind=&iep_id=
func GetPDAPlanAction(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	year, err := strconv.Atoi(q.Get("year"))
	if err != nil || year < 2000 || year > 2100 {
		middleware.JSONError(w, "année scolaire invalide", http.StatusBadRequest)
		return
	}
	number, err := strconv.Atoi(q.Get("number"))
	if err != nil || number < 1 || number > 100 {
		middleware.JSONError(w, "numéro d'évaluation invalide", http.StatusBadRequest)
		return
	}
	kind := q.Get("kind")
	if kind == "" {
		kind = models.PDAKindBlanc
	}
	if kind != models.PDAKindBlanc && kind != models.PDAKindComposition {
		middleware.JSONError(w, "type d'évaluation invalide (blanc | composition)", http.StatusBadRequest)
		return
	}

	// === Périmètre des écoles (même logique que ListSchools) ===
	schoolQuery := database.DB.Model(&models.School{})
	switch ctxRole(r) {
	case "director", "teacher":
		schoolID := pdaSchoolScopeForUser(r)
		if schoolID == "" {
			jsonResponse(w, http.StatusOK, map[string]interface{}{
				"year": year, "number": number, "kind": kind,
				"centers": []interface{}{}, "grand_total": planSchoolRow{Disciplines: map[string]*planDisciplineStats{}},
				"warnings": []string{}, "count": 0,
			})
			return
		}
		schoolQuery = schoolQuery.Where("id = ?", schoolID)
	case "inspector":
		schoolQuery = schoolQuery.Where("iep_id = ?", ctxIEPID(r))
	default: // admin — filtre IEP optionnel (document d'UNE inspection)
		if iepID := q.Get("iep_id"); iepID != "" {
			schoolQuery = schoolQuery.Where("iep_id = ?", iepID)
		}
	}
	var schools []models.School
	if err := schoolQuery.Order("name ASC").Find(&schools).Error; err != nil {
		middleware.JSONError(w, "erreur récupération écoles", http.StatusInternalServerError)
		return
	}
	if len(schools) == 0 {
		jsonResponse(w, http.StatusOK, map[string]interface{}{
			"year": year, "number": number, "kind": kind,
			"centers":     []interface{}{},
			"grand_total": planSchoolRow{SchoolName: "TOTAL", Disciplines: map[string]*planDisciplineStats{}},
			"iep":         nil,
			"warnings":    []string{}, "count": 0,
		})
		return
	}
	schoolIDs := make([]string, len(schools))
	schoolByID := make(map[string]models.School, len(schools))
	for i, s := range schools {
		schoolIDs[i] = s.ID
		schoolByID[s.ID] = s
	}

	// === Centres d'examen des IEP concernées (ordre des documents) ===
	iepSet := map[string]bool{}
	for _, s := range schools {
		iepSet[s.IEPID] = true
	}
	iepIDs := make([]string, 0, len(iepSet))
	for id := range iepSet {
		iepIDs = append(iepIDs, id)
	}
	var centers []models.ExamCenter
	if err := database.DB.Where("iep_id IN ?", iepIDs).
		Order("position ASC, name ASC").Find(&centers).Error; err != nil {
		middleware.JSONError(w, "erreur récupération centres d'examen", http.StatusInternalServerError)
		return
	}
	centerByID := make(map[string]models.ExamCenter, len(centers))
	for _, c := range centers {
		centerByID[c.ID] = c
	}

	// === Classes CM2 actives (toutes écoles, 1 requête) ===
	var cm2Classes []models.Class
	if err := database.DB.Where("school_id IN ? AND name = ? AND active = ?", schoolIDs, "CM2", true).
		Order("name ASC").Find(&cm2Classes).Error; err != nil {
		middleware.JSONError(w, "erreur récupération classes CM2", http.StatusInternalServerError)
		return
	}
	classIDs := make([]string, len(cm2Classes))
	classesBySchool := map[string][]models.Class{}
	for i, c := range cm2Classes {
		classIDs[i] = c.ID
		classesBySchool[c.SchoolID] = append(classesBySchool[c.SchoolID], c)
	}

	// === Élèves de ces classes (1 requête) ===
	studentsByClass := map[string][]models.Student{}
	if len(classIDs) > 0 {
		var students []models.Student
		if err := database.DB.Where("class_id IN ?", classIDs).
			Order("last_name ASC, first_name ASC").Find(&students).Error; err != nil {
			middleware.JSONError(w, "erreur récupération élèves", http.StatusInternalServerError)
			return
		}
		for _, s := range students {
			studentsByClass[s.ClassID] = append(studentsByClass[s.ClassID], s)
		}
	}
	allStudentIDs := []string{}
	for _, list := range studentsByClass {
		for _, s := range list {
			allStudentIDs = append(allStudentIDs, s.ID)
		}
	}

	// === Évaluation du plan correspondante par école (1 requête) ===
	var exams []models.PDAExam
	if err := database.DB.Where("school_id IN ? AND year = ? AND number = ? AND kind = ?", schoolIDs, year, number, kind).
		Order("created_at ASC").Find(&exams).Error; err != nil {
		middleware.JSONError(w, "erreur récupération évaluations du plan", http.StatusInternalServerError)
		return
	}
	examBySchool := map[string]models.PDAExam{}
	examIDs := []string{}
	sessionIDs := []string{}
	examDateBySchool := map[string]string{}
	for _, e := range exams {
		if _, ok := examBySchool[e.SchoolID]; ok {
			continue // la plus ancienne gagne (créations accidentelles en double)
		}
		examBySchool[e.SchoolID] = e
		examIDs = append(examIDs, e.ID)
		if e.Kind == models.PDAKindComposition && e.SessionID != nil {
			sessionIDs = append(sessionIDs, *e.SessionID)
		}
		if e.ExamDate != nil {
			examDateBySchool[e.SchoolID] = e.ExamDate.Format("2006-01-02")
		}
	}

	// === Sources des notes (blancs OU compositions — 1 à 2 requêtes) ===
	subs := pdaResolvePdaSubjects()
	var sources map[string]map[string]pdaSourceRow
	if kind == models.PDAKindComposition {
		src, err := pdaLoadCompositionSources(sessionIDs, allStudentIDs, subs)
		if err != nil {
			middleware.JSONError(w, "erreur récupération notes des compositions", http.StatusInternalServerError)
			return
		}
		sources = src
	} else {
		src, err := pdaLoadBlancSources(examIDs, allStudentIDs)
		if err != nil {
			middleware.JSONError(w, "erreur récupération résultats des examens blancs", http.StatusInternalServerError)
			return
		}
		sources = src
	}

	// === Remédiation saisie (lignes 2-3 de la section B — 1 requête) ===
	remByClass := map[string]models.PDARemediation{}
	if len(examIDs) > 0 && len(classIDs) > 0 {
		var rems []models.PDARemediation
		if err := database.DB.Where("exam_id IN ? AND class_id IN ?", examIDs, classIDs).
			Find(&rems).Error; err == nil {
			for _, rem := range rems {
				remByClass[rem.ExamID+"|"+rem.ClassID] = rem
			}
		}
	}

	// Barèmes : les MAX par matière ne dépendent que du niveau CM (constants
	// pour toutes les écoles) ; le SEUIL utilise le Threshold de l'évaluation
	// DE l'école (les seuils peuvent varier d'une école à l'autre).
	blancMax := float64(pdaMaxScore("CM"))
	type subjectMax struct {
		Max      float64
		Matched  bool
		SeuilFor func(threshold int) float64
	}
	subjectMaxes := map[string]subjectMax{}
	for _, key := range pdaSubjectKeys {
		sm := subjectMax{Max: blancMax, Matched: true}
		if kind == models.PDAKindComposition {
			if s := subs[key]; s != nil {
				sm.Matched = true
				sm.Max = float64(getMaxScore("CM", s.ID))
			} else {
				sm.Matched = false
				sm.Max = 0
			}
		}
		max := sm.Max
		sm.SeuilFor = func(threshold int) float64 { return max * float64(threshold) / 100 }
		subjectMaxes[key] = sm
	}

	// === Agrégat par école ===
	warnings := []string{}
	rowBySchool := map[string]*planSchoolRow{}
	for _, sch := range schools {
		row := &planSchoolRow{
			SchoolID:    sch.ID,
			SchoolName:  sch.Name,
			Disciplines: map[string]*planDisciplineStats{},
		}
		for _, key := range planActionDisciplines {
			row.Disciplines[key] = &planDisciplineStats{}
		}
		rowBySchool[sch.ID] = row

		exam, hasExam := examBySchool[sch.ID]
		classes := classesBySchool[sch.ID]
		if !hasExam {
			warnings = append(warnings, fmt.Sprintf(
				"%s : aucune évaluation « N°%d » de cette année au plan — ligne laissée vide.", sch.Name, number))
			continue
		}
		if len(classes) == 0 {
			warnings = append(warnings, fmt.Sprintf(
				"%s : aucune classe CM2 active — ligne laissée vide.", sch.Name))
			continue
		}

		var seuils [3]float64
		for i, key := range pdaSubjectKeys {
			seuils[i] = subjectMaxes[key].SeuilFor(exam.Threshold)
		}

		for _, cls := range classes {
			roster := studentsByClass[cls.ID]
			for _, st := range roster {
				if st.Gender == "F" {
					row.Inscrits.Total++
					row.Inscrits.Filles++
				} else {
					row.Inscrits.Total++
					row.Inscrits.Garcons++
				}

				var src pdaSourceRow
				if kind == models.PDAKindComposition && exam.SessionID != nil {
					src = sources[*exam.SessionID][st.ID]
				} else {
					src = sources[exam.ID][st.ID]
				}
				if !src.Present {
					continue // seuls les présents alimentent les tableaux
				}
				fille := st.Gender == "F"
				row.HasData = true

				admisGlobal := true
				for i, key := range pdaSubjectKeys {
					disc, tracked := row.Disciplines[key]
					if src.Notes[i] == nil {
						admisGlobal = false
						continue // présent sans note : ni Admis ni Non Admis
					}
					admis := *src.Notes[i] >= seuils[i]
					// Les 2 disciplines du document A sont alimentées ;
					// la dictée ne sert qu'au calcul des difficultés (B).
					if tracked {
						bump := &disc.Presents
						bump.Total++
						if fille {
							bump.Filles++
						} else {
							bump.Garcons++
						}
						if admis {
							bump = &disc.Admis
							bump.Total++
							if fille {
								bump.Filles++
							} else {
								bump.Garcons++
							}
						}
					}
					if !admis {
						admisGlobal = false
					}
				}

				if admisGlobal {
					continue
				}
				// Section B — élèves en difficultés d'apprentissage
				// (présents non admis aux 3 matières — même définition
				// que le tableau 3 du document par école).
				row.Difficultes.Total++
				if fille {
					row.Difficultes.Filles++
				} else {
					row.Difficultes.Garcons++
				}
			}

			// Remédiation saisie (mise à niveau + mécanismes).
			if rem, ok := remByClass[exam.ID+"|"+cls.ID]; ok {
				row.MiseANiveau.Total += rem.MiseANiveauTotal
				row.MiseANiveau.Filles += rem.MiseANiveauFilles
				row.MiseANiveau.Garcons += rem.MiseANiveauGarcons
				row.Remediation.Total += rem.RemediationTotal
				row.Remediation.Filles += rem.RemediationFilles
				row.Remediation.Garcons += rem.RemediationGarcons
			}

			if len(studentsByClass[cls.ID]) > 0 {
				row.ClassID = cls.ID
			}
		}

		// Pourcentages de la section A (admis/présents — convention du système).
		for _, key := range planActionDisciplines {
			disc := row.Disciplines[key]
			disc.PctAdmis = pct1(disc.Admis.Total, disc.Presents.Total)
			disc.PctAdmisFilles = pct1(disc.Admis.Filles, disc.Presents.Filles)
		}
	}

	// Avertissements de données incomplètes (visibles à l'écran, pas imprimés).
	if kind == models.PDAKindComposition {
		for i, key := range pdaSubjectKeys {
			if subs[key] == nil {
				warnings = append(warnings, fmt.Sprintf(
					"« %s » n'est pas notée dans les compositions : les difficultés (section B) resteront partielles tant que la matière n'existe pas.",
					pdaSubjectLabels[i]))
			}
		}
	}

	// === Regroupement par centre (ordre : position puis nom) ; les écoles
	// sans centre forment un groupe final « (Sans centre d'examen) » —
	// elles restent visibles (le document officiel liste TOUTES les écoles).
	groups := map[string]*planCenterGroup{}
	for _, c := range centers {
		groups[c.ID] = &planCenterGroup{ID: c.ID, Name: c.Name, Position: c.Position, Schools: []planSchoolRow{}}
	}
	unassigned := &planCenterGroup{Name: "(Sans centre d'examen)", Schools: []planSchoolRow{}}
	for _, sch := range schools {
		row := rowBySchool[sch.ID]
		if sch.ExamCenterID != nil {
			if g, ok := groups[*sch.ExamCenterID]; ok {
				g.Schools = append(g.Schools, *row)
				continue
			}
		}
		unassigned.Schools = append(unassigned.Schools, *row)
	}
	centerList := make([]planCenterGroup, 0, len(centers)+1)
	for _, c := range centers {
		g := groups[c.ID]
		if len(g.Schools) == 0 {
			// Centre sans aucune école rattachée : pas de groupe dans le
			// document (le modèle officiel ne liste que des centres peuplés).
			continue
		}
		g.Totals = aggregatePlanRows(g.Schools)
		centerList = append(centerList, *g)
	}
	if len(unassigned.Schools) > 0 {
		unassigned.Totals = aggregatePlanRows(unassigned.Schools)
		centerList = append(centerList, *unassigned)
	}

	grand := []planSchoolRow{}
	for _, g := range centerList {
		grand = append(grand, g.Schools...)
	}

	// Date d'examen affichable (la plus fréquente chez les écoles concernées).
	examDate := ""
	dateCount := map[string]int{}
	for _, d := range examDateBySchool {
		dateCount[d]++
	}
	maxCount := 0
	for d, n := range dateCount {
		if n > maxCount || (n == maxCount && d < examDate) {
			examDate = d
			maxCount = n
		}
	}

	// Mois des compositions (le plus fréquent) pour le titre du document
	// (« COMPOSITION N°X — OCTOBRE 2026 ») — même convention que les
	// documents par école.
	sessionMonth := 0
	if len(sessionIDs) > 0 {
		monthCount := map[int]int{}
		var sessions []models.EvaluationSession
		if err := database.DB.Select("id, month").
			Where("id IN ?", sessionIDs).Find(&sessions).Error; err == nil {
			for _, s := range sessions {
				monthCount[s.Month]++
			}
			best := -1
			for m, n := range monthCount {
				if n > best || (n == best && m < sessionMonth) {
					sessionMonth = m
					best = n
				}
			}
		}
	}

	// IEP unique pour l'en-tête du document (null si périmètre multi-IEP).
	var iep *models.IEP
	if len(iepIDs) == 1 {
		var i models.IEP
		if err := database.DB.First(&i, "id = ?", iepIDs[0]).Error; err == nil {
			iep = &i
		}
	}

	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"year":          year,
		"number":        number,
		"kind":          kind,
		"exam_date":     examDate,
		"session_month": sessionMonth,
		"iep":           iep,
		"centers":       centerList,
		"grand_total":   aggregatePlanRows(grand),
		"warnings":      warnings,
		"count":         len(schools),
	})
}

// aggregatePlanRows — totaux d'un groupe (somme des lignes écoles) ;
// les pourcentages sont recalculés sur les effectifs cumulés.
func aggregatePlanRows(rows []planSchoolRow) planSchoolRow {
	tot := planSchoolRow{SchoolName: "TOTAL", HasData: len(rows) > 0, Disciplines: map[string]*planDisciplineStats{}}
	for _, key := range planActionDisciplines {
		tot.Disciplines[key] = &planDisciplineStats{}
	}
	for _, row := range rows {
		addCountRow(&tot.Inscrits, row.Inscrits)
		for _, key := range planActionDisciplines {
			d := tot.Disciplines[key]
			addCountRow(&d.Presents, row.Disciplines[key].Presents)
			addCountRow(&d.Admis, row.Disciplines[key].Admis)
		}
		addCountRow(&tot.Difficultes, row.Difficultes)
		addCountRow(&tot.MiseANiveau, row.MiseANiveau)
		addCountRow(&tot.Remediation, row.Remediation)
	}
	for _, key := range planActionDisciplines {
		d := tot.Disciplines[key]
		d.PctAdmis = pct1(d.Admis.Total, d.Presents.Total)
		d.PctAdmisFilles = pct1(d.Admis.Filles, d.Presents.Filles)
	}
	return tot
}
