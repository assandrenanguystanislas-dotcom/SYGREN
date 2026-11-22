package handlers

// === Task 84 — FICHIERS CM2 PAR SECTEUR : NOTES GÉNÉRÉES DEPUIS LE MODULE ÉVALUATIONS ===
//
// Demande (Task 83) : « les fichiers concernent uniquement les élèves de
// CM2 ; ces fichiers doivent être dans le module Résultats » — libellés de
// colonnes demandés : matricule, nom, prenoms, libecole, codeecole, libiep,
// iep, exploitation, eveil, orthographe, math, Total, C1 avec iep = 000045,
// libiep = DABOU 1 et C1 = (exploitation + eveil + orthographe + math)/8,5.
//
// Précision utilisateur (Task 84) : « le fichier CM2 du module résultat
// n'est pas différent de celui de l'évaluation — ils ont les mêmes
// caractéristiques mais dans le fichier CM2 du module résultat, les notes
// NE SONT PAS SAISIES : les notes du module évaluations sont GÉNÉRÉES
// DIRECTEMENT dans le module résultat ».
//
// Architecture Task 84 :
//   - PLUS AUCUNE SAISIE : les tables dédiées cm2_sessions / cm2_results
//     (Task 83) sont supprimées. Le fichier CM2 est une vue LECTURE SEULE
//     qui agrège les notes déjà saisies dans le MODULE ÉVALUATIONS
//     (grades des compositions) — les directeurs/enseignants continuent de
//     noter dans leur module habituel, le module Résultats se met à jour
//     automatiquement.
//   - Les « sessions » du fichier CM2 sont les ROUNDS DE COMPOSITION
//     détectés automatiquement : (year, eval_number) DISTINCT des
//     EvaluationSession éligibles du module Évaluations (ouvertes, closes
//     ou archivées — jamais les brouillons, jamais les annulées). Les
//     écoles font la même composition à des mois différents : le round
//     (2026, N°1) couvre sept./oct./nov. d'un même mouvement.
//   - Note d'un élève pour une matière = sa note pour ce round prise dans
//     la session d'évaluation la plus RÉCENTE de son école (mois, création,
//     mise à jour) — en cas de session re-créée, la dernière gagne.
//   - Les 4 matières sont rapprochées par NOM normalisé (précédent PDA) :
//     exploitation → Exploitation de Texte, eveil → Etude du Milieu,
//     orthographe → Dictée, math → Mathématiques. Barèmes CM réels
//     (getGradeScale : 2–50, Dictée 2–20) ; Σ max = 170 et 170/20 = 8,5 →
//     C1 est la moyenne sur /20.
//   - RBAC lecture inchangé : admin/inspector (tout), conseiller (son
//     secteur — liste blanche ConseillerScope), director (son école),
//     teacher (SES classes CM2 via teacherClassCondition), parent 403.
//   - Export Excel par secteur (Super Admin) inchangé — notes péremplies
//     depuis les évaluations.

import (
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"time"

	"sygren-api/database"
	"sygren-api/middleware"
	"sygren-api/models"

	"github.com/go-chi/chi/v5"
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

// cm2RoundStatuses — statuts d'EvaluationSession dont les notes alimentent
// le fichier : composition réellement saisie (ouverte, clôturée ou
// archivée). Les brouillons (aucune note possible) et les annulées
// (cancelled_at) sont exclus ; les notes en cours de saisie (is_draft des
// grades) restent visibles : le fichier suit le module Évaluations en live.
const cm2RoundStatuses = "('open','closed','archived')"

// cm2RoundFilter — filtre commun des rounds de composition (années +
// statuts + non annulées + compositions uniquement).
const cm2RoundFilter = "es.eval_number >= 1 AND es.status IN " + cm2RoundStatuses +
	" AND es.cancelled_at IS NULL AND es.eval_type = 'composition'"

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

// cm2RoundRef — round de composition (année, N°) alimentant le fichier.
type cm2RoundRef struct {
	Year   int `json:"year"`
	Number int `json:"number"` // N° de composition (eval_number du module Évaluations)
}

// cm2RoundRow — ligne de GET /api/cm2/rounds.
type cm2RoundRow struct {
	Year    int   `gorm:"column:year" json:"year"`
	Number  int   `gorm:"column:number" json:"number"`
	Notated int64 `gorm:"column:notated" json:"notated"` // élèves CM2 avec ≥1 note
}

// === Lister les compositions détectées — GET /api/cm2/rounds ===
// Les « sessions » du fichier CM2 ne se créent plus : elles sont DÉDUITES
// des EvaluationSession du module Évaluations. Un round apparaît dès qu'une
// école ouvre sa composition ; « notated » = élèves CM2 déjà notés (au
// moins 1 matière), mis à jour en continu.
func ListCm2Rounds(w http.ResponseWriter, r *http.Request) {
	if !cm2ReadAllowed(r) {
		middleware.JSONError(w, "accès refusé : les fichiers CM2 sont réservés au personnel de l'IEP", http.StatusForbidden)
		return
	}
	// DEUX requêtes simples fusionnées en mémoire : un CTE + LEFT JOIN avec
	// COUNT(DISTINCT) multiplie les lignes sous certains plans SQLite (bug
	// constaté au test fonctionnel Task 84) — séparées, elles restent
	// portables PostgreSQL (Neon) / SQLite (tests).
	var roundsRaw []cm2RoundRow
	if err := database.DB.Raw(`SELECT DISTINCT es.year, es.eval_number AS number
FROM evaluation_sessions es
WHERE ` + cm2RoundFilter).Scan(&roundsRaw).Error; err != nil {
		middleware.JSONError(w, "erreur récupération des compositions", http.StatusInternalServerError)
		return
	}
	var notatedRaw []cm2RoundRow
	if err := database.DB.Raw(`SELECT es.year, es.eval_number AS number, count(DISTINCT st.id) AS notated
FROM evaluation_sessions es
JOIN grades g ON g.session_id = es.id
JOIN students st ON st.id = g.student_id
JOIN classes c ON c.id = st.class_id AND c.active = TRUE AND UPPER(TRIM(c.name)) = 'CM2'
WHERE ` + cm2RoundFilter + `
GROUP BY es.year, es.eval_number`).Scan(&notatedRaw).Error; err != nil {
		middleware.JSONError(w, "erreur récupération des compositions", http.StatusInternalServerError)
		return
	}
	notMap := map[[2]int]int64{} // [year, number] → élèves notés
	for _, n := range notatedRaw {
		notMap[[2]int{n.Year, n.Number}] = n.Notated
	}
	rounds := make([]cm2RoundRow, 0, len(roundsRaw))
	for _, rd := range roundsRaw {
		rounds = append(rounds, cm2RoundRow{Year: rd.Year, Number: rd.Number, Notated: notMap[[2]int{rd.Year, rd.Number}]})
	}
	sort.Slice(rounds, func(i, j int) bool {
		if rounds[i].Year != rounds[j].Year {
			return rounds[i].Year > rounds[j].Year
		}
		return rounds[i].Number > rounds[j].Number
	})
	jsonResponse(w, http.StatusOK, map[string]interface{}{"rounds": rounds, "count": len(rounds)})
}

// cm2DBRow — ligne brute du fichier (élève CM2 + école + secteur).
type cm2DBRow struct {
	StudentID       string  `gorm:"column:student_id"`
	Matricule       *string `gorm:"column:matricule"`
	Nom             string  `gorm:"column:nom"`
	Prenoms         string  `gorm:"column:prenoms"`
	ClassName       string  `gorm:"column:class_name"`
	SchoolID        string  `gorm:"column:school_id"`
	SchoolName      string  `gorm:"column:school_name"`
	SchoolCode      string  `gorm:"column:school_code"`
	SecteurID       *string `gorm:"column:secteur_id"`
	SecteurName     *string `gorm:"column:secteur_name"`
	SecteurPosition *int    `gorm:"column:secteur_position"`
}

// cm2GradeRow — note CM2 du round (agrégation des sessions éligibles).
type cm2GradeRow struct {
	StudentID        string    `gorm:"column:student_id"`
	SubjectID        string    `gorm:"column:subject_id"`
	Value            float64   `gorm:"column:value"`
	Month            int       `gorm:"column:month"`
	SessionCreatedAt time.Time `gorm:"column:session_created_at"`
	UpdatedAt        time.Time `gorm:"column:updated_at"`
}

// cm2GradeNewer — b est-elle plus récente que a ? (mois de la session, puis
// création de la session, puis mise à jour de la note — la composition
// re-faite/remplie plus tard remplace l'ancienne).
func cm2GradeNewer(a, b cm2GradeRow) bool {
	if a.Month != b.Month {
		return b.Month > a.Month
	}
	if !b.SessionCreatedAt.Equal(a.SessionCreatedAt) {
		return b.SessionCreatedAt.After(a.SessionCreatedAt)
	}
	return b.UpdatedAt.After(a.UpdatedAt)
}

// cm2Student — élève du fichier (payload JSON de GET .../files/...).
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
	CanExport bool `json:"can_export"` // Super Admin : production de fichiers (politique anti-fuite)
}

// cm2TotalC1 — Total = Σ notes dès qu'au moins une est présente ; C1 =
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

// === Le fichier CM2 d'une composition — GET /api/cm2/files/{year}/{number} ===
// Tous les élèves de CM2 actifs du périmètre du rôle, groupés secteur →
// école, avec leurs notes DU MODULE ÉVALUATIONS pour la composition
// (année, N°). L'ordre SQL (position secteur, nom école, nom élève) est
// conservé tel quel.
func GetCm2File(w http.ResponseWriter, r *http.Request) {
	if !cm2ReadAllowed(r) {
		middleware.JSONError(w, "accès refusé : les fichiers CM2 sont réservés au personnel de l'IEP", http.StatusForbidden)
		return
	}
	year, errY := strconv.Atoi(chi.URLParam(r, "year"))
	number, errN := strconv.Atoi(chi.URLParam(r, "number"))
	if errY != nil || errN != nil || year < 2000 || year > 2100 || number < 1 || number > 20 {
		middleware.JSONError(w, "composition invalide (année 2000-2100, numéro 1-20)", http.StatusBadRequest)
		return
	}
	round := cm2RoundRef{Year: year, Number: number}

	// La composition doit exister dans le module Évaluations (source unique
	// des notes — pas de fichier fantôme sans session).
	var found int64
	database.DB.Raw(`SELECT count(*) FROM evaluation_sessions es
WHERE es.year = ? AND es.eval_number = ? AND `+cm2RoundFilter, year, number).Scan(&found)
	if found == 0 {
		middleware.JSONError(w, fmt.Sprintf("aucune composition N°%d pour l'année %d dans le module Évaluations", number, year), http.StatusNotFound)
		return
	}

	// Notes du round : toutes les notes CM2 des sessions éligibles, la plus
	// récente par matière gagne (cm2GradeNewer). Une seule requête, dédoublonnage
	// en mémoire (portable PostgreSQL/SQLite — pas de DISTINCT ON).
	var grades []cm2GradeRow
	if err := database.DB.Raw(`SELECT g.student_id, g.subject_id, g.value, es.month,
       es.created_at AS session_created_at, g.updated_at
FROM grades g
JOIN evaluation_sessions es ON es.id = g.session_id
JOIN students st ON st.id = g.student_id
JOIN classes c ON c.id = st.class_id AND c.active = TRUE AND UPPER(TRIM(c.name)) = 'CM2'
WHERE es.year = ? AND es.eval_number = ? AND `+cm2RoundFilter, year, number).Scan(&grades).Error; err != nil {
		middleware.JSONError(w, "erreur récupération des notes du module Évaluations", http.StatusInternalServerError)
		return
	}
	best := map[string]map[string]cm2GradeRow{} // student_id → subject_id → note retenue
	for _, g := range grades {
		m, ok := best[g.StudentID]
		if !ok {
			m = map[string]cm2GradeRow{}
			best[g.StudentID] = m
		}
		if cur, ok := m[g.SubjectID]; !ok || cm2GradeNewer(cur, g) {
			m[g.SubjectID] = g
		}
	}

	// Périmètre selon le rôle (mêmes règles que le module Notes / Task 78) :
	// admin+inspector = tout ; conseiller = écoles de son secteur ;
	// director = son école ; teacher = SES classes CM2 (titulaire ou cours
	// tenu — teacherClassCondition).
	role := ctxRole(r)
	scopeSQL := "1 = 1"
	var scopeArgs []interface{}
	switch role {
	case models.RoleAdmin, models.RoleInspector:
		// tout le périmètre IEP
	case models.RoleConseiller:
		scopeSQL = "sc.id IN ?"
		scopeArgs = append(scopeArgs, conseillerSectorSchoolIDs(r))
	case models.RoleDirector:
		scopeSQL = "sc.id = ?"
		scopeArgs = append(scopeArgs, ctxSchoolID(r))
	case models.RoleTeacher:
		cond, cargs := teacherClassCondition(ctxUserID(r))
		scopeSQL = "s.class_id IN (SELECT id FROM classes WHERE " + cond +
			" AND active = TRUE AND UPPER(TRIM(name)) = 'CM2')"
		scopeArgs = append(scopeArgs, cargs...)
	default:
		middleware.JSONError(w, "accès refusé : les fichiers CM2 sont réservés au personnel de l'IEP", http.StatusForbidden)
		return
	}

	query := `SELECT s.id AS student_id, s.matricule AS matricule,
       s.last_name AS nom, s.first_name AS prenoms,
       c.name AS class_name,
       sc.id AS school_id, sc.name AS school_name, sc.code AS school_code,
       sec.id AS secteur_id, sec.name AS secteur_name, sec.position AS secteur_position
FROM students s
JOIN classes c  ON c.id = s.class_id AND c.active = TRUE AND UPPER(TRIM(c.name)) = 'CM2'
JOIN schools sc ON sc.id = c.school_id
LEFT JOIN sectors sec ON sec.id = sc.sector_id
WHERE ` + scopeSQL + `
ORDER BY sec.position NULLS LAST, sec.name NULLS LAST, sc.name, s.last_name, s.first_name`
	var rows []cm2DBRow
	if err := database.DB.Raw(query, scopeArgs...).Scan(&rows).Error; err != nil {
		middleware.JSONError(w, "erreur récupération du fichier CM2", http.StatusInternalServerError)
		return
	}
	jsonResponse(w, http.StatusOK, cm2FileResponse(round, rows, best, role))
}

// cm2FileResponse — assemble la réponse du fichier (groupes + notes du
// module Évaluations + permissions).
func cm2FileResponse(round cm2RoundRef, rows []cm2DBRow, best map[string]map[string]cm2GradeRow, role string) map[string]interface{} {
	resolved := cm2ResolveSubjects()
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
		// Notes du module Évaluations (round courant) → les 4 colonnes.
		var notes [4]*float64
		if m, ok := best[row.StudentID]; ok {
			for i, skey := range cm2SubjectKeys {
				if subj, ok := resolved[skey]; ok {
					if gr, ok := m[subj.ID]; ok {
						v := gr.Value
						notes[i] = &v
					}
				}
			}
		}
		total, c1 := cm2TotalC1(notes[0], notes[1], notes[2], notes[3])
		sch.Students = append(sch.Students, cm2Student{
			StudentID:        row.StudentID,
			Matricule:        row.Matricule,
			Nom:              row.Nom,
			Prenoms:          row.Prenoms,
			ClassName:        row.ClassName,
			SchoolID:         row.SchoolID,
			SchoolName:       row.SchoolName,
			SchoolCode:       row.SchoolCode,
			NoteExploitation: notes[0],
			NoteEveil:        notes[1],
			NoteOrthographe:  notes[2],
			NoteMath:         notes[3],
			Total:            total,
			C1:               c1,
		})
		totalStudents++
	}

	perms := cm2Permissions{CanExport: role == models.RoleAdmin}
	return map[string]interface{}{
		"round":       round,
		"subjects":    cm2SubjectInfos(resolved),
		"c1_divisor":  cm2C1Divisor,
		"groups":      groups,
		"count":       totalStudents,
		"permissions": perms,
	}
}
