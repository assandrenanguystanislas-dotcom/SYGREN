package handlers

// === Task 83 — FICHIERS CM2 PAR SECTEUR (module Résultats) ===
//
// Demande : « les fichiers concernent uniquement les élèves de CM2 ; ces
// fichiers doivent être dans le module Résultats de sorte que les élèves
// soient notés à l'ouverture d'une session » — libellés de colonnes
// demandés : matricule, nom, prenoms, libecole, codeecole, libiep, iep,
// exploitation, eveil, orthographe, math, Total, C1 avec iep = 000045,
// libiep = DABOU 1 et C1 = (exploitation + eveil + orthographe + math)/8,5.
//
// Architecture :
//   - Cm2Session : session d'examen CM2 à l'ÉCHELLE DE L'IEP (une seule
//     session couvre toutes les écoles — les EvaluationSession du module
//     Notes restent par école). Cycle de vie identique : draft → open →
//     closed → validated ; la saisie n'est possible qu'en open/closed
//     (sessionWritable) — « notés à l'ouverture d'une session ».
//   - Cm2Result : les 4 notes par élève CM2 (table dédiée — précédent :
//     PDAResult des examens blancs).
//   - Les 4 matières sont rapprochées par NOM normalisé (précédent PDA) :
//     exploitation → Exploitation de Texte, eveil → Etude du Milieu,
//     orthographe → Dictée, math → Mathématiques. Les barèmes appliqués à
//     la saisie sont les barèmes CM RÉELS (getGradeScale : 2–50, Dictée
//     2–20) ; Σ max = 170 et 170/20 = 8,5 → C1 est la moyenne sur /20.
//   - RBAC : lecture = admin/inspector (tout), conseiller (son secteur —
//     liste blanche ConseillerScope étendue), director (son école),
//     teacher (SES classes CM2) ; écriture des notes = RequireModule
//     grades:write avec le même périmètre ; gestion des sessions
//     (création/statut/suppression) = Super Admin + Admin IEP UNIQUEMENT
//     (session IEP — les directeurs gardent leurs EvaluationSession) ;
//     le parent est refusé explicitement (403).

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"sygren-api/database"
	"sygren-api/middleware"
	"sygren-api/models"

	"github.com/go-chi/chi/v5"
	"gorm.io/gorm"
)

// cm2C1Divisor — diviseur de la formule C1 DEMANDÉE par l'utilisateur :
// C1 = Σ(exploitation + eveil + orthographe + math) / 8,5. Avec les barèmes
// CM réels (50+50+20+50 = 170), C1 = Total × 20 / 170 : la moyenne sur /20.
const cm2C1Divisor = 8.5

// Les 4 matières du fichier (libellés de colonnes EXACTS de la demande) et
// leurs alias de rapprochement (noms normalisés — précédent pdaSubjectAliases).
var cm2SubjectKeys = [4]string{"exploitation", "eveil", "orthographe", "math"}

var cm2SubjectAliases = [4][]string{
	{"exploitation de texte", "exploitation des textes"},
	{"etude du milieu", "eveil", "eveil au milieu", "eveil au milieu de vie"},
	{"dictee", "dictee d'orthographe", "orthographe"},
	{"mathematiques", "maths"},
}

// cm2SubjectInfo — état d'une matière du fichier (barème CM réel).
type cm2SubjectInfo struct {
	Key         string `json:"key"`
	Label       string `json:"label"`
	Matched     bool   `json:"matched"`
	SubjectID   string `json:"subject_id,omitempty"`
	SubjectName string `json:"subject_name,omitempty"`
	MinScore    int    `json:"min_score"`
	MaxScore    int    `json:"max_score"`
}

// cm2ResolveSubjects rapproche les 4 matières du fichier avec les matières
// configurées (Subject, liste globale) — même normalisation que le PDA.
func cm2ResolveSubjects() map[string]*models.Subject {
	out := map[string]*models.Subject{}
	var subjects []models.Subject
	if err := database.DB.Find(&subjects).Error; err != nil {
		return out
	}
	aliasIdx := map[string]int{}
	for i := range cm2SubjectKeys {
		for _, a := range cm2SubjectAliases[i] {
			aliasIdx[a] = i
		}
	}
	for i := range subjects {
		if idx, ok := aliasIdx[pdaNormalizeName(subjects[i].Name)]; ok {
			key := cm2SubjectKeys[idx]
			if out[key] == nil {
				out[key] = &subjects[i]
			}
		}
	}
	return out
}

// cm2SubjectInfos — infos des 4 matières avec le barème CM réel
// (getGradeScale : exception matière → défaut niveau CM 2–50).
func cm2SubjectInfos(resolved map[string]*models.Subject) []cm2SubjectInfo {
	infos := make([]cm2SubjectInfo, 0, 4)
	for _, key := range cm2SubjectKeys {
		info := cm2SubjectInfo{Key: key, Label: key, Matched: false, MinScore: 0, MaxScore: 20}
		if subj, ok := resolved[key]; ok {
			info.Matched = true
			info.SubjectID = subj.ID
			info.SubjectName = subj.Name
			info.MinScore, info.MaxScore = getGradeScale("CM", subj.ID)
		}
		infos = append(infos, info)
	}
	return infos
}

// cm2ManageAllowed — gestion des sessions CM2 (créer/ouvrir/clôturer/
// valider/supprimer) réservée au Super Admin et à l'Admin IEP : la session
// couvre TOUTE l'IEP (les directeurs gèrent leurs EvaluationSession).
func cm2ManageAllowed(r *http.Request) bool {
	role := ctxRole(r)
	return role == models.RoleAdmin || role == models.RoleInspector
}

// cm2ReadAllowed — lecture du fichier : tout le personnel ; le parent est
// explicitement refusé (documents de travail IEP).
func cm2ReadAllowed(r *http.Request) bool {
	switch ctxRole(r) {
	case models.RoleAdmin, models.RoleInspector, models.RoleConseiller,
		models.RoleDirector, models.RoleTeacher:
		return true
	}
	return false
}

// === Lister les sessions CM2 — GET /api/cm2/sessions ===
func ListCm2Sessions(w http.ResponseWriter, r *http.Request) {
	if !cm2ReadAllowed(r) {
		middleware.JSONError(w, "accès refusé : les fichiers CM2 sont réservés au personnel de l'IEP", http.StatusForbidden)
		return
	}
	var sessions []models.Cm2Session
	if err := database.DB.Order("year DESC, number DESC, created_at DESC").Find(&sessions).Error; err != nil {
		middleware.JSONError(w, "erreur récupération des sessions CM2", http.StatusInternalServerError)
		return
	}
	type sessionWithCount struct {
		models.Cm2Session
		ResultsCount int64 `json:"results_count"` // élèves déjà notés (au moins 1 note)
	}
	out := make([]sessionWithCount, 0, len(sessions))
	for _, s := range sessions {
		var cnt int64
		database.DB.Model(&models.Cm2Result{}).
			Where("session_id = ?", s.ID).
			Where("note_exploitation IS NOT NULL OR note_eveil IS NOT NULL OR note_orthographe IS NOT NULL OR note_math IS NOT NULL").
			Count(&cnt)
		out = append(out, sessionWithCount{Cm2Session: s, ResultsCount: cnt})
	}
	jsonResponse(w, http.StatusOK, map[string]interface{}{"sessions": out, "count": len(out)})
}

// === Créer une session CM2 (statut draft) — POST /api/cm2/sessions ===
// Unicité (année, numéro) — même convention que les EvaluationSession.
func CreateCm2Session(w http.ResponseWriter, r *http.Request) {
	if !cm2ManageAllowed(r) {
		middleware.JSONError(w, "seul le Super Admin et l'Admin IEP gèrent les sessions CM2 (session à l'échelle de l'IEP)", http.StatusForbidden)
		return
	}
	var req struct {
		Year   int `json:"year"`
		Number int `json:"number"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		middleware.JSONError(w, "payload invalide", http.StatusBadRequest)
		return
	}
	if req.Year < 2000 || req.Year > 2100 {
		middleware.JSONError(w, "année invalide (2000-2100)", http.StatusBadRequest)
		return
	}
	if req.Number < 1 {
		req.Number = 1
	}
	var count int64
	database.DB.Model(&models.Cm2Session{}).
		Where("year = ? AND number = ?", req.Year, req.Number).
		Count(&count)
	if count > 0 {
		middleware.JSONError(w, fmt.Sprintf("une session CM2 N°%d existe déjà pour l'année %d", req.Number, req.Year), http.StatusConflict)
		return
	}
	session := models.Cm2Session{Year: req.Year, Number: req.Number, Status: "draft"}
	if err := database.DB.Create(&session).Error; err != nil {
		middleware.JSONError(w, "erreur création session CM2", http.StatusInternalServerError)
		return
	}
	jsonResponse(w, http.StatusCreated, session)
}

// === Changer le statut d'une session CM2 — PUT /api/cm2/sessions/{id}/status ===
// Transitions identiques aux EvaluationSession : draft→open, open→closed,
// closed→validated. La validation est irréversible (notes verrouillées).
func UpdateCm2SessionStatus(w http.ResponseWriter, r *http.Request) {
	if !cm2ManageAllowed(r) {
		middleware.JSONError(w, "seul le Super Admin et l'Admin IEP gèrent les sessions CM2", http.StatusForbidden)
		return
	}
	id := chi.URLParam(r, "id")
	var req struct {
		Status string `json:"status"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		middleware.JSONError(w, "payload invalide", http.StatusBadRequest)
		return
	}
	var session models.Cm2Session
	if err := database.DB.First(&session, "id = ?", id).Error; err != nil {
		middleware.JSONError(w, "session CM2 introuvable", http.StatusNotFound)
		return
	}
	validNext := map[string]string{
		"draft":  "open",
		"open":   "closed",
		"closed": "validated",
	}
	expected, canTransition := validNext[session.Status]
	if !canTransition {
		middleware.JSONError(w, "session CM2 déjà validée, modification impossible", http.StatusConflict)
		return
	}
	if req.Status != expected {
		middleware.JSONError(w, "transition invalide : "+session.Status+" → "+req.Status+" (attendu : "+expected+")", http.StatusBadRequest)
		return
	}
	session.Status = req.Status
	session.UpdatedAt = time.Now()
	if req.Status == "open" {
		now := time.Now()
		session.OpenAt = &now
	}
	if err := database.DB.Save(&session).Error; err != nil {
		middleware.JSONError(w, "erreur mise à jour", http.StatusInternalServerError)
		return
	}
	jsonResponse(w, http.StatusOK, session)
}

// === Supprimer une session CM2 et ses notes — DELETE /api/cm2/sessions/{id} ===
// Interdit après validation (statut terminal — cohérent avec les sessions
// de notes dont la validation verrouille l'historique).
func DeleteCm2Session(w http.ResponseWriter, r *http.Request) {
	if !cm2ManageAllowed(r) {
		middleware.JSONError(w, "seul le Super Admin et l'Admin IEP gèrent les sessions CM2", http.StatusForbidden)
		return
	}
	id := chi.URLParam(r, "id")
	var session models.Cm2Session
	if err := database.DB.First(&session, "id = ?", id).Error; err != nil {
		middleware.JSONError(w, "session CM2 introuvable", http.StatusNotFound)
		return
	}
	if session.Status == "validated" {
		middleware.JSONError(w, "session CM2 validée — suppression impossible (statut terminal)", http.StatusConflict)
		return
	}
	if err := database.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("session_id = ?", session.ID).Delete(&models.Cm2Result{}).Error; err != nil {
			return err
		}
		return tx.Delete(&session).Error
	}); err != nil {
		middleware.JSONError(w, "erreur suppression session CM2", http.StatusInternalServerError)
		return
	}
	jsonResponse(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// cm2DBRow — ligne brute du fichier (élève CM2 + école + secteur + notes).
type cm2DBRow struct {
	StudentID       string   `gorm:"column:student_id"`
	Matricule       *string  `gorm:"column:matricule"`
	Nom             string   `gorm:"column:nom"`
	Prenoms         string   `gorm:"column:prenoms"`
	ClassName       string   `gorm:"column:class_name"`
	SchoolID        string   `gorm:"column:school_id"`
	SchoolName      string   `gorm:"column:school_name"`
	SchoolCode      string   `gorm:"column:school_code"`
	SecteurID       *string  `gorm:"column:secteur_id"`
	SecteurName     *string  `gorm:"column:secteur_name"`
	SecteurPosition *int     `gorm:"column:secteur_position"`
	NoteExploitation *float64 `gorm:"column:note_exploitation"`
	NoteEveil        *float64 `gorm:"column:note_eveil"`
	NoteOrthographe  *float64 `gorm:"column:note_orthographe"`
	NoteMath         *float64 `gorm:"column:note_math"`
}

// cm2Student — élève du fichier (payload JSON de GET .../file).
type cm2Student struct {
	StudentID        string   `json:"student_id"`
	Matricule        *string  `json:"matricule"` // NULL = non renseigné (cellule vide dans le fichier)
	Nom              string   `json:"nom"`
	Prenoms          string   `json:"prenoms"`
	ClassName        string   `json:"class_name"`
	SchoolID         string   `json:"school_id"`
	SchoolName       string   `json:"school_name"` // = libecole
	SchoolCode       string   `json:"school_code"` // = codeecole
	NoteExploitation *float64 `json:"note_exploitation"`
	NoteEveil        *float64 `json:"note_eveil"`
	NoteOrthographe  *float64 `json:"note_orthographe"`
	NoteMath         *float64 `json:"note_math"`
	Total            *float64 `json:"total"` // Σ notes dès 1 note (NULL = aucune)
	C1               *float64 `json:"c1"`    // Σ / 8,5 dès les 4 notes (NULL sinon)
}

type cm2SchoolGroup struct {
	SchoolID   string       `json:"school_id"`
	SchoolName string       `json:"school_name"`
	SchoolCode string       `json:"school_code"`
	Students   []cm2Student `json:"students"`
}

type cm2SectorGroup struct {
	SecteurID   *string          `json:"secteur_id"` // NULL = écoles hors secteur (groupe « HORS SECTEUR »)
	SecteurName string           `json:"secteur_name"`
	Schools     []cm2SchoolGroup `json:"schools"`
}

type cm2Permissions struct {
	CanGrade  bool `json:"can_grade"`  // rôle autorisé à saisir (admin/inspector/director/teacher)
	Writable  bool `json:"writable"`   // session en open/closed (saisie possible)
	CanManage bool `json:"can_manage"` // admin/inspector : créer/ouvrir/clôturer/valider/supprimer
	CanExport bool `json:"can_export"` // Super Admin : production de fichiers (politique anti-fuite)
}

// cm2TotalC1 — Total = Σ notes dès qu'au moins une est saisie ; C1 =
// Σ / 8,5 dès que les 4 notes sont présentes (mêmes règles que les
// formules Excel des fichiers par secteur : =IF(COUNT(...)=4,SUM/8.5,"")).
func cm2TotalC1(exp, eveil, orth, math *float64) (*float64, *float64) {
	cnt := 0
	sum := 0.0
	for _, n := range []*float64{exp, eveil, orth, math} {
		if n != nil {
			cnt++
			sum += *n
		}
	}
	var total, c1 *float64
	if cnt > 0 {
		t := sum
		total = &t
	}
	if cnt == 4 {
		c := sum / cm2C1Divisor
		c1 = &c
	}
	return total, c1
}

// === Le fichier CM2 complet — GET /api/cm2/sessions/{id}/file ===
// Tous les élèves de CM2 actifs du périmètre du rôle, groupés secteur →
// école, avec leurs notes de la session (LEFT JOIN cm2_results). L'ordre
// SQL (position secteur, nom école, nom élève) est conservé tel quel.
func GetCm2File(w http.ResponseWriter, r *http.Request) {
	if !cm2ReadAllowed(r) {
		middleware.JSONError(w, "accès refusé : les fichiers CM2 sont réservés au personnel de l'IEP", http.StatusForbidden)
		return
	}
	id := chi.URLParam(r, "id")
	var session models.Cm2Session
	if err := database.DB.First(&session, "id = ?", id).Error; err != nil {
		middleware.JSONError(w, "session CM2 introuvable", http.StatusNotFound)
		return
	}

	// Périmètre selon le rôle (mêmes règles que le module Notes / Task 78) :
	// admin+inspector = tout ; conseiller = écoles de son secteur ;
	// director = son école ; teacher = SES classes CM2 (titulaire ou cours
	// tenu — teacherClassCondition).
	role := ctxRole(r)
	args := []interface{}{session.ID}
	switch role {
	case models.RoleAdmin, models.RoleInspector:
		// tout le périmètre IEP
	case models.RoleConseiller:
		args = append(args, conseillerSectorSchoolIDs(r))
	case models.RoleDirector:
		args = append(args, ctxSchoolID(r))
	case models.RoleTeacher:
		cond, cargs := teacherClassCondition(ctxUserID(r))
		args = append(args, cargs...)
		query := `SELECT s.id AS student_id, s.matricule AS matricule,
       s.last_name AS nom, s.first_name AS prenoms,
       c.name AS class_name,
       sc.id AS school_id, sc.name AS school_name, sc.code AS school_code,
       sec.id AS secteur_id, sec.name AS secteur_name, sec.position AS secteur_position,
       r.note_exploitation, r.note_eveil, r.note_orthographe, r.note_math
FROM students s
JOIN classes c  ON c.id = s.class_id AND c.active = TRUE AND UPPER(TRIM(c.name)) = 'CM2'
JOIN schools sc ON sc.id = c.school_id
LEFT JOIN sectors sec ON sec.id = sc.sector_id
LEFT JOIN cm2_results r ON r.student_id = s.id AND r.session_id = ?
WHERE s.class_id IN (SELECT id FROM classes WHERE ` + cond + ` AND active = TRUE AND UPPER(TRIM(name)) = 'CM2')
ORDER BY sec.position NULLS LAST, sec.name NULLS LAST, sc.name, s.last_name, s.first_name`
		var rows []cm2DBRow
		if err := database.DB.Raw(query, args...).Scan(&rows).Error; err != nil {
			middleware.JSONError(w, "erreur récupération du fichier CM2", http.StatusInternalServerError)
			return
		}
		jsonResponse(w, http.StatusOK, cm2FileResponse(session, rows, role))
		return
	default:
		middleware.JSONError(w, "accès refusé : les fichiers CM2 sont réservés au personnel de l'IEP", http.StatusForbidden)
		return
	}

	query := `SELECT s.id AS student_id, s.matricule AS matricule,
       s.last_name AS nom, s.first_name AS prenoms,
       c.name AS class_name,
       sc.id AS school_id, sc.name AS school_name, sc.code AS school_code,
       sec.id AS secteur_id, sec.name AS secteur_name, sec.position AS secteur_position,
       r.note_exploitation, r.note_eveil, r.note_orthographe, r.note_math
FROM students s
JOIN classes c  ON c.id = s.class_id AND c.active = TRUE AND UPPER(TRIM(c.name)) = 'CM2'
JOIN schools sc ON sc.id = c.school_id
LEFT JOIN sectors sec ON sec.id = sc.sector_id
LEFT JOIN cm2_results r ON r.student_id = s.id AND r.session_id = ?
` + "WHERE sc.id IN ?" /* remplacé ci-dessous selon le rôle */ + `
ORDER BY sec.position NULLS LAST, sec.name NULLS LAST, sc.name, s.last_name, s.first_name`

	// Adapter le WHERE au rôle (admin/inspector : aucun filtre).
	switch role {
	case models.RoleConseiller:
		// args déjà [sessionID, schoolIDs] — WHERE sc.id IN ?
	case models.RoleDirector:
		// args déjà [sessionID, schoolID] — WHERE sc.id = ?
		query = replaceCm2Where(query, "sc.id = ?")
	case models.RoleAdmin, models.RoleInspector:
		query = replaceCm2Where(query, "1 = 1")
		args = args[:1]
	}

	var rows []cm2DBRow
	if err := database.DB.Raw(query, args...).Scan(&rows).Error; err != nil {
		middleware.JSONError(w, "erreur récupération du fichier CM2", http.StatusInternalServerError)
		return
	}
	jsonResponse(w, http.StatusOK, cm2FileResponse(session, rows, role))
}

// replaceCm2Where — remplace le fragment WHERE par défaut du fichier CM2
// par la condition du rôle (petit utilitaire pour garder la requête unique).
func replaceCm2Where(query, cond string) string {
	return strings.Replace(query, "WHERE sc.id IN ?", "WHERE "+cond, 1)
}

// cm2FileResponse — assemble la réponse du fichier (groupes + permissions).
func cm2FileResponse(session models.Cm2Session, rows []cm2DBRow, role string) map[string]interface{} {
	groups := []*cm2SectorGroup{}
	groupByKey := map[string]*cm2SectorGroup{}
	schoolByKey := map[string]*cm2SchoolGroup{}
	totalStudents := 0
	for i := range rows {
		row := &rows[i]
		key := ""
		name := "HORS SECTEUR"
		if row.SecteurID != nil && *row.SecteurID != "" {
			key = *row.SecteurID
			name = *row.SecteurName
			if name == "" {
				name = "HORS SECTEUR"
			}
		}
		g, ok := groupByKey[key]
		if !ok {
			g = &cm2SectorGroup{SecteurID: row.SecteurID, SecteurName: name, Schools: []cm2SchoolGroup{}}
			groupByKey[key] = g
			groups = append(groups, g)
		}
		skey := row.SchoolID
		sch, ok := schoolByKey[skey]
		if !ok {
			// Appel d'abord, PUIS pointage sur l'élément inséré : stocker le
			// pointeur avant l'append ferait diverger l'original et la copie
			// (les élèves suivants s'accumuleraient hors du slice visible).
			g.Schools = append(g.Schools, cm2SchoolGroup{SchoolID: row.SchoolID, SchoolName: row.SchoolName, SchoolCode: row.SchoolCode, Students: []cm2Student{}})
			sch = &g.Schools[len(g.Schools)-1]
			schoolByKey[skey] = sch
		}
		total, c1 := cm2TotalC1(row.NoteExploitation, row.NoteEveil, row.NoteOrthographe, row.NoteMath)
		sch.Students = append(sch.Students, cm2Student{
			StudentID:        row.StudentID,
			Matricule:        row.Matricule,
			Nom:              row.Nom,
			Prenoms:          row.Prenoms,
			ClassName:        row.ClassName,
			SchoolID:         row.SchoolID,
			SchoolName:       row.SchoolName,
			SchoolCode:       row.SchoolCode,
			NoteExploitation: row.NoteExploitation,
			NoteEveil:        row.NoteEveil,
			NoteOrthographe:  row.NoteOrthographe,
			NoteMath:         row.NoteMath,
			Total:            total,
			C1:               c1,
		})
		totalStudents++
	}

	role0 := role
	perms := cm2Permissions{
		CanGrade: role0 == models.RoleAdmin || role0 == models.RoleInspector ||
			role0 == models.RoleDirector || role0 == models.RoleTeacher,
		Writable:  sessionWritable(session.Status),
		CanManage: cm2ManageAllowedFromRole(role0),
		CanExport: role0 == models.RoleAdmin,
	}

	resolved := cm2ResolveSubjects()
	return map[string]interface{}{
		"session":    session,
		"subjects":   cm2SubjectInfos(resolved),
		"c1_divisor": cm2C1Divisor,
		"groups":     groups,
		"count":      totalStudents,
		"permissions": perms,
	}
}

// cm2ManageAllowedFromRole — variante sans requête (réponse déjà en main).
func cm2ManageAllowedFromRole(role string) bool {
	return role == models.RoleAdmin || role == models.RoleInspector
}

// === Enregistrer les notes d'un lot d'élèves — POST /api/cm2/sessions/{id}/results ===
// Saisie possible en open ET closed (sessionWritable — mêmes règles que le
// module Notes : clôturée = modifiable jusqu'à la validation), verrouillée
// en draft (pas encore ouverte) et en validated. Le payload porte l'ÉTAT
// COMPLET de chaque ligne (4 champs, NULL = note effacée/absente).
func SaveCm2Results(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var session models.Cm2Session
	if err := database.DB.First(&session, "id = ?", id).Error; err != nil {
		middleware.JSONError(w, "session CM2 introuvable", http.StatusNotFound)
		return
	}
	if !sessionWritable(session.Status) {
		if session.Status == "draft" {
			middleware.JSONError(w, "la session CM2 n'est pas encore ouverte — les notes sont verrouillées jusqu'à l'ouverture", http.StatusConflict)
			return
		}
		middleware.JSONError(w, "session CM2 validée — les notes sont verrouillées définitivement", http.StatusConflict)
		return
	}
	var req struct {
		Results []struct {
			StudentID        string   `json:"student_id"`
			NoteExploitation *float64 `json:"note_exploitation"`
			NoteEveil        *float64 `json:"note_eveil"`
			NoteOrthographe  *float64 `json:"note_orthographe"`
			NoteMath         *float64 `json:"note_math"`
		} `json:"results"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		middleware.JSONError(w, "payload invalide", http.StatusBadRequest)
		return
	}
	if len(req.Results) == 0 {
		middleware.JSONError(w, "results est requis", http.StatusBadRequest)
		return
	}
	// Pas de doublon d'élève dans le lot (0 note partielle).
	seen := map[string]bool{}
	ids := make([]string, 0, len(req.Results))
	for _, it := range req.Results {
		if it.StudentID == "" || seen[it.StudentID] {
			middleware.JSONError(w, "student_id vide ou dupliqué dans results", http.StatusBadRequest)
			return
		}
		seen[it.StudentID] = true
		ids = append(ids, it.StudentID)
	}

	// Les élèves doivent exister et être des CM2 actifs.
	type studRef struct {
		ID       string `gorm:"column:id"`
		ClassID  string `gorm:"column:class_id"`
		SchoolID string `gorm:"column:school_id"`
		Active   bool   `gorm:"column:active"`
		Name     string `gorm:"column:name"`
	}
	var studs []studRef
	if err := database.DB.Raw(
		`SELECT s.id, s.class_id, c.school_id, c.active, c.name
FROM students s JOIN classes c ON c.id = s.class_id WHERE s.id IN ?`, ids).Scan(&studs).Error; err != nil {
		middleware.JSONError(w, "erreur vérification des élèves", http.StatusInternalServerError)
		return
	}
	studMap := map[string]studRef{}
	for _, s := range studs {
		studMap[s.ID] = s
	}
	for _, sid := range ids {
		s, ok := studMap[sid]
		if !ok || !s.Active || !strings.EqualFold(strings.TrimSpace(s.Name), "CM2") {
			middleware.JSONError(w, "un ou plusieurs élèves sont introuvables ou ne sont pas des CM2", http.StatusBadRequest)
			return
		}
	}

	// Périmètre de saisie selon le rôle.
	role := ctxRole(r)
	switch role {
	case models.RoleAdmin, models.RoleInspector:
		// tout périmètre
	case models.RoleDirector:
		schoolID := ctxSchoolID(r)
		if schoolID == "" {
			middleware.JSONError(w, "aucune école rattachée à votre compte", http.StatusForbidden)
			return
		}
		for _, sid := range ids {
			if studMap[sid].SchoolID != schoolID {
				middleware.JSONError(w, "vous ne saisissez que les notes des élèves de votre école", http.StatusForbidden)
				return
			}
		}
	case models.RoleTeacher:
		cond, cargs := teacherClassCondition(ctxUserID(r))
		var classes []models.Class
		if err := database.DB.Where("active = TRUE AND UPPER(TRIM(name)) = 'CM2' AND "+cond, cargs...).Find(&classes).Error; err != nil {
			middleware.JSONError(w, "erreur vérification de vos classes", http.StatusInternalServerError)
			return
		}
		allowed := map[string]bool{}
		for _, c := range classes {
			allowed[c.ID] = true
		}
		for _, sid := range ids {
			if !allowed[studMap[sid].ClassID] {
				middleware.JSONError(w, "vous ne saisissez que les notes des élèves de votre classe", http.StatusForbidden)
				return
			}
		}
	default:
		middleware.JSONError(w, "accès refusé : saisie des notes CM2 non autorisée pour votre rôle", http.StatusForbidden)
		return
	}

	// Barèmes : chaque note fournie est contrôlée contre le barème CM réel
	// (exception Dictée → orthographe 2–20, défaut CM 2–50 pour le reste).
	resolved := cm2ResolveSubjects()
	for _, it := range req.Results {
		checks := []struct {
			key string
			n   *float64
		}{
			{"exploitation", it.NoteExploitation},
			{"eveil", it.NoteEveil},
			{"orthographe", it.NoteOrthographe},
			{"math", it.NoteMath},
		}
		for _, c := range checks {
			if c.n == nil {
				continue
			}
			subj, ok := resolved[c.key]
			if !ok {
				middleware.JSONError(w, fmt.Sprintf("matière %s introuvable dans la configuration des matières — vérifiez le module Matières", c.key), http.StatusBadRequest)
				return
			}
			mn, mx := getGradeScale("CM", subj.ID)
			if *c.n < float64(mn) || *c.n > float64(mx) {
				middleware.JSONError(w, fmt.Sprintf("note %s invalide : attendu entre %d et %d (barème CM)", c.key, mn, mx), http.StatusBadRequest)
				return
			}
		}
	}

	// Upsert état complet (transaction — tout ou rien).
	if err := database.DB.Transaction(func(tx *gorm.DB) error {
		for _, it := range req.Results {
			var existing models.Cm2Result
			err := tx.Where("session_id = ? AND student_id = ?", id, it.StudentID).First(&existing).Error
			if err == gorm.ErrRecordNotFound {
				nr := models.Cm2Result{
					SessionID:        id,
					StudentID:        it.StudentID,
					NoteExploitation: it.NoteExploitation,
					NoteEveil:        it.NoteEveil,
					NoteOrthographe:  it.NoteOrthographe,
					NoteMath:         it.NoteMath,
				}
				if err := tx.Create(&nr).Error; err != nil {
					return err
				}
			} else if err != nil {
				return err
			} else {
				existing.NoteExploitation = it.NoteExploitation
				existing.NoteEveil = it.NoteEveil
				existing.NoteOrthographe = it.NoteOrthographe
				existing.NoteMath = it.NoteMath
				if err := tx.Save(&existing).Error; err != nil {
					return err
				}
			}
		}
		return nil
	}); err != nil {
		middleware.JSONError(w, "erreur enregistrement des notes", http.StatusInternalServerError)
		return
	}
	jsonResponse(w, http.StatusOK, map[string]interface{}{"status": "saved", "count": len(req.Results)})
}
