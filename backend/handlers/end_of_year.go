package handlers

import (
	"fmt"
	"math"
	"net/http"
	"sort"
	"time"

	"sygren-api/database"
	"sygren-api/middleware"
	"sygren-api/models"
)

// === Document « RESULTATS DE FIN D'ANNEE » (modèle officiel IEPP) ===
//
// Feuille de fin d'année d'UNE classe (le « Cours » du modèle) :
//   - une ligne par élève : N°, Nom et Prénoms, Âge (déduit de l'année de
//     naissance), Scolarité dans le cours (1..10), Scolarité totale (1..10),
//     Moyenne des compositions, Moyenne de la composition de passage,
//     Moyenne annuelle, Décision du conseil des maîtres (A | R | ABD) ;
//   - le tableau récapitulatif du bas : Effectif / Admis / Redoublants /
//     Exclus / Abandons × Garçons / Filles / Total ;
//   - rangement des élèves PAR ORDRE DE MÉRITE (moyenne annuelle
//     décroissante, N° = rang) ; les noms des filles s'affichent en rouge
//     côté frontend (convention des tableaux de classement).
//
// Formules (demande explicite de l'utilisateur) :
//   - Moyenne des compositions = somme des moyennes des compositions
//     mensuelles effectuées ÷ nombre de compositions effectuées ;
//   - Moyenne de la composition de passage = moyenne de l'élève à la (aux)
//     session(s) de type « composition_passage » ;
//   - Moyenne annuelle = (moyenne des compositions + 2 × moyenne de la
//     composition de passage) / 3 — la composition de passage compte
//     DOUBLE (formule officielle ivoirienne de pondération /3).
//     Cas limites : moyenne de passage absente → moyenne annuelle = moyenne
//     des compositions ; compositions absentes → moyenne annuelle = moyenne
//     de passage ; rien → aucune moyenne annuelle.
//   - Âge = année de référence (paramètre year, défaut = paramètre système
//     system.school_year) − année de naissance.
//
// Réutilisation de l'existant : les moyennes par session proviennent de
// computeSessionResults (computation.go — coefficients, barèmes par niveau
// et exemptions déjà gérés). Les sessions « cancelled » sont exclues (pas
// d'évaluation faite) ; les « archived » sont conservées (notes valides).
//
// Tableau du bas :
//   - Effectif, Admis (décision « A ») et Redoublants (décision « R ») sont
//     CALCULÉS depuis les décisions saisies sur les élèves ;
//   - Exclus et Abandons sont les compteurs MANUELS de la classe
//     (listes 1..15 — Class.ExclusGarcons/Filles, AbandonsGarcons/Filles),
//     Total = Garçons + Filles.
//
// RBAC : admin = tout, inspector = son IEP, director = son école,
// teacher = sa classe (teacher_id de la classe).

// EndOfYearRow — une ligne élève du document.
type EndOfYearRow struct {
	StudentID string `json:"student_id"`
	Matricule string `json:"matricule"`
	FullName  string `json:"full_name"` // NOM (majuscules) + prénoms
	Gender    string `json:"gender"`    // M | F

	// Âge = année de référence − année de naissance (nil si non calculable).
	Age *int `json:"age,omitempty"`

	ScolariteCours  *int `json:"scolarite_cours,omitempty"`
	ScolariteTotale *int `json:"scolarite_totale,omitempty"`

	// Moyenne des compositions mensuelles effectuées (somme ÷ nombre).
	MoyenneCompositions    float64 `json:"moyenne_compositions"`
	HasMoyenneCompositions bool    `json:"has_moyenne_compositions"`
	// Moyenne de la (des) composition(s) de passage.
	MoyennePassage    float64 `json:"moyenne_passage"`
	HasMoyennePassage bool    `json:"has_moyenne_passage"`
	// Moyenne annuelle = (compositions + 2 × passage) / 3.
	MoyenneAnnuelle    float64 `json:"moyenne_annuelle"`
	HasMoyenneAnnuelle bool    `json:"has_moyenne_annuelle"`

	DecisionConseil *string `json:"decision_conseil,omitempty"` // A | R | ABD
}

// EndOfYearSummaryRow — une ligne du tableau récapitulatif (G / F / T).
// Pointeurs : nil = case vide du document (valeurs calculées toujours
// présentes, y compris zéro ; valeurs manuelles nil = non saisies).
type EndOfYearSummaryRow struct {
	Garcons *int `json:"garcons,omitempty"`
	Filles  *int `json:"filles,omitempty"`
	Total   *int `json:"total,omitempty"`
}

// EndOfYearSummary — le petit tableau du bas du document.
type EndOfYearSummary struct {
	Effectif    EndOfYearSummaryRow `json:"effectif"`    // calculé (liste des élèves)
	Admis       EndOfYearSummaryRow `json:"admis"`       // calculé (décision A)
	Redoublants EndOfYearSummaryRow `json:"redoublants"` // calculé (décision R)
	Exclus      EndOfYearSummaryRow `json:"exclus"`      // manuel (classe)
	Abandons    EndOfYearSummaryRow `json:"abandons"`    // manuel (classe)
}

func endOfYearTotals(g, f int) EndOfYearSummaryRow {
	t := g + f
	return EndOfYearSummaryRow{Garcons: &g, Filles: &f, Total: &t}
}

// round2 arrondit à 2 décimales (affichage du document).
func round2(v float64) float64 {
	return math.Round(v*100) / 100
}

// derefStr déréférence un pointeur string (" " si nil) — commutateur sur la
// décision du conseil des maîtres.
func derefStr(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// GetEndOfYearSheet retourne les données complètes du document
// « RESULTATS DE FIN D'ANNEE » pour une classe.
// Query : school_id (requis), class_id (requis), year (optionnel — défaut
// = paramètre système system.school_year, ex: 2026).
func GetEndOfYearSheet(w http.ResponseWriter, r *http.Request) {
	schoolID := r.URL.Query().Get("school_id")
	classID := r.URL.Query().Get("class_id")
	if schoolID == "" || classID == "" {
		middleware.JSONError(w, "school_id et class_id sont requis", http.StatusBadRequest)
		return
	}

	var school models.School
	if err := database.DB.First(&school, "id = ?", schoolID).Error; err != nil {
		middleware.JSONError(w, "école introuvable", http.StatusNotFound)
		return
	}
	var cls models.Class
	if err := database.DB.First(&cls, "id = ?", classID).Error; err != nil {
		middleware.JSONError(w, "classe introuvable", http.StatusNotFound)
		return
	}
	if cls.SchoolID != school.ID {
		middleware.JSONError(w, "la classe n'appartient pas à cette école", http.StatusBadRequest)
		return
	}

	// RBAC par périmètre (même modèle que /api/reports/personnel)
	role := ctxRole(r)
	switch role {
	case "director":
		if ctxSchoolID(r) != school.ID {
			middleware.JSONError(w, "accès refusé : document limité à votre école", http.StatusForbidden)
			return
		}
	case "inspector":
		if ctxIEPID(r) == "" || school.IEPID != ctxIEPID(r) {
			middleware.JSONError(w, "accès refusé : école hors de votre IEP", http.StatusForbidden)
			return
		}
	case "teacher":
		if cls.TeacherID == nil || *cls.TeacherID != ctxUserID(r) {
			middleware.JSONError(w, "accès refusé : document limité à votre classe", http.StatusForbidden)
			return
		}
	}

	// Année de référence (défaut = paramètre système, ex: 2026)
	year := 0
	if y := r.URL.Query().Get("year"); y != "" {
		fmt.Sscanf(y, "%d", &year)
	}
	if year == 0 {
		schoolYear, _, _ := GetSystemSettings()
		year = schoolYear
	}

	var iep models.IEP
	database.DB.First(&iep, "id = ?", school.IEPID)

	// Nom du tenant du cours (enseignant affecté à la classe) et de
	// l'inspecteur (Visa de l'Inspecteur du modèle reçu).
	teacherName := ""
	if cls.TeacherID != nil {
		var t models.User
		if err := database.DB.Select("full_name").First(&t, "id = ?", *cls.TeacherID).Error; err == nil {
			teacherName = t.FullName
		}
	}
	inspectorName := ""
	if school.IEPID != "" {
		var insp models.User
		if err := database.DB.Select("full_name").
			Where("iep_id = ? AND role = ? AND active = ?", school.IEPID, models.RoleInspector, true).
			Order("created_at ASC").First(&insp).Error; err == nil {
			inspectorName = insp.FullName
		}
	}
	// Nom du directeur de l'école (bulletin individuel de fin d'année :
	// signature « Le Directeur » — premier directeur actif de l'école).
	directeurName := ""
	var dir models.User
	if err := database.DB.Select("full_name").
		Where("school_id = ? AND role = ? AND active = ?", school.ID, models.RoleDirector, true).
		Order("created_at ASC").First(&dir).Error; err == nil {
		directeurName = dir.FullName
	}

	// Élèves de la classe (l'ORDRE DE MÉRITE est appliqué plus bas,
	// après le calcul des moyennes).
	var students []models.Student
	if err := database.DB.Where("class_id = ?", cls.ID).
		Order("last_name ASC, first_name ASC").Find(&students).Error; err != nil {
		middleware.JSONError(w, "erreur récupération des élèves", http.StatusInternalServerError)
		return
	}

	// Sessions de l'école pour l'année : compositions mensuelles +
	// compositions de passage (hors annulées ; archivées conservées).
	var sessions []models.EvaluationSession
	if err := database.DB.
		Where("school_id = ? AND year = ? AND status != ? AND eval_type IN ?",
			school.ID, year, "cancelled",
			[]string{"composition", "composition_passage"}).
		Order("month ASC").Find(&sessions).Error; err != nil {
		middleware.JSONError(w, "erreur récupération des sessions", http.StatusInternalServerError)
		return
	}

	// Moyennes par élève : une seule passe par session (computeSessionResults
	// gère coefficients, barèmes par niveau et exemptions), puis extraction
	// des élèves de LA classe.
	type perStudent struct {
		sumComp, sumPass float64
		nbComp, nbPass   int
	}
	agg := make(map[string]*perStudent, len(students))
	// Mois de RÉFÉRENCE du bulletin (ligne « Session de … ») : la (dernière)
	// composition de passage de l'année si elle existe, sinon la dernière
	// session de l'année (compositions mensuelles — ex. Décembre).
	passageMonth := 0
	lastMonth := 0
	for _, s := range sessions {
		if s.Month > lastMonth {
			lastMonth = s.Month
		}
		if s.EvalType == "composition_passage" && s.Month > passageMonth {
			passageMonth = s.Month
		}
		results, err := computeSessionResults(s.ID)
		if err != nil {
			continue // session supprimée entre-temps — non bloquant
		}
		inClass := make(map[string]bool, len(students))
		for _, st := range students {
			inClass[st.ID] = true
		}
		for _, res := range results.Results {
			if !inClass[res.StudentID] || !res.HasAverage {
				continue
			}
			a, ok := agg[res.StudentID]
			if !ok {
				a = &perStudent{}
				agg[res.StudentID] = a
			}
			if s.EvalType == "composition_passage" {
				a.sumPass += res.Average
				a.nbPass++
			} else {
				a.sumComp += res.Average
				a.nbComp++
			}
		}
	}

	// Construction des lignes
	rows := make([]EndOfYearRow, 0, len(students))
	effG, effF := 0, 0
	admG, admF := 0, 0
	redG, redF := 0, 0
	for _, st := range students {
		row := EndOfYearRow{
			StudentID:       st.ID,
			Matricule:       matriculeOrNA(st.Matricule),
			FullName:        studentFullName(st.LastName, st.FirstName),
			Gender:          st.Gender,
			ScolariteCours:  st.ScolariteCours,
			ScolariteTotale: st.ScolariteTotale,
			DecisionConseil: st.DecisionConseil,
		}
		if st.Gender == "M" {
			effG++
		} else if st.Gender == "F" {
			effF++
		}
		switch derefStr(st.DecisionConseil) {
		case DecisionConseilAdmis:
			if st.Gender == "M" {
				admG++
			} else if st.Gender == "F" {
				admF++
			}
		case DecisionConseilRedoublant:
			if st.Gender == "M" {
				redG++
			} else if st.Gender == "F" {
				redF++
			}
		}

		// Âge = année de référence − année de naissance
		if st.BirthYear != nil && *st.BirthYear > 0 && *st.BirthYear <= year {
			age := year - *st.BirthYear
			row.Age = &age
		}

		// Moyennes
		if a, ok := agg[st.ID]; ok {
			if a.nbComp > 0 {
				row.MoyenneCompositions = round2(a.sumComp / float64(a.nbComp))
				row.HasMoyenneCompositions = true
			}
			if a.nbPass > 0 {
				row.MoyennePassage = round2(a.sumPass / float64(a.nbPass))
				row.HasMoyennePassage = true
			}
		}
		switch {
		case row.HasMoyenneCompositions && row.HasMoyennePassage:
			row.MoyenneAnnuelle = round2((row.MoyenneCompositions + 2*row.MoyennePassage) / 3)
			row.HasMoyenneAnnuelle = true
		case row.HasMoyenneCompositions:
			row.MoyenneAnnuelle = row.MoyenneCompositions
			row.HasMoyenneAnnuelle = true
		case row.HasMoyennePassage:
			row.MoyenneAnnuelle = row.MoyennePassage
			row.HasMoyenneAnnuelle = true
		}

		rows = append(rows, row)
	}

	// Compteurs manuels de la classe (Exclus / Abandons) + Total = G+F
	manualRow := func(g, f *int) EndOfYearSummaryRow {
		row := EndOfYearSummaryRow{Garcons: g, Filles: f}
		if g != nil && f != nil {
			t := *g + *f
			row.Total = &t
		}
		return row
	}

	summary := EndOfYearSummary{
		Effectif:    endOfYearTotals(effG, effF),
		Admis:       endOfYearTotals(admG, admF),
		Redoublants: endOfYearTotals(redG, redF),
		Exclus:      manualRow(cls.ExclusGarcons, cls.ExclusFilles),
		Abandons:    manualRow(cls.AbandonsGarcons, cls.AbandonsFilles),
	}

	// Session de référence du bulletin (passage si elle existe, sinon la
	// dernière session de l'année) — nil si aucune session : le bulletin
	// retombe sur l'année de référence seule.
	refMonth := passageMonth
	if refMonth == 0 {
		refMonth = lastMonth
	}
	var sessionPassage interface{}
	if refMonth > 0 {
		sessionPassage = map[string]int{"month": refMonth, "year": year}
	}

	// Année scolaire « 2025 2026 » (rentrée d'août/septembre → juillet)
	now := time.Now()
	start := now.Year()
	if now.Month() < time.August {
		start--
	}

	// Tri PAR ORDRE DE MÉRITE (demande utilisateur — le rangement des
	// élèves du document se fait selon leurs résultats) :
	//   1. moyenne annuelle décroissante (les élèves sans moyenne
	//      annuelle passent en fin de tableau) ;
	//   2. ex-aequo départagés par la moyenne des compositions
	//      décroissante ;
	//   3. à défaut, ordre alphabétique (tri stable → N° = rang).
	sort.SliceStable(rows, func(i, j int) bool {
		a, b := rows[i], rows[j]
		switch {
		case a.HasMoyenneAnnuelle != b.HasMoyenneAnnuelle:
			return a.HasMoyenneAnnuelle // classés d'abord
		case a.HasMoyenneAnnuelle && a.MoyenneAnnuelle != b.MoyenneAnnuelle:
			return a.MoyenneAnnuelle > b.MoyenneAnnuelle
		case a.HasMoyenneCompositions != b.HasMoyenneCompositions:
			return a.HasMoyenneCompositions
		case a.HasMoyenneCompositions && a.MoyenneCompositions != b.MoyenneCompositions:
			return a.MoyenneCompositions > b.MoyenneCompositions
		default:
			return a.FullName < b.FullName
		}
	})

	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"school": map[string]interface{}{
			"id":   school.ID,
			"name": school.Name,
			"code": school.Code,
		},
		"iep": map[string]interface{}{
			"name":            iep.Name,
			"region":          iep.Region,
			"bp":              iep.BP,
			"inspector_phone": iep.InspectorPhone,
			"inspector_email": iep.InspectorEmail,
		},
		"class": map[string]interface{}{
			"id":           cls.ID,
			"name":         cls.Name,
			"level":        cls.Level,
			"teacher_name": teacherName,
		},
		"inspecteur":      inspectorName,
		"directeur":       directeurName,
		"session_passage": sessionPassage,
		"year":            year,
		"annee_scolaire":  fmt.Sprintf("%d %d", start, start+1),
		"rows":            rows,
		"summary":         summary,
		"count":           len(rows),
	})
}

// studentFullName assemble « NOM Prénoms » comme sur le document
// (nom en majuscules d'abord).
func studentFullName(lastName, firstName string) string {
	if lastName == "" {
		return firstName
	}
	if firstName == "" {
		return lastName
	}
	return lastName + " " + firstName
}
