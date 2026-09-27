package handlers

// === Niveaux SANS enseignant titulaire — effectifs & redoublants (v12) ===
//
// Demande utilisateur : « il y a des écoles qui n'ont pas d'enseignants
// pour tous les niveaux — permettre de faire spécialement pour ces
// écoles : je remplirai seulement les effectifs et les redoublants ».
//
// v13 — CALCUL DES ENSEIGNANTS ET DES NIVEAUX D'APRÈS L'ÉTAT NOMINATIF
// (demande utilisateur) : « il y a des écoles où l'on rencontre des
// niveaux sans enseignants ou même des écoles à 1, 2, 3 niveaux — il
// faut tenir compte de l'état nominatif pour faire le calcul des
// enseignants et des niveaux ». La liste (GET) renvoie désormais les
// enseignants titulaires d'un cours et les cours tenus, résolus comme
// sur la feuille ; l'interface affiche le calcul et ne propose à la
// déclaration que les cours réellement SANS enseignant.
//
// Les effectifs/redoublants de l'état nominatif vivent normalement sur
// le DOSSIER de l'enseignant (users.effectif_* / redoublant_*, via le
// module Utilisateurs) : sans compte enseignant pour un niveau, aucune
// ligne n'existait pour ce cours dans le document. Cette ressource
// permet à l'école de saisir CES SEULES données pour les niveaux sans
// titulaire — elles apparaissent ensuite automatiquement dans la feuille
// (handlers/personnel.go : ligne avec le COURS et les effectifs, nom
// vide), PDF / Word / Excel, totaux compris.
//
// Routes (router.go) :
//   GET    /api/schools/{schoolID}/level-reports  — lecture (périmètre
//          identique à /api/reports/personnel)
//   POST   /api/schools/{schoolID}/level-reports  — création / mise à
//          jour d'un niveau (module users.teachers write ; directeur =
//          SON école seulement, admin = toutes)
//   DELETE /api/level-reports/{id}                — suppression (mêmes
//          droits que le POST)
//
// Refus (409) si le cours demandé est DÉJÀ tenu par un agent de
// l'école (users.cours ou classe affectée) : l'effectif se saisit alors
// sur la fiche de cet agent, pas ici.

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strings"

	"github.com/go-chi/chi/v5"
	"gorm.io/gorm"

	"sygren-api/database"
	"sygren-api/middleware"
	"sygren-api/models"
)

// loadSchoolForLevelReports — école cible (404 si introuvable).
func loadSchoolForLevelReports(w http.ResponseWriter, schoolID string) *models.School {
	var school models.School
	if err := database.DB.First(&school, "id = ?", schoolID).Error; err != nil {
		middleware.JSONError(w, "école introuvable", http.StatusNotFound)
		return nil
	}
	return &school
}

// levelReportsScope — périmètre de LECTURE, identique à
// GetPersonnelSheet (personnel.go) : directeur = son école, inspecteur =
// écoles de son IEP, conseiller = écoles de son secteur, parent = refus.
// Retourne true si l'accès est autorisé (réponse d'erreur déjà écrite
// sinon).
func levelReportsScope(w http.ResponseWriter, r *http.Request, school models.School) bool {
	switch ctxRole(r) {
	case "director":
		if ctxSchoolID(r) != school.ID {
			middleware.JSONError(w, "accès refusé : niveaux sans enseignant limités à votre école", http.StatusForbidden)
			return false
		}
	case "inspector":
		if ctxIEPID(r) == "" || school.IEPID != ctxIEPID(r) {
			middleware.JSONError(w, "accès refusé : école hors de votre IEP", http.StatusForbidden)
			return false
		}
	case models.RoleConseiller:
		sectorID := conseillerSectorID(r)
		if sectorID == "" || school.SectorID == nil || *school.SectorID != sectorID {
			middleware.JSONError(w, "accès refusé : école hors de votre secteur", http.StatusForbidden)
			return false
		}
	case models.RoleParent:
		middleware.JSONError(w, "accès refusé", http.StatusForbidden)
		return false
	}
	return true
}

// canManageLevelReports — périmètre d'ÉCRITURE : le Super Admin
// (rôle "admin") sur toutes les écoles, le directeur sur SON école
// seulement (les autres rôles — inspecteur, conseiller, adjoint(e),
// parent — sont en lecture seule sur cette ressource).
func canManageLevelReports(w http.ResponseWriter, r *http.Request, school models.School) bool {
	switch ctxRole(r) {
	case "admin":
		return true
	case "director":
		if ctxSchoolID(r) == school.ID {
			return true
		}
		middleware.JSONError(w, "accès refusé : seul le directeur de l'école peut modifier ses niveaux sans enseignant", http.StatusForbidden)
		return false
	default:
		middleware.JSONError(w, "accès refusé : la saisie des niveaux sans enseignant est réservée au directeur et à l'admin", http.StatusForbidden)
		return false
	}
}

// heldCoursByName — cours DÉJÀ TENUS par un agent de l'école
// (directeur / enseignant) : map[UPPER(cours)]nom du titulaire.
// Résolution IDENTIQUE à la feuille (personnel.go) : champ explicite du
// dossier (users.cours) d'abord, sinon classe affectée (classes.teacher_id).
func heldCoursByName(schoolID string) map[string]string {
	_, held := etatNominatifTeachers(schoolID)
	return held
}

// EtatNominatifTeacher — un agent qui tient un cours dans l'état
// nominatif de l'école (v13 — calcul des enseignants et des niveaux).
type EtatNominatifTeacher struct {
	Name  string `json:"name"`
	Cours string `json:"cours"`
}

// etatNominatifTeachers — CALCUL D'APRÈS L'ÉTAT NOMINATIF (v13) :
// les agents (directeur / enseignant) de l'école qui TIENNENT un cours,
// chacun avec le cours tenu — le champ EXPLICITE du dossier personnel
// (users.cours) prime sur la classe affectée, exactement comme la
// résolution de la feuille (personnel.go) — ainsi que le map des cours
// tenus (cours → nom du titulaire, un seul titulaire retenu par cours).
// Les écoles n'ayant qu'une partie des niveaux (voire des niveaux sans
// enseignant) sont ainsi reflétées FIDÈLEMENT : un niveau n'existe que
// si un agent le tient OU si l'école l'a déclaré sans enseignant
// (staff_level_reports).
func etatNominatifTeachers(schoolID string) ([]EtatNominatifTeacher, map[string]string) {
	var staff []models.User
	database.DB.
		Where("school_id = ? AND role IN ?", schoolID,
			[]string{models.RoleDirector, models.RoleTeacher}).
		Order("full_name ASC").
		Find(&staff)

	// Cours tenus via les classes affectées (une seule requête).
	var classes []models.Class
	database.DB.
		Where("school_id = ? AND teacher_id IS NOT NULL", schoolID).
		Find(&classes)
	classNameByTeacher := make(map[string]string, len(classes))
	for _, c := range classes {
		if c.TeacherID == nil {
			continue
		}
		classNameByTeacher[*c.TeacherID] = c.Name
	}

	teachers := make([]EtatNominatifTeacher, 0, len(staff))
	held := make(map[string]string)
	for _, u := range staff {
		cours := ""
		if u.Cours != nil && strings.TrimSpace(*u.Cours) != "" {
			cours = strings.ToUpper(strings.TrimSpace(*u.Cours))
		} else if n, ok := classNameByTeacher[u.ID]; ok {
			cours = strings.ToUpper(strings.TrimSpace(n))
		}
		if cours == "" {
			continue // agent sans cours tenu (directeur, adjoint administratif…)
		}
		teachers = append(teachers, EtatNominatifTeacher{Name: u.FullName, Cours: cours})
		if _, ok := held[cours]; !ok {
			held[cours] = u.FullName
		}
	}
	return teachers, held
}

// ListLevelReports — GET /api/schools/{schoolID}/level-reports
// Niveaux sans titulaire saisis pour l'école, dans l'ordre pédagogique
// des cours (PS MS GS · CP1..CM2 · RPL MAC — classRank, personnel.go).
func ListLevelReports(w http.ResponseWriter, r *http.Request) {
	schoolID := chi.URLParam(r, "schoolID")
	if schoolID == "" {
		middleware.JSONError(w, "schoolID est requis", http.StatusBadRequest)
		return
	}
	school := loadSchoolForLevelReports(w, schoolID)
	if school == nil {
		return
	}
	if !levelReportsScope(w, r, *school) {
		return
	}

	var reports []models.StaffLevelReport
	if err := database.DB.
		Where("school_id = ?", school.ID).
		Find(&reports).Error; err != nil {
		middleware.JSONError(w, "erreur récupération des niveaux sans enseignant", http.StatusInternalServerError)
		return
	}

	// Ordre pédagogique côté serveur (l'interface affiche tel quel).
	sortLevelReports(reports)

	// v13 — CALCUL D'APRÈS L'ÉTAT NOMINATIF : les enseignants qui tiennent
	// un cours (avec le cours tenu) et le map des cours tenus — l'interface
	// en déduit les niveaux réels de l'école (tenus + sans enseignant) et
	// ne propose à la déclaration QUE les cours réellement libres.
	teachers, held := etatNominatifTeachers(school.ID)

	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"level_reports": reports,
		"count":         len(reports),
		// v13 — calcul enseignants / niveaux d'après l'état nominatif.
		"teachers": teachers,
		"held":     held,
	})
}

// sortLevelReports trie les lignes dans l'ordre des cours (stable).
func sortLevelReports(reports []models.StaffLevelReport) {
	sort.SliceStable(reports, func(i, j int) bool {
		ri, rj := classRank(reports[i].Cours), classRank(reports[j].Cours)
		if ri != rj {
			return ri < rj
		}
		return reports[i].Cours < reports[j].Cours
	})
}

// LevelReportInput — payload du POST (création OU mise à jour ; une
// ligne par école + cours : un POST sur un cours existant met à jour).
type LevelReportInput struct {
	Cours       string `json:"cours"`
	EffectifF   *int   `json:"effectif_f"`
	EffectifG   *int   `json:"effectif_g"`
	EffectifT   *int   `json:"effectif_t"`
	RedoublantF *int   `json:"redoublant_f"`
	RedoublantG *int   `json:"redoublant_g"`
	RedoublantT *int   `json:"redoublant_t"`
}

// UpsertLevelReport — POST /api/schools/{schoolID}/level-reports
// Crée ou met à jour la ligne (école + cours) avec SEULEMENT les
// effectifs et les redoublants. Cours validé contre la même bande
// déroulante que le dossier personnel (validCours, personnel.go) ;
// refus si le cours est déjà tenu par un agent de l'école.
func UpsertLevelReport(w http.ResponseWriter, r *http.Request) {
	schoolID := chi.URLParam(r, "schoolID")
	if schoolID == "" {
		middleware.JSONError(w, "schoolID est requis", http.StatusBadRequest)
		return
	}
	var req LevelReportInput
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		middleware.JSONError(w, "payload invalide", http.StatusBadRequest)
		return
	}

	school := loadSchoolForLevelReports(w, schoolID)
	if school == nil {
		return
	}
	if !levelReportsScope(w, r, *school) || !canManageLevelReports(w, r, *school) {
		return
	}

	// Cours : normalisé + validé (même bande déroulante que le dossier).
	cours := strings.ToUpper(strings.TrimSpace(req.Cours))
	if !validCours[cours] {
		middleware.JSONError(w,
			"cours invalide — PS, MS, GS, CP1, CP2, CE1, CE2, CM1, CM2, RPL ou MAC attendu",
			http.StatusBadRequest)
		return
	}

	// Le cours doit être LIBRE : si un agent (directeur/enseignant) le
	// tient déjà, l'effectif se saisit sur SA fiche (module Utilisateurs).
	if holder, ok := heldCoursByName(school.ID)[cours]; ok {
		middleware.JSONError(w,
			fmt.Sprintf("impossible : le cours %s est déjà tenu par %s — l'effectif de ce cours se saisit sur sa fiche personnel",
				cours, holder),
			http.StatusConflict)
		return
	}

	// Bornes identiques au dossier personnel (v9 : T jusqu'à F_max+G_max).
	effF, err := cleanDossierInt(req.EffectifF, 0, 999, "l'effectif F")
	if err != nil {
		middleware.JSONError(w, err.Error(), http.StatusBadRequest)
		return
	}
	effG, err := cleanDossierInt(req.EffectifG, 0, 999, "l'effectif G")
	if err != nil {
		middleware.JSONError(w, err.Error(), http.StatusBadRequest)
		return
	}
	effT, err := cleanDossierInt(req.EffectifT, 0, 1998, "l'effectif T")
	if err != nil {
		middleware.JSONError(w, err.Error(), http.StatusBadRequest)
		return
	}
	redF, err := cleanDossierInt(req.RedoublantF, 0, 999, "les redoublants F")
	if err != nil {
		middleware.JSONError(w, err.Error(), http.StatusBadRequest)
		return
	}
	redG, err := cleanDossierInt(req.RedoublantG, 0, 999, "les redoublants G")
	if err != nil {
		middleware.JSONError(w, err.Error(), http.StatusBadRequest)
		return
	}
	redT, err := cleanDossierInt(req.RedoublantT, 0, 1998, "les redoublants T")
	if err != nil {
		middleware.JSONError(w, err.Error(), http.StatusBadRequest)
		return
	}

	// Upsert (école + cours) — une ligne réactivée si elle avait été
	// supprimée (soft delete).
	var rep models.StaffLevelReport
	err = database.DB.Unscoped().
		Where("school_id = ? AND cours = ?", school.ID, cours).
		First(&rep).Error
	isCreate := false
	if err != nil {
		if err != gorm.ErrRecordNotFound {
			middleware.JSONError(w, "erreur enregistrement", http.StatusInternalServerError)
			return
		}
		isCreate = true
		rep = models.StaffLevelReport{SchoolID: school.ID, Cours: cours}
	} else if rep.DeletedAt.Valid {
		rep.DeletedAt = gorm.DeletedAt{} // réactivation d'une ligne supprimée
	}

	rep.EffectifF = effF
	rep.EffectifG = effG
	rep.EffectifT = effT
	rep.RedoublantF = redF
	rep.RedoublantG = redG
	rep.RedoublantT = redT

	if err := database.DB.Unscoped().Save(&rep).Error; err != nil {
		middleware.JSONError(w, "erreur enregistrement", http.StatusInternalServerError)
		return
	}

	if isCreate {
		LogAction(r, "level_report.created", "school", &school.ID, map[string]interface{}{
			"cours": cours,
		})
	} else {
		LogAction(r, "level_report.updated", "school", &school.ID, map[string]interface{}{
			"cours": cours,
		})
	}

	jsonResponse(w, http.StatusCreated, rep)
}

// DeleteLevelReport — DELETE /api/level-reports/{id}
func DeleteLevelReport(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var rep models.StaffLevelReport
	if err := database.DB.First(&rep, "id = ?", id).Error; err != nil {
		middleware.JSONError(w, "niveau introuvable", http.StatusNotFound)
		return
	}
	school := loadSchoolForLevelReports(w, rep.SchoolID)
	if school == nil {
		return
	}
	if !levelReportsScope(w, r, *school) || !canManageLevelReports(w, r, *school) {
		return
	}
	if err := database.DB.Delete(&rep).Error; err != nil {
		middleware.JSONError(w, "erreur suppression", http.StatusInternalServerError)
		return
	}
	LogAction(r, "level_report.deleted", "school", &school.ID, map[string]interface{}{
		"cours": rep.Cours,
	})
	jsonResponse(w, http.StatusOK, map[string]string{"status": "deleted"})
}
