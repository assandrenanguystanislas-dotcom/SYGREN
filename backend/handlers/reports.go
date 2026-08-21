package handlers

import (
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"

	"sygren-api/database"
	"sygren-api/middleware"
	"sygren-api/models"
)

// === Relevé de Notes — Données JSON pour rendu HTML frontend ===
//
// Le relevé de notes est un document A4 portrait, multi-pages, généré POUR UNE
// CLASSE précise (contrairement à la synthèse qui couvre toute l'école).
//
// Il liste TOUS les élèves de la classe avec leurs notes brute par matière, le
// total, la moyenne et l'observation (A=Admis / R=Refusé).
//
// Structure (cf. cahier des charges + image de référence "Releve_de_Notes.png") :
//   - Page 1 : en-tête institutionnel (Ministère + IEP + École + Écusson CI)
//              + tableau des élèves (40 élèves max sur la 1ère page)
//   - Pages 2..N : tableau suite (45 élèves max par page) + en-tête réduit
//   - Dernière page : bloc statistiques (Inscrits/Présents/Admis G/F/T + %)
//                     + signatures (Directeur + Inspecteur)
//
// Approche A — on charge la session (qui couvre toute l'école), on calcule les
// résultats via computeSessionResults, puis on FILTRE par class_id pour ne garder
// que les élèves de la classe demandée. La classe est identifiée par son ID.
//
// RBAC :
//   - admin : toutes les classes
//   - director : uniquement les classes de son école (la session porte le school_id)
//   - inspector : uniquement les classes des écoles de son IEP
//   - teacher : uniquement les classes de son école (RBAC implicite via la session)

// ReleveSubjectGrade — note d'un élève dans une matière pour le relevé
type ReleveSubjectGrade struct {
	SubjectName string  `json:"subject_name"`
	Value       float64 `json:"value"`     // note brute (ex: 18.5/20, 44/50)
	MaxScore    int     `json:"max_score"` // barème de la matière pour le niveau
	HasGrade    bool    `json:"has_grade"` // false si aucune note saisie
}

// ReleveStudent — un élève du relevé avec ses notes par matière
type ReleveStudent struct {
	Num          int                  `json:"num"` // numéro d'ordre (1-based) dans la classe
	Matricule    string               `json:"matricule"`
	LastName     string               `json:"last_name"`
	FirstName    string               `json:"first_name"`
	Gender       string               `json:"gender"` // "M" ou "F" (F → rouge côté frontend)
	Grades       []ReleveSubjectGrade `json:"grades"`
	Total        float64              `json:"total"`         // somme des notes brutes
	Average      float64              `json:"average"`       // moyenne sur l'échelle du niveau
	AverageScale int                  `json:"average_scale"` // 10 (CP/CE) ou 20 (CM)
	HasAverage   bool                 `json:"has_average"`
	Observation  string               `json:"observation"` // "A" (Admis) ou "R" (Refusé)
}

// ReleveStats — statistiques Inscrits/Présents/Admis par genre
type ReleveStats struct {
	InscritsG int     `json:"inscrits_g"`
	InscritsF int     `json:"inscrits_f"`
	InscritsT int     `json:"inscrits_t"`
	PresentsG int     `json:"presents_g"`
	PresentsF int     `json:"presents_f"`
	PresentsT int     `json:"presents_t"`
	AdmisG    int     `json:"admis_g"`
	AdmisF    int     `json:"admis_f"`
	AdmisT    int     `json:"admis_t"`
	PctG      float64 `json:"pct_g"`
	PctF      float64 `json:"pct_f"`
	PctT      float64 `json:"pct_t"`
}

// ReleveData — données complètes pour le document de relevé de notes
type ReleveData struct {
	// === En-tête institutionnel ===
	IEPName   string `json:"iep_name"`
	IEPRegion string `json:"iep_region"`
	IEPBP     string `json:"iep_bp"`
	// Inspecteur titulaire de l'IEP (signatures + en-tête)
	InspectorName  string `json:"inspector_name"`
	InspectorEmail string `json:"inspector_email"`
	InspectorPhone string `json:"inspector_phone"`
	// École + classe
	SchoolName string `json:"school_name"`
	SchoolCode string `json:"school_code"`
	SchoolAddr string `json:"school_addr"`
	ClassName  string `json:"class_name"`
	ClassLevel string `json:"class_level"` // "CP" | "CE" | "CM"
	// Directeur de l'école (signatures)
	DirectorName string `json:"director_name"`
	// Évaluation (session)
	EvalLabel  string `json:"eval_label"` // "Composition" ou "Examen Blanc"
	EvalNumber int    `json:"eval_number"`
	EvalType   string `json:"eval_type"` // "composition" | "exam_blanc"
	Month      int    `json:"month"`
	Year       int    `json:"year"`
	// Date formatée lisible (ex: "28/04/2026") pour l'en-tête
	Date string `json:"date"`
	// Titre + type d'examen (pré-calculés pour le frontend)
	Title      string `json:"title"`       // "RELEVE DE NOTES CM2"
	TypeExamen string `json:"type_examen"` // "COMPOSITION N°1"
	// Totaux G/F/T (inscrits) — affichés dans l'en-tête à droite
	TotalG int `json:"total_g"`
	TotalF int `json:"total_f"`
	TotalT int `json:"total_t"`
	// Élèves + matières + stats
	Students []ReleveStudent `json:"students"`
	Stats    ReleveStats     `json:"stats"`
}

// GetReleveData returns JSON data for the "Relevé de Notes" document (one class).
//
// Paramètres :
//   - session_id (requis) : ID de la session
//   - class_id   (requis) : ID de la classe à filtrer
//
// La session couvre toute l'école (Approche A) — on calcule tous les résultats
// puis on filtre par class_id pour ne garder que les élèves de la classe.
func GetReleveData(w http.ResponseWriter, r *http.Request) {
	sessionID := r.URL.Query().Get("session_id")
	classID := r.URL.Query().Get("class_id")
	if sessionID == "" || classID == "" {
		middleware.JSONError(w, "session_id et class_id sont requis", http.StatusBadRequest)
		return
	}

	// 1. Charger la session + vérifier RBAC
	session, err := getSessionForUser(r, sessionID)
	if err != nil {
		middleware.JSONError(w, err.Error(), http.StatusForbidden)
		return
	}

	// 2. Charger l'école + l'IEP
	var school models.School
	if err := database.DB.First(&school, "id = ?", session.SchoolID).Error; err != nil {
		middleware.JSONError(w, "école introuvable", http.StatusNotFound)
		return
	}
	var iep models.IEP
	_ = database.DB.First(&iep, "id = ?", school.IEPID).Error

	// 3. Charger la classe (vérifier qu'elle appartient à l'école de la session)
	var class models.Class
	if err := database.DB.First(&class, "id = ?", classID).Error; err != nil {
		middleware.JSONError(w, "classe introuvable", http.StatusNotFound)
		return
	}
	if class.SchoolID != school.ID {
		middleware.JSONError(w, "la classe n'appartient pas à l'école de la session", http.StatusBadRequest)
		return
	}

	// 4. Calculer les résultats complets de la session (couvre toute l'école),
	// puis filtrer par class_id.
	results, err := computeSessionResults(session.ID)
	if err != nil {
		middleware.JSONError(w, "erreur calcul des résultats : "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Filtrer par class_id et trier par rang (déjà trié par classe+average DESC
	// côté computeSessionResults — on garde l'ordre tel quel).
	filtered := make([]StudentResult, 0, len(results.Results))
	for _, r := range results.Results {
		if r.ClassID == classID {
			filtered = append(filtered, r)
		}
	}

	// 5. Charger les élèves de la classe pour compter les inscrits par genre
	// (utile même si l'élève n'a aucune note saisie).
	var students []models.Student
	if err := database.DB.Where("class_id = ?", classID).
		Order("last_name ASC, first_name ASC").Find(&students).Error; err != nil {
		middleware.JSONError(w, "erreur récupération élèves", http.StatusInternalServerError)
		return
	}

	// Indexer les résultats par student_id pour lookup rapide.
	resultByStudentID := make(map[string]StudentResult, len(filtered))
	for _, r := range filtered {
		resultByStudentID[r.StudentID] = r
	}

	// 6. Seuil de réussite (configurable dans Settings — défaut 10/20).
	// Converti proportionnellement selon l'échelle du niveau :
	//   CP/CE (/10) → seuil / 2 ; CM (/20) → seuil inchangé.
	_, passThreshold, _ := GetSystemSettings()
	scale := averageScaleForLevel(class.Level)
	effectiveThreshold := passThreshold * scale / 20.0

	// 7. Construire la liste des élèves du relevé.
	// Ordre initial : alphabétique (last_name, first_name ASC) garanti par la
	// requête DB ci-dessus. Le tri final (mérite vs alphabétique) est appliqué
	// à l'étape 7b selon le niveau de la classe (règle du cahier des charges).
	releveStudents := make([]ReleveStudent, 0, len(students))
	for i, st := range students {
		rs := ReleveStudent{
			Num:          i + 1,
			Matricule:    matriculeOrNA(st.Matricule),
			LastName:     st.LastName,
			FirstName:    st.FirstName,
			Gender:       st.Gender,
			AverageScale: int(scale),
			Grades:       []ReleveSubjectGrade{},
		}
		if res, ok := resultByStudentID[st.ID]; ok {
			// Construire les notes par matière (on garde l'ordre du backend).
			total := 0.0
			for _, sg := range res.SubjectGrades {
				rg := ReleveSubjectGrade{
					SubjectName: sg.SubjectName,
					MaxScore:    sg.MaxScore,
					HasGrade:    sg.HasGrade,
					Value:       0,
				}
				if sg.HasGrade {
					rg.Value = sg.Grade
					total += sg.Grade
				}
				rs.Grades = append(rs.Grades, rg)
			}
			rs.Total = total
			rs.Average = res.Average
			rs.HasAverage = res.HasAverage
			// Observation : A=Admis, R=Refusé
			if res.HasAverage && res.Average >= effectiveThreshold {
				rs.Observation = "A"
			} else {
				rs.Observation = "R"
			}
		} else {
			// Élève sans aucune note → Refusé par défaut
			rs.Observation = "R"
		}
		releveStudents = append(releveStudents, rs)
	}

	// 7b. Trier les élèves selon le niveau de la classe (cahier des charges).
	//   - CP1 → CM1 : classement par ordre de mérite (moyenne décroissante).
	//     Les élèves sans note (HasAverage=false) sont repoussés en fin de liste.
	//     Ex-aequo : départagé par ordre alphabétique (last_name, first_name).
	//   - CM2      : ordre alphabétique (déjà garanti par la requête DB Order ASC).
	// Après le tri, on re-numérote (Num = rang : 1 = meilleur pour le mérite,
	// 1 = premier alphabétique pour CM2).
	normalizedName := strings.ToUpper(strings.TrimSpace(class.Name))
	if normalizedName != "CM2" {
		sort.SliceStable(releveStudents, func(i, j int) bool {
			a, b := releveStudents[i], releveStudents[j]
			// 1) Élèves avec moyenne (HasAverage=true) AVANT élèves sans note.
			if a.HasAverage != b.HasAverage {
				return a.HasAverage
			}
			// 2) Moyenne décroissante (les deux ont une moyenne).
			if a.HasAverage && b.HasAverage && a.Average != b.Average {
				return a.Average > b.Average
			}
			// 3) Ex-aequo (ou les deux sans note) : ordre alphabétique.
			if a.LastName != b.LastName {
				return a.LastName < b.LastName
			}
			return a.FirstName < b.FirstName
		})
		// Re-numéroter selon le nouvel ordre (Num = rang dans la classe).
		for i := range releveStudents {
			releveStudents[i].Num = i + 1
		}
	}

	// 8. Calculer les statistiques (Inscrits/Présents/Admis G/F/T)
	stats := ReleveStats{}
	// Inscrits : tous les élèves de la classe
	for _, st := range students {
		if st.Gender == "M" {
			stats.InscritsG++
		} else {
			stats.InscritsF++
		}
	}
	stats.InscritsT = stats.InscritsG + stats.InscritsF

	// Présents + Admis : à partir des résultats calculés (un élève "présent" a
	// au moins une note saisie → HasAverage=true).
	for _, r := range filtered {
		var st models.Student
		_ = database.DB.First(&st, "id = ?", r.StudentID).Error
		if !r.HasAverage {
			continue
		}
		if st.Gender == "M" {
			stats.PresentsG++
		} else {
			stats.PresentsF++
		}
		if r.Average >= effectiveThreshold {
			if st.Gender == "M" {
				stats.AdmisG++
			} else {
				stats.AdmisF++
			}
		}
	}
	stats.PresentsT = stats.PresentsG + stats.PresentsF
	stats.AdmisT = stats.AdmisG + stats.AdmisF

	if stats.PresentsG > 0 {
		stats.PctG = float64(stats.AdmisG) / float64(stats.PresentsG) * 100
	}
	if stats.PresentsF > 0 {
		stats.PctF = float64(stats.AdmisF) / float64(stats.PresentsF) * 100
	}
	if stats.PresentsT > 0 {
		stats.PctT = float64(stats.AdmisT) / float64(stats.PresentsT) * 100
	}

	// 9. Déterminer les labels d'évaluation
	evalLabel := "Composition"
	if session.EvalType == "exam_blanc" {
		evalLabel = "Examen Blanc"
	}

	// 10. Récupérer le nom du directeur de l'école (User role=director, school_id)
	var director models.User
	directorName := ""
	if err := database.DB.First(&director, "role = ? AND school_id = ?", models.RoleDirector, school.ID).Error; err == nil {
		directorName = director.FullName
	}

	// 11. Date formatée (jj/mm/aaaa) — utilise la date du jour côté serveur
	// pour le document final. Le frontend peut la surcharger si besoin.
	now := time.Now()
	dateStr := fmt.Sprintf("%02d/%02d/%04d", now.Day(), int(now.Month()), now.Year())

	// Titre + type d'examen (pré-calculés)
	title := "RELEVE DE NOTES " + strings.ToUpper(class.Name)
	typeExamen := fmt.Sprintf("%s N°%d", strings.ToUpper(evalLabel), session.EvalNumber)

	data := ReleveData{
		IEPName:        iep.Name,
		IEPRegion:      iep.Region,
		IEPBP:          iep.BP,
		InspectorName:  iep.InspectorName,
		InspectorEmail: iep.InspectorEmail,
		InspectorPhone: iep.InspectorPhone,
		SchoolName:     school.Name,
		SchoolCode:     school.Code,
		SchoolAddr:     school.Address,
		ClassName:      class.Name,
		ClassLevel:     class.Level,
		DirectorName:   directorName,
		EvalLabel:      evalLabel,
		EvalNumber:     session.EvalNumber,
		EvalType:       session.EvalType,
		Month:          session.Month,
		Year:           session.Year,
		Date:           dateStr,
		Title:          title,
		TypeExamen:     typeExamen,
		TotalG:         stats.InscritsG,
		TotalF:         stats.InscritsF,
		TotalT:         stats.InscritsT,
		Students:       releveStudents,
		Stats:          stats,
	}

	jsonResponse(w, http.StatusOK, data)
}
