package handlers

import (
	"fmt"
	"net/http"
	"strings"

	"sygren-api/database"
	"sygren-api/middleware"
	"sygren-api/models"
)

// === Portail Parent (v2 — module "parent-portal") ===
//
// Le PARENT (rôle parent — compte créé dans le module Utilisateurs) consulte
// et imprime LE BULLETIN INDIVIDUEL de son enfant À PARTIR DU MATRICULE :
//   - GET /api/parent/student         → élève + classe + école + sessions
//   - GET /api/parent/end-of-year     → bulletin individuel « RESULTATS DE
//     FIN D'ANNEE » (module Résultats) — même payload que le document de
//     classe, limité au périmètre enfant ;
//   - GET /api/parent/period-bulletin → bulletin individuel de période
//     (module Bulletins — modèle A5) pour une session donnée.
//
// La consultation est autorisée pour TOUT matricule saisi par le parent
// (convention « le parent avec le matricule de son enfant pourra consulter »)
// ; l'IMPRESSION côté frontend est réservée au portail parent (et aux rôles
// admin/inspector sur les documents internes).
//
// RBAC : routes protégées par RequireModule(models.ModuleParentPortal,
// "read") — parent, admin, inspector. Les endpoints génériques (reports,
// computation…) restent fermés au parent (default-deny).

// resolveStudentByMatricule charge l'élève (matricule insensible à la casse
// et aux espaces), sa classe et son école.
func resolveStudentByMatricule(matricule string) (*models.Student, *models.Class, *models.School, error) {
	matricule = strings.TrimSpace(matricule)
	if matricule == "" {
		return nil, nil, nil, fmt.Errorf("matricule requis")
	}
	// LOWER() : compatible SQLite (dev) ET PostgreSQL (Neon — prod).
	var st models.Student
	if err := database.DB.Where("LOWER(matricule) = LOWER(?)", matricule).First(&st).Error; err != nil {
		return nil, nil, nil, fmt.Errorf("aucun élève trouvé pour le matricule %q — vérifiez la saisie", matricule)
	}
	var cls models.Class
	if err := database.DB.First(&cls, "id = ?", st.ClassID).Error; err != nil {
		return nil, nil, nil, fmt.Errorf("classe de l'élève introuvable")
	}
	var school models.School
	if err := database.DB.First(&school, "id = ?", cls.SchoolID).Error; err != nil {
		return nil, nil, nil, fmt.Errorf("école introuvable")
	}
	return &st, &cls, &school, nil
}

// GetParentStudent — GET /api/parent/student?matricule=XXXX
// Retourne l'élève (par matricule), sa classe, son école, son IEP et la
// liste des sessions de l'école (pour le choix du bulletin de période).
func GetParentStudent(w http.ResponseWriter, r *http.Request) {
	matricule := r.URL.Query().Get("matricule")
	st, cls, school, err := resolveStudentByMatricule(matricule)
	if err != nil {
		middleware.JSONError(w, err.Error(), http.StatusNotFound)
		return
	}

	var iep models.IEP
	_ = database.DB.First(&iep, "id = ?", school.IEPID).Error

	// Sessions de l'école (hors annulées) — pour les bulletins de période.
	// Les données réelles (moyennes) déterminent ce qui est consultable.
	var sessions []models.EvaluationSession
	if err := database.DB.
		Where("school_id = ? AND status != ?", school.ID, "cancelled").
		Order("year DESC, month DESC").Find(&sessions).Error; err != nil {
		middleware.JSONError(w, "erreur récupération des sessions", http.StatusInternalServerError)
		return
	}

	// Années disponibles pour le bulletin de fin d'année (sessions + année
	// système) — le frontend propose le choix.
	yearSet := map[int]bool{}
	for _, s := range sessions {
		yearSet[s.Year] = true
	}
	sysYear, _, _ := GetSystemSettings()
	yearSet[sysYear] = true
	years := make([]int, 0, len(yearSet))
	for y := range yearSet {
		years = append(years, y)
	}

	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"student": map[string]interface{}{
			"id":         st.ID,
			"matricule":  matriculeOrNA(st.Matricule),
			"last_name":  st.LastName,
			"first_name": st.FirstName,
			"full_name":  studentFullName(st.LastName, st.FirstName),
			"gender":     st.Gender,
			"birth_year": st.BirthYear,
		},
		"class": map[string]interface{}{
			"id":    cls.ID,
			"name":  cls.Name,
			"level": cls.Level,
		},
		"school": map[string]interface{}{
			"id":   school.ID,
			"name": school.Name,
			"code": school.Code,
		},
		"iep": map[string]interface{}{
			"name":   iep.Name,
			"region": iep.Region,
		},
		"sessions":    sessions,
		"years":       years,
		"system_year": sysYear,
		"student_id":  st.ID,
	})
}

// GetParentEndOfYear — GET /api/parent/end-of-year?matricule=XXXX&year=YYYY
// Bulletin individuel « RESULTATS DE FIN D'ANNEE » : le payload est EXACTEMENT
// celui du document de classe (buildEndOfYearSheet — moyennes, rang/effectif,
// décision, récapitulatif) + student_id pour que le frontend isole le
// bulletin de l'enfant.
func GetParentEndOfYear(w http.ResponseWriter, r *http.Request) {
	matricule := r.URL.Query().Get("matricule")
	st, cls, school, err := resolveStudentByMatricule(matricule)
	if err != nil {
		middleware.JSONError(w, err.Error(), http.StatusNotFound)
		return
	}

	year := 0
	if y := r.URL.Query().Get("year"); y != "" {
		fmt.Sscanf(y, "%d", &year)
	}
	if year == 0 {
		schoolYear, _, _ := GetSystemSettings()
		year = schoolYear
	}

	payload, err := buildEndOfYearSheet(*school, *cls, year)
	if err != nil {
		middleware.JSONError(w, err.Error(), http.StatusInternalServerError)
		return
	}
	payload["student_id"] = st.ID
	jsonResponse(w, http.StatusOK, payload)
}

// GetParentPeriodBulletin — GET /api/parent/period-bulletin?matricule=XXXX&session_id=YYYY
// Bulletin individuel de PÉRIODE (module Bulletins — modèle A5) : payload
// identique au relevé de classe (buildReleveData) + student_id. La session
// doit appartenir à l'école de l'enfant.
func GetParentPeriodBulletin(w http.ResponseWriter, r *http.Request) {
	matricule := r.URL.Query().Get("matricule")
	st, cls, _, err := resolveStudentByMatricule(matricule)
	if err != nil {
		middleware.JSONError(w, err.Error(), http.StatusNotFound)
		return
	}

	sessionID := r.URL.Query().Get("session_id")
	if sessionID == "" {
		middleware.JSONError(w, "session_id requis", http.StatusBadRequest)
		return
	}
	var session models.EvaluationSession
	if err := database.DB.First(&session, "id = ?", sessionID).Error; err != nil {
		middleware.JSONError(w, "session introuvable", http.StatusNotFound)
		return
	}
	if session.SchoolID != cls.SchoolID {
		middleware.JSONError(w, "cette session n'appartient pas à l'école de l'élève", http.StatusForbidden)
		return
	}

	data, err := buildReleveData(session, cls.ID)
	if err != nil {
		middleware.JSONError(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Rangs réels de la classe (ordre de mérite, ex-aequo gérés par
	// computeSessionResults) — le frontend en tire le rang de l'enfant
	// pour le bulletin A5.
	ranks := make([]map[string]interface{}, 0, 8)
	if results, err := computeSessionResults(session.ID); err == nil {
		for _, res := range results.Results {
			if res.ClassID != cls.ID || res.Rank <= 0 {
				continue
			}
			ranks = append(ranks, map[string]interface{}{
				"matricule": res.Matricule,
				"rank":      res.Rank,
			})
		}
	}

	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"releve":     data,
		"student_id": st.ID,
		"ranks":      ranks,
	})
}
