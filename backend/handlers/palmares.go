package handlers

// === Palmarès — TOP 10 des meilleurs élèves par niveau (CP1..CM2),
// sexe par sexe (1 tableau FILLES + 1 tableau GARÇONS), après chaque
// COMPOSITION et EXAMEN BLANC (Task 70) ===
//
// Principe : les moyennes PRÉCALCULÉES de student_session_results
// (recomputeStudentSessionResult — Fix E) sont agrégées sur TOUTES les
// sessions terminées d'un même événement d'évaluation
// (eval_type + eval_number + year — 1 session = 1 école), puis
// classées PAR NIVEAU FIN (nom de la classe : CP1, CP2, ..., CM2) et
// PAR SEXE, toutes écoles confondues du périmètre de l'utilisateur :
//   - admin / inspector  : toute la DREN (toutes les écoles)
//   - conseiller         : les écoles de SON secteur (users.sector_id)
//   - director / teacher : SON école
//
// Barèmes : les moyennes sont normalisées par niveau à la source
// (CP1..CE2 → /10, CM1/CM2 → /20 — average_scale) : le classement
// compare donc des élèves au MÊME barème dans chaque niveau.
//
// Rangs PARTAGÉS en cas d'égalité de moyenne (convention des
// classements officiels : 1, 2, 2, 4...) ; seuls les rangs <= 10 sont
// retenus — les ex-æquo de la 10e place sont donc inclus.
// Départage à moyenne égale : ordre alphabétique (déterministe).
//
// EPS : déjà gérée en amont (exam_blanc CM2 uniquement) par le calcul
// des moyennes — ce palmarès ne fait que lire student_session_results.
//
// RBAC : lecture pour tous les rôles authentifiés (même convention que
// /api/computation/session/{id} — « Read-only for all authed, RBAC par
// périmètre dans le handler ») ; default-deny conservé (le rôle PARENT
// passe par le portail dédié et n'accède pas à ces routes).

import (
	"fmt"
	"math"
	"net/http"
	"sort"
	"strconv"
	"strings"

	"sygren-api/database"
	"sygren-api/middleware"
	"sygren-api/models"

	"gorm.io/gorm"
)

// palmaresEntry — une ligne du palmarès (colonnes demandées :
// MATRICULE ; ECOLE ; SECTEUR ; NOM ET PRENOMS ; MOYENNE ; RANG).
type palmaresEntry struct {
	Rank         int     `json:"rank"`
	Matricule    string  `json:"matricule"`
	School       string  `json:"school"`
	Sector       string  `json:"sector"`
	FullName     string  `json:"full_name"` // NOM + prénoms (convention de l'appli)
	Average      float64 `json:"average"`
	AverageScale int     `json:"average_scale"` // 10 (CP1..CE2) ou 20 (CM1/CM2)
}

// palmaresLevel — les deux tableaux d'un niveau (FILLES / GARÇONS).
type palmaresLevel struct {
	Level   string          `json:"level"`
	Filles  []palmaresEntry `json:"filles"`
	Garcons []palmaresEntry `json:"garcons"`
}

// palmaresEvent — un événement d'évaluation classable
// (type + numéro + année ; 1 ligne = N sessions, 1 par école).
type palmaresEvent struct {
	EvalType   string `json:"eval_type"`
	EvalNumber int    `json:"eval_number"`
	Year       int    `json:"year"`
	Schools    int64  `json:"schools"`
}

// palmaresEventInfo — événement du palmarès renvoyé.
type palmaresEventInfo struct {
	EvalType   string `json:"eval_type"`
	EvalNumber int    `json:"eval_number"`
	Year       int    `json:"year"`
	Schools    int    `json:"schools"`
	Students   int    `json:"students"` // élèves classés (avec moyenne) avant top 10
}

// palmaresStatuses — sessions terminées uniquement : une évaluation ne
// produit un palmarès qu'une fois clôturée (closed), validée
// (validated) ou archivée (archived) — jamais draft/open/cancelled.
var palmaresStatuses = []string{"closed", "validated", "archived"}

// palmaresScope — périmètre SQL des sessions visibles par l'utilisateur
// (même scoping que ListSessions : JOIN schools + filtre par rôle).
// Renvoie (query, false) si un périmètre s'applique ; (nil, true) si le
// périmètre est VIDE (conseiller sans secteur, directeur sans école) —
// le handler répond alors une liste vide, sans erreur.
func palmaresScope(r *http.Request) (*gorm.DB, bool) {
	role := ctxRole(r)
	q := database.DB.Model(&models.EvaluationSession{}).
		Joins("JOIN schools ON schools.id = evaluation_sessions.school_id").
		Where("evaluation_sessions.status IN ?", palmaresStatuses)
	switch role {
	case "director", "teacher":
		schoolID := ctxSchoolID(r)
		if schoolID == "" {
			return nil, true
		}
		q = q.Where("evaluation_sessions.school_id = ?", schoolID)
	case models.RoleConseiller:
		// v6 (session 34) — le conseiller consulte les écoles de SON
		// secteur (schools.sector_id). Aucun secteur → périmètre vide.
		sectorID := conseillerSectorID(r)
		if sectorID == "" {
			return nil, true
		}
		q = q.Where("schools.sector_id = ?", sectorID)
	}
	// admin / inspector : toute la DREN (aucun filtre supplémentaire —
	// même convention que ListSessions).
	return q, false
}

// ListPalmaresEvents — GET /api/computation/palmares/events
// Liste des événements d'évaluation classables du périmètre de
// l'utilisateur : évaluations avec au moins une session terminée,
// groupées par (eval_type, eval_number, year), avec le nombre d'écoles
// participantes. Tri : année DESC, type (composition, exam_blanc,
// autres), numéro ASC.
func ListPalmaresEvents(w http.ResponseWriter, r *http.Request) {
	q, empty := palmaresScope(r)
	events := []palmaresEvent{}
	if !empty {
		if err := q.
			Select("evaluation_sessions.eval_type, evaluation_sessions.eval_number, evaluation_sessions.year, COUNT(DISTINCT evaluation_sessions.school_id) AS schools").
			Group("evaluation_sessions.eval_type, evaluation_sessions.eval_number, evaluation_sessions.year").
			Order("evaluation_sessions.year DESC, " +
				"CASE evaluation_sessions.eval_type WHEN 'composition' THEN 0 WHEN 'exam_blanc' THEN 1 ELSE 2 END, " +
				"evaluation_sessions.eval_number ASC").
			Scan(&events).Error; err != nil {
			middleware.JSONError(w, "erreur de lecture des évaluations", http.StatusInternalServerError)
			return
		}
	}
	jsonResponse(w, http.StatusOK, map[string]interface{}{"events": events, "count": len(events)})
}

// GetPalmares — GET /api/computation/palmares?eval_type=&eval_number=&year=
// Top 10 PAR NIVEAU et PAR SEXE de l'événement demandé, à partir des
// moyennes précalculées de toutes les sessions terminées de
// l'événement (toutes écoles du périmètre confondues).
func GetPalmares(w http.ResponseWriter, r *http.Request) {
	evalType := r.URL.Query().Get("eval_type")
	evalNumber, errNum := strconv.Atoi(r.URL.Query().Get("eval_number"))
	year, errYear := strconv.Atoi(r.URL.Query().Get("year"))
	if evalType == "" || errNum != nil || errYear != nil || evalNumber <= 0 || year <= 0 {
		middleware.JSONError(w, "paramètres eval_type, eval_number et year requis", http.StatusBadRequest)
		return
	}

	q, empty := palmaresScope(r)
	sessions := []models.EvaluationSession{}
	if !empty {
		if err := q.Where(
			"evaluation_sessions.eval_type = ? AND evaluation_sessions.eval_number = ? AND evaluation_sessions.year = ?",
			evalType, evalNumber, year,
		).Find(&sessions).Error; err != nil {
			middleware.JSONError(w, "erreur de lecture des sessions", http.StatusInternalServerError)
			return
		}
	}
	if empty || len(sessions) == 0 {
		jsonResponse(w, http.StatusOK, map[string]interface{}{
			"event":   nil,
			"levels":  []interface{}{},
			"message": "Aucune session terminée (clôturée, validée ou archivée) pour cette évaluation dans votre périmètre.",
		})
		return
	}

	sessionIDs := make([]string, 0, len(sessions))
	for _, s := range sessions {
		sessionIDs = append(sessionIDs, s.ID)
	}

	// 1) Moyennes précalculées de toutes les sessions de l'événement.
	var results []models.StudentSessionResult
	if err := database.DB.Where("session_id IN ? AND has_average = ?", sessionIDs, true).
		Find(&results).Error; err != nil {
		middleware.JSONError(w, "erreur de lecture des résultats", http.StatusInternalServerError)
		return
	}

	// 2) Index élèves / classes / écoles / secteurs (4 requêtes, pas de N+1).
	studentIDSet := map[string]bool{}
	classIDSet := map[string]bool{}
	for _, res := range results {
		studentIDSet[res.StudentID] = true
		if res.ClassID != "" {
			classIDSet[res.ClassID] = true
		}
	}
	studentsMap := map[string]models.Student{}
	if len(studentIDSet) > 0 {
		ids := make([]string, 0, len(studentIDSet))
		for id := range studentIDSet {
			ids = append(ids, id)
		}
		var students []models.Student
		database.DB.Where("id IN ?", ids).Find(&students)
		for _, st := range students {
			studentsMap[st.ID] = st
		}
	}
	classMap := map[string]models.Class{}
	if len(classIDSet) > 0 {
		ids := make([]string, 0, len(classIDSet))
		for id := range classIDSet {
			ids = append(ids, id)
		}
		var classes []models.Class
		database.DB.Where("id IN ?", ids).Find(&classes)
		for _, c := range classes {
			classMap[c.ID] = c
		}
	}
	schoolMap := map[string]models.School{}
	schoolIDSet := map[string]bool{}
	for _, s := range sessions {
		schoolIDSet[s.SchoolID] = true
	}
	if len(schoolIDSet) > 0 {
		ids := make([]string, 0, len(schoolIDSet))
		for id := range schoolIDSet {
			ids = append(ids, id)
		}
		var schools []models.School
		database.DB.Where("id IN ?", ids).Find(&schools)
		for _, s := range schools {
			schoolMap[s.ID] = s
		}
	}
	sectorIDSet := map[string]bool{}
	for _, s := range schoolMap {
		if s.SectorID != nil && *s.SectorID != "" {
			sectorIDSet[*s.SectorID] = true
		}
	}
	sectorMap := map[string]string{}
	if len(sectorIDSet) > 0 {
		ids := make([]string, 0, len(sectorIDSet))
		for id := range sectorIDSet {
			ids = append(ids, id)
		}
		var sectors []models.Sector
		database.DB.Where("id IN ?", ids).Find(&sectors)
		for _, sec := range sectors {
			sectorMap[sec.ID] = sec.Name
		}
	}

	// 3) Meilleure moyenne par élève (un élève ne peut être classé
	//    qu'une fois — anomalies de données : sessions dupliquées du
	//    même événement pour la même école).
	type bestRec struct {
		avg     float64
		scale   int
		classID string
	}
	best := map[string]bestRec{}
	for _, res := range results {
		if cur, ok := best[res.StudentID]; !ok || res.Average > cur.avg {
			best[res.StudentID] = bestRec{avg: res.Average, scale: res.AverageScale, classID: res.ClassID}
		}
	}

	// 4) Groupement (niveau fin = nom de classe, sexe F/M).
	filles := map[string][]palmaresEntry{}
	garcons := map[string][]palmaresEntry{}
	levelSet := map[string]bool{}
	for studentID, rec := range best {
		st, ok := studentsMap[studentID]
		if !ok {
			continue
		}
		cls, ok := classMap[rec.classID]
		if !ok {
			continue
		}
		// Niveau fin = NOM de la classe (CP1..CM2) — class_level ne
		// porte que le cycle (CP/CE/CM, ancien format).
		level := strings.TrimSpace(cls.Name)
		if level == "" {
			level = strings.TrimSpace(cls.Level)
		}
		if level == "" {
			continue
		}
		gender := strings.ToUpper(strings.TrimSpace(st.Gender))
		school := schoolMap[cls.SchoolID]
		sector := ""
		if school.SectorID != nil {
			sector = sectorMap[*school.SectorID]
		}
		entry := palmaresEntry{
			Matricule:    matriculeOrNA(st.Matricule),
			School:       school.Name,
			Sector:       sector,
			FullName:     fmt.Sprintf("%s %s", st.LastName, st.FirstName),
			Average:      math.Round(rec.avg*100) / 100,
			AverageScale: rec.scale,
		}
		levelSet[level] = true
		switch gender {
		case "F":
			filles[level] = append(filles[level], entry)
		case "M":
			garcons[level] = append(garcons[level], entry)
		}
	}

	// 5) Classement par groupe : moyenne DESC (départage alphabétique
	//    déterministe), RANGS PARTAGÉS (1, 2, 2, 4...), top 10 — les
	//    ex-æquo de la 10e place sont retenus.
	rankGroup := func(entries []palmaresEntry) []palmaresEntry {
		sort.SliceStable(entries, func(i, j int) bool {
			if entries[i].Average != entries[j].Average {
				return entries[i].Average > entries[j].Average
			}
			return entries[i].FullName < entries[j].FullName
		})
		out := make([]palmaresEntry, 0, len(entries))
		rank, prev := 0, -1.0
		for i, e := range entries {
			if i == 0 || e.Average != prev {
				rank = i + 1
				prev = e.Average
			}
			if rank > 10 {
				break
			}
			e.Rank = rank
			out = append(out, e)
		}
		return out
	}

	// 6) Niveaux dans l'ordre scolaire naturel (CP1..CM2 — même ordre
	//    que le relevé de notes), niveaux personnalisés éventuels
	//    appended en ordre alphabétique.
	levels := make([]palmaresLevel, 0, len(levelSet))
	seen := map[string]bool{}
	appendLevel := func(lv string) {
		levels = append(levels, palmaresLevel{
			Level:   lv,
			Filles:  rankGroup(filles[lv]),
			Garcons: rankGroup(garcons[lv]),
		})
		seen[lv] = true
	}
	for _, lv := range []string{"CP1", "CP2", "CE1", "CE2", "CM1", "CM2"} {
		if levelSet[lv] {
			appendLevel(lv)
		}
	}
	extra := make([]string, 0, len(levelSet))
	for lv := range levelSet {
		if !seen[lv] {
			extra = append(extra, lv)
		}
	}
	sort.Strings(extra)
	for _, lv := range extra {
		appendLevel(lv)
	}

	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"event": palmaresEventInfo{
			EvalType:   evalType,
			EvalNumber: evalNumber,
			Year:       year,
			Schools:    len(schoolIDSet),
			Students:   len(best),
		},
		"levels": levels,
	})
}
