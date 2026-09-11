package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"sygren-api/database"
	"sygren-api/middleware"
	"sygren-api/models"
	"sygren-api/rbac"

	"github.com/go-chi/chi/v5"
)

// === Students — Gestion des élèves ===
// Le matricule est fourni par le Ministère de l'Éducation (optionnel).
// Si non fourni à la saisie → NULL en base + affichage "N/A" côté frontend.
//
// Accès :
//   - admin : tous les élèves
//   - inspector : élèves des écoles de son IEP
//   - director : élèves de son école
//   - teacher : élèves de sa classe

// StudentWithClass — élève enrichi
type StudentWithClass struct {
	models.Student
	ClassName  string `json:"class_name,omitempty"`
	SchoolName string `json:"school_name,omitempty"`
}

// ListStudents returns students filtered by scope.
func ListStudents(w http.ResponseWriter, r *http.Request) {
	role := ctxRole(r)
	classFilter := r.URL.Query().Get("class_id")
	query := database.DB.Model(&models.Student{}).
		Joins("JOIN classes ON classes.id = students.class_id")

	switch role {
	case "director":
		schoolID := ctxSchoolID(r)
		if schoolID == "" {
			jsonResponse(w, http.StatusOK, map[string]interface{}{"students": []interface{}{}, "count": 0})
			return
		}
		query = query.Where("classes.school_id = ?", schoolID)
	case "teacher":
		userID := ctxUserID(r)
		query = query.Where("classes.teacher_id = ?", userID)
	}

	if classFilter != "" {
		query = query.Where("students.class_id = ?", classFilter)
	}

	// Filtre optionnel par school_id (admin sélectionne une école spécifique
	// dans le dropdown — sans ce filtre, l'admin verrait les élèves de TOUTES
	// les écoles, même après avoir choisi une école).
	if schoolID := r.URL.Query().Get("school_id"); schoolID != "" {
		query = query.Where("classes.school_id = ?", schoolID)
	}

	var students []models.Student
	if err := query.Order("last_name ASC, first_name ASC").Find(&students).Error; err != nil {
		middleware.JSONError(w, "erreur récupération élèves", http.StatusInternalServerError)
		return
	}

	result := make([]StudentWithClass, 0, len(students))
	for _, s := range students {
		var d StudentWithClass
		d.Student = s
		// Nom de la classe
		var cls models.Class
		if err := database.DB.First(&cls, "id = ?", s.ClassID).Error; err == nil {
			d.ClassName = cls.Name
			// Nom de l'école
			var school models.School
			if err := database.DB.First(&school, "id = ?", cls.SchoolID).Error; err == nil {
				d.SchoolName = school.Name
			}
		}
		result = append(result, d)
	}

	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"students": result,
		"count":    len(result),
	})
}

// GetClassCandidates — payload du document officiel « LISTE ALPHABETIQUE
// DES CANDIDATS AU CEPE SESSION {année} » (module Élèves — document reçu
// de l'utilisateur, image ELEVES IA_1/IA_2) : classe, école (avec code
// ministériel et centre d'examen de rattachement), IEP (en-tête
// officiel), directeur, année scolaire et la liste ordonnée (nom,
// prénoms) des élèves de la classe.
//
// RBAC par périmètre (même modèle que ListStudents — classe → école) :
//   - admin / inspector : toutes les classes ;
//   - director : classes de SON école ;
//   - teacher : SA classe (teacher_id de la classe) ;
//   - parent : refusé (portail dédié).
func GetClassCandidates(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		middleware.JSONError(w, "id classe requis", http.StatusBadRequest)
		return
	}

	var cls models.Class
	if err := database.DB.First(&cls, "id = ?", id).Error; err != nil {
		middleware.JSONError(w, "classe introuvable", http.StatusNotFound)
		return
	}
	var school models.School
	if err := database.DB.First(&school, "id = ?", cls.SchoolID).Error; err != nil {
		middleware.JSONError(w, "école introuvable", http.StatusNotFound)
		return
	}

	switch ctxRole(r) {
	case "admin", "inspector":
		// accès total
	case "director":
		if ctxSchoolID(r) != school.ID {
			middleware.JSONError(w, "accès refusé : classe hors de votre école", http.StatusForbidden)
			return
		}
	case "teacher":
		if cls.TeacherID == nil || *cls.TeacherID != ctxUserID(r) {
			middleware.JSONError(w, "accès refusé : classe qui n'est pas la vôtre", http.StatusForbidden)
			return
		}
	case models.RoleConseiller:
		// v6 (session 34) — consultation : école du secteur du conseiller.
		sectorID := conseillerSectorID(r)
		if sectorID == "" || school.SectorID == nil || *school.SectorID != sectorID {
			middleware.JSONError(w, "accès refusé : classe hors de votre secteur", http.StatusForbidden)
			return
		}
	default:
		middleware.JSONError(w, "accès refusé", http.StatusForbidden)
		return
	}

	var iep models.IEP
	database.DB.First(&iep, "id = ?", school.IEPID)

	// Centre d'examen de rattachement de l'école (demande utilisateur :
	// « se référer au module écoles, centres d'examens ») — nom affiché
	// sous le CODE dans l'en-tête du document. Vide si l'école n'est
	// pas encore affectée à un centre (la ligne reste à compléter à
	// la main sur le document papier).
	examCenterName := ""
	if school.ExamCenterID != nil && *school.ExamCenterID != "" {
		var center models.ExamCenter
		if err := database.DB.Select("name").
			First(&center, "id = ?", *school.ExamCenterID).Error; err == nil {
			examCenterName = center.Name
		}
	}

	// Nom du directeur de l'école (signature « Le Directeur » du document —
	// premier directeur actif, même convention que les autres documents
	// officiels).
	directeurName := ""
	var dir models.User
	if err := database.DB.Select("full_name").
		Where("school_id = ? AND role = ? AND active = ?", school.ID, models.RoleDirector, true).
		Order("created_at ASC").First(&dir).Error; err == nil {
		directeurName = dir.FullName
	}

	// Année scolaire « 2026 2027 » (rentrée août/septembre → juillet) —
	// même convention que les autres documents officiels.
	now := time.Now()
	start := now.Year()
	if now.Month() < time.August {
		start--
	}

	var students []models.Student
	if err := database.DB.Where("class_id = ?", cls.ID).
		Order("last_name ASC, first_name ASC").Find(&students).Error; err != nil {
		middleware.JSONError(w, "erreur récupération élèves", http.StatusInternalServerError)
		return
	}
	rows := make([]StudentWithClass, 0, len(students))
	for _, s := range students {
		rows = append(rows, StudentWithClass{Student: s, ClassName: cls.Name, SchoolName: school.Name})
	}

	jsonResponse(w, http.StatusOK, map[string]interface{}{
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
			"name":            iep.Name,
			"region":          iep.Region,
			"bp":              iep.BP,
			"inspector_phone": iep.InspectorPhone,
			"inspector_email": iep.InspectorEmail,
		},
		"directeur":      directeurName,
		"exam_center":    examCenterName,
		"annee_scolaire": fmt.Sprintf("%d %d", start, start+1),
		"students":       rows,
		"count":          len(rows),
	})
}

// CreateStudentRequest — payload pour créer un élève
type CreateStudentRequest struct {
	Matricule *string `json:"matricule,omitempty"` // fourni par le Ministère de l'Éducation (optionnel)
	ClassID   string  `json:"class_id"`
	FirstName string  `json:"first_name"`
	LastName  string  `json:"last_name"`
	Gender    string  `json:"gender"`               // M / F
	BirthYear *int    `json:"birth_year,omitempty"` // année de naissance seule, ex: 2006 (optionnel)
	BirthDate *string `json:"birth_date,omitempty"` // ISO 8601 (dormant — pas d'UI)
	// === Identité civile étendue (demande utilisateur) ===
	// Jour/mois complètent l'année ; textes trimés ("" → NULL).
	// Sémantique : création 0/absent/"" = non renseigné ; mise à jour
	// nil = inchangé, 0/"" = effacer (NULL).
	BirthDay    *int    `json:"birth_day,omitempty"`   // 1..31
	BirthMonth  *int    `json:"birth_month,omitempty"` // 1..12
	BirthPlace  *string `json:"birth_place,omitempty"` // lieu de naissance
	Nationality *string `json:"nationality,omitempty"` // nationalité
	FatherName  *string `json:"father_name,omitempty"` // nom et prénoms du père
	MotherName  *string `json:"mother_name,omitempty"` // nom et prénoms de la mère
	ActeNumber  *string `json:"acte_number,omitempty"` // n° de l'acte de naissance
	ActeDate    *string `json:"acte_date,omitempty"`   // date de l'acte de naissance
	ActePlace   *string `json:"acte_place,omitempty"`  // lieu d'établissement de l'acte
	// === Résultats de fin d'année (document officiel) ===
	// Scolarités : listes déroulantes 1..10 (création : 0/absent = non
	// renseigné ; mise à jour : nil = inchangé, 0 = effacer).
	ScolariteCours  *int `json:"scolarite_cours,omitempty"`
	ScolariteTotale *int `json:"scolarite_totale,omitempty"`
	// DecisionConseil — décision du conseil des maîtres : A | R | ABD
	// (mise à jour : nil = inchangé, "" = effacer).
	DecisionConseil *string `json:"decision_conseil,omitempty"`
}

// normalizeMatricule retourne nil si la string est vide (→ NULL en base),
// sinon un pointeur vers la valeur trimée. Plusieurs NULL peuvent coexister
// dans un unique index PostgreSQL.
func normalizeMatricule(s string) *string {
	trimmed := strings.TrimSpace(s)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

// validateBirthYear vérifie que l'année de naissance est plausible :
// entre 1900 et l'année courante. Retourne une erreur lisible sinon
// (le handler la renvoie telle quelle au frontend en 400).
func validateBirthYear(y int) error {
	current := time.Now().Year()
	if y < 1900 || y > current {
		return fmt.Errorf("année de naissance invalide : %d (attendu entre 1900 et %d)", y, current)
	}
	return nil
}

// validateBirthDay vérifie la plage du jour de naissance (1..31 — la
// validité calendaire fine dépend du mois/année, on reste sur 1..31
// comme sur le formulaire d'inscription papier).
func validateBirthDay(d int) error {
	if d < 1 || d > 31 {
		return fmt.Errorf("jour de naissance invalide : %d (attendu entre 1 et 31)", d)
	}
	return nil
}

// validateBirthMonth vérifie la plage du mois de naissance (1..12).
func validateBirthMonth(m int) error {
	if m < 1 || m > 12 {
		return fmt.Errorf("mois de naissance invalide : %d (attendu entre 1 et 12)", m)
	}
	return nil
}

// normalizeTextPtr trime un champ texte optionnel : nil → nil (inchangé /
// non renseigné), "" ou blancs → nil (NULL en base), sinon la valeur trimée.
func normalizeTextPtr(s *string) *string {
	if s == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*s)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

// validateScolarite vérifie la plage d'une scolarité (années) du document
// « RESULTATS DE FIN D'ANNEE » : liste déroulante 1..10.
func validateScolarite(field string, v int) error {
	if v < 1 || v > 10 {
		return fmt.Errorf("%s invalide : %d (attendu entre 1 et 10)", field, v)
	}
	return nil
}

// DecisionConseilA / R / ABD — domaine de la décision du conseil des
// maîtres (document « RESULTATS DE FIN D'ANNEE »).
const (
	DecisionConseilAdmis      = "A"
	DecisionConseilRedoublant = "R"
	DecisionConseilAbandon    = "ABD"
)

// isValidDecisionConseil — décision du conseil des maîtres valide.
func isValidDecisionConseil(d string) bool {
	switch d {
	case DecisionConseilAdmis, DecisionConseilRedoublant, DecisionConseilAbandon:
		return true
	}
	return false
}

// applyScolariteUpdate reporte une scolarité (cours ou totale) du payload sur
// le student en mode MISE À JOUR : nil = inchangé ; 0 = effacer (NULL) ;
// sinon valider la plage 1..10 puis affecter. Retourne une erreur (400).
func applyScolariteUpdate(field string, in *int, dst **int) error {
	if in == nil {
		return nil
	}
	if *in == 0 {
		*dst = nil
		return nil
	}
	if err := validateScolarite(field, *in); err != nil {
		return err
	}
	v := *in
	*dst = &v
	return nil
}

// applyDecisionConseilUpdate reporte la décision du conseil des maîtres en
// mode MISE À JOUR : nil = inchangé ; "" = effacer (NULL) ; sinon valider
// le domaine A|R|ABD puis affecter. Retourne une erreur (400).
func applyDecisionConseilUpdate(in *string, dst **string) error {
	if in == nil {
		return nil
	}
	d := strings.ToUpper(strings.TrimSpace(*in))
	if d == "" {
		*dst = nil
		return nil
	}
	if !isValidDecisionConseil(d) {
		return fmt.Errorf("décision du conseil des maîtres invalide : %q (attendu A, R ou ABD)", *in)
	}
	*dst = &d
	return nil
}

// CreateStudent creates a new student.
// Le matricule est fourni par le Ministère de l'Éducation ; il est optionnel.
// Si absent → NULL en base (affiché "N/A" côté frontend).
func CreateStudent(w http.ResponseWriter, r *http.Request) {
	var req CreateStudentRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		middleware.JSONError(w, "payload invalide", http.StatusBadRequest)
		return
	}
	if req.FirstName == "" || req.LastName == "" || req.ClassID == "" {
		middleware.JSONError(w, "first_name, last_name et class_id requis", http.StatusBadRequest)
		return
	}
	if req.Gender != "M" && req.Gender != "F" {
		middleware.JSONError(w, "gender doit être 'M' ou 'F'", http.StatusBadRequest)
		return
	}
	// Vérifier que la classe existe réellement en base (évite les élèves orphelins)
	var cls models.Class
	if err := database.DB.First(&cls, "id = ?", req.ClassID).Error; err != nil {
		middleware.JSONError(w, "classe introuvable — créez la classe avant d'y inscrire un élève", http.StatusBadRequest)
		return
	}

	// Si le matricule est fourni dans le body, on l'utilise ; sinon nil (NULL).
	var matricule *string
	if req.Matricule != nil {
		matricule = normalizeMatricule(*req.Matricule)
		if matricule != nil {
			// Vérifier l'unicité explicitement pour renvoyer un message clair
			var existing int64
			database.DB.Model(&models.Student{}).Where("matricule = ?", *matricule).Count(&existing)
			if existing > 0 {
				middleware.JSONError(w, "un élève avec ce matricule existe déjà", http.StatusConflict)
				return
			}
		}
	}

	student := models.Student{
		Matricule: matricule,
		ClassID:   req.ClassID,
		FirstName: req.FirstName,
		LastName:  req.LastName,
		Gender:    req.Gender,
	}

	// Date de naissance optionnelle
	if req.BirthDate != nil && *req.BirthDate != "" {
		t, err := time.Parse(time.RFC3339, *req.BirthDate)
		if err == nil {
			student.BirthDate = &t
		}
	}

	// Année de naissance optionnelle (format court, ex: 2006).
	// Absente ou 0 → NULL (non renseignée).
	if req.BirthYear != nil && *req.BirthYear != 0 {
		if err := validateBirthYear(*req.BirthYear); err != nil {
			middleware.JSONError(w, err.Error(), http.StatusBadRequest)
			return
		}
		y := *req.BirthYear
		student.BirthYear = &y
	}

	// === Identité civile étendue (création : 0/absent/"" → NULL) ===
	if req.BirthDay != nil && *req.BirthDay != 0 {
		if err := validateBirthDay(*req.BirthDay); err != nil {
			middleware.JSONError(w, err.Error(), http.StatusBadRequest)
			return
		}
		v := *req.BirthDay
		student.BirthDay = &v
	}
	if req.BirthMonth != nil && *req.BirthMonth != 0 {
		if err := validateBirthMonth(*req.BirthMonth); err != nil {
			middleware.JSONError(w, err.Error(), http.StatusBadRequest)
			return
		}
		v := *req.BirthMonth
		student.BirthMonth = &v
	}
	student.BirthPlace = normalizeTextPtr(req.BirthPlace)
	student.Nationality = normalizeTextPtr(req.Nationality)
	student.FatherName = normalizeTextPtr(req.FatherName)
	student.MotherName = normalizeTextPtr(req.MotherName)
	student.ActeNumber = normalizeTextPtr(req.ActeNumber)
	student.ActeDate = normalizeTextPtr(req.ActeDate)
	student.ActePlace = normalizeTextPtr(req.ActePlace)

	// === Résultats de fin d'année (création : 0/absent → NULL) ===
	if req.ScolariteCours != nil && *req.ScolariteCours != 0 {
		if err := validateScolarite("scolarité dans le cours", *req.ScolariteCours); err != nil {
			middleware.JSONError(w, err.Error(), http.StatusBadRequest)
			return
		}
		v := *req.ScolariteCours
		student.ScolariteCours = &v
	}
	if req.ScolariteTotale != nil && *req.ScolariteTotale != 0 {
		if err := validateScolarite("scolarité totale", *req.ScolariteTotale); err != nil {
			middleware.JSONError(w, err.Error(), http.StatusBadRequest)
			return
		}
		v := *req.ScolariteTotale
		student.ScolariteTotale = &v
	}
	if req.DecisionConseil != nil && strings.TrimSpace(*req.DecisionConseil) != "" {
		d := strings.ToUpper(strings.TrimSpace(*req.DecisionConseil))
		if !isValidDecisionConseil(d) {
			middleware.JSONError(w, fmt.Sprintf("décision du conseil des maîtres invalide : %q (attendu A, R ou ABD)", *req.DecisionConseil), http.StatusBadRequest)
			return
		}
		student.DecisionConseil = &d
	}

	if err := database.DB.Create(&student).Error; err != nil {
		middleware.JSONError(w, "erreur création élève: "+err.Error(), http.StatusInternalServerError)
		return
	}
	jsonResponse(w, http.StatusCreated, student)
}

// UpdateStudent updates a student.
// Le matricule peut être modifié (ou effacé en envoyant une string vide).
//
// RBAC — la route PUT /api/students/{id} est ouverte à tout utilisateur
// authentifié (router.go) ; le contrôle fin est fait ICI :
//   - admin / inspector / director : module students:write (matrice RBAC) ;
//   - teacher (tenant du cours) : peut CORRIGER un élève de SA classe
//     (erreur de saisie sur le nom, les prénoms, l'année de naissance…) —
//     il ne peut NI déplacer l'élève vers une autre classe, NI modifier
//     le matricule (données administratives du Ministère), NI toucher aux
//     élèves des autres classes (création/suppression toujours interdites).
func UpdateStudent(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req CreateStudentRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		middleware.JSONError(w, "payload invalide", http.StatusBadRequest)
		return
	}

	role := ctxRole(r)
	if role != models.RoleTeacher && !rbac.CanWrite(role, models.ModuleStudents) {
		middleware.JSONError(w, "accès refusé : modification d'élève non autorisée pour votre rôle", http.StatusForbidden)
		return
	}
	if role == models.RoleTeacher {
		// Le tenant du cours : pas de changement de classe ni de
		// matricule (les champs sont ignorés, pas rejetés — le
		// formulaire renvoie les valeurs inchangées).
		req.ClassID = ""
		req.Matricule = nil
	}

	var student models.Student
	if err := database.DB.First(&student, "id = ?", id).Error; err != nil {
		middleware.JSONError(w, "élève introuvable", http.StatusNotFound)
		return
	}

	// Scope teacher : l'élève doit appartenir à la classe dont il est
	// le titulaire (classes.teacher_id).
	if role == models.RoleTeacher {
		var cls models.Class
		if err := database.DB.First(&cls, "id = ?", student.ClassID).Error; err != nil ||
			cls.TeacherID == nil || *cls.TeacherID != ctxUserID(r) {
			middleware.JSONError(w, "accès refusé : élève hors de votre classe", http.StatusForbidden)
			return
		}
	}

	if req.FirstName != "" {
		student.FirstName = req.FirstName
	}
	if req.LastName != "" {
		student.LastName = req.LastName
	}
	if req.Gender == "M" || req.Gender == "F" {
		student.Gender = req.Gender
	}
	if req.ClassID != "" {
		student.ClassID = req.ClassID
	}
	if req.Matricule != nil {
		newMat := normalizeMatricule(*req.Matricule)
		// Vérifier l'unicité si la nouvelle valeur est non vide
		if newMat != nil {
			var existing int64
			database.DB.Model(&models.Student{}).
				Where("matricule = ? AND id != ?", *newMat, id).
				Count(&existing)
			if existing > 0 {
				middleware.JSONError(w, "un élève avec ce matricule existe déjà", http.StatusConflict)
				return
			}
		}
		student.Matricule = newMat
	}
	if req.BirthDate != nil && *req.BirthDate != "" {
		t, err := time.Parse(time.RFC3339, *req.BirthDate)
		if err == nil {
			student.BirthDate = &t
		}
	}

	// Année de naissance : nil = champ non envoyé (inchangé) ;
	// 0 = effacer (NULL) ; sinon valider la plage et mettre à jour.
	if req.BirthYear != nil {
		if *req.BirthYear == 0 {
			student.BirthYear = nil
		} else if err := validateBirthYear(*req.BirthYear); err != nil {
			middleware.JSONError(w, err.Error(), http.StatusBadRequest)
			return
		} else {
			y := *req.BirthYear
			student.BirthYear = &y
		}
	}

	// === Identité civile étendue : nil = inchangé ; 0/"" = effacer (NULL) ===
	if req.BirthDay != nil {
		if *req.BirthDay == 0 {
			student.BirthDay = nil
		} else if err := validateBirthDay(*req.BirthDay); err != nil {
			middleware.JSONError(w, err.Error(), http.StatusBadRequest)
			return
		} else {
			v := *req.BirthDay
			student.BirthDay = &v
		}
	}
	if req.BirthMonth != nil {
		if *req.BirthMonth == 0 {
			student.BirthMonth = nil
		} else if err := validateBirthMonth(*req.BirthMonth); err != nil {
			middleware.JSONError(w, err.Error(), http.StatusBadRequest)
			return
		} else {
			v := *req.BirthMonth
			student.BirthMonth = &v
		}
	}
	if req.BirthPlace != nil {
		student.BirthPlace = normalizeTextPtr(req.BirthPlace)
	}
	if req.Nationality != nil {
		student.Nationality = normalizeTextPtr(req.Nationality)
	}
	if req.FatherName != nil {
		student.FatherName = normalizeTextPtr(req.FatherName)
	}
	if req.MotherName != nil {
		student.MotherName = normalizeTextPtr(req.MotherName)
	}
	if req.ActeNumber != nil {
		student.ActeNumber = normalizeTextPtr(req.ActeNumber)
	}
	if req.ActeDate != nil {
		student.ActeDate = normalizeTextPtr(req.ActeDate)
	}
	if req.ActePlace != nil {
		student.ActePlace = normalizeTextPtr(req.ActePlace)
	}

	// === Résultats de fin d'année : nil = inchangé ; 0/"" = effacer (NULL) ===
	if err := applyScolariteUpdate("scolarité dans le cours", req.ScolariteCours, &student.ScolariteCours); err != nil {
		middleware.JSONError(w, err.Error(), http.StatusBadRequest)
		return
	}
	if err := applyScolariteUpdate("scolarité totale", req.ScolariteTotale, &student.ScolariteTotale); err != nil {
		middleware.JSONError(w, err.Error(), http.StatusBadRequest)
		return
	}
	if err := applyDecisionConseilUpdate(req.DecisionConseil, &student.DecisionConseil); err != nil {
		middleware.JSONError(w, err.Error(), http.StatusBadRequest)
		return
	}

	if err := database.DB.Save(&student).Error; err != nil {
		middleware.JSONError(w, "erreur mise à jour", http.StatusInternalServerError)
		return
	}
	jsonResponse(w, http.StatusOK, student)
}

// DeleteStudent removes a student.
func DeleteStudent(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := database.DB.Delete(&models.Student{}, "id = ?", id).Error; err != nil {
		middleware.JSONError(w, "erreur suppression", http.StatusInternalServerError)
		return
	}
	jsonResponse(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// === Import Excel d'élèves (bulk) ===
// Permet à un directeur d'importer son fichier Excel (matricule, nom, prenoms,
// sexe, niveau) pour remplir sa base en une opération. Le frontend parse le
// Excel (SheetJS) et envoie un tableau JSON ; le backend fait le lookup
// niveau→class_id (case-insensitive), skip les doublons de matricule, et
// insère en transaction. RBAC : director = son école, admin = school_id du payload.

// BulkStudentInput — un élève à importer (class_name = "CP2" pas un UUID).
// Champs facultatifs (tous *string) : état civil élève — nationalité, lieu de
// naissance, père, mère, acte de naissance (n°, date, lieu). Vide = NULL.
type BulkStudentInput struct {
	Matricule   *string `json:"matricule,omitempty"`
	FirstName   string  `json:"first_name"`
	LastName    string  `json:"last_name"`
	Gender      string  `json:"gender"`     // M/F (ou MASCULIN/FEMININ — normalisé)
	ClassName   string  `json:"class_name"` // "CP2" — lookup par nom dans l'école
	Nationality *string `json:"nationality,omitempty"`
	BirthPlace  *string `json:"birth_place,omitempty"`
	FatherName  *string `json:"father_name,omitempty"`
	MotherName  *string `json:"mother_name,omitempty"`
	ActeNumber  *string `json:"acte_number,omitempty"`
	ActeDate    *string `json:"acte_date,omitempty"`
	ActePlace   *string `json:"acte_place,omitempty"`
}

// BulkImportRequest — payload du POST /api/students/bulk.
type BulkImportRequest struct {
	SchoolID string             `json:"school_id"` // requis pour admin ; ignoré pour director (force ctxSchoolID)
	Students []BulkStudentInput `json:"students"`
}

// BulkImportResult — réponse : created/skipped/failed avec détails.
type BulkImportResult struct {
	Created int                `json:"created"`
	Skipped []BulkImportDetail `json:"skipped"`
	Failed  []BulkImportDetail `json:"failed"`
	Total   int                `json:"total"`
}

type BulkImportDetail struct {
	Row       int    `json:"row"` // 1-based (ligne Excel, hors en-tête)
	Matricule string `json:"matricule,omitempty"`
	Reason    string `json:"reason"`
}

// normalizeGenderBulk convertit MASCULIN/FEMININ (ou variants) → M/F.
// Retourne "" si invalide.
func normalizeGenderBulk(s string) string {
	n := strings.ToUpper(strings.TrimSpace(s))
	switch n {
	case "MASCULIN", "M", "MALE", "G":
		return "M"
	case "FEMININ", "F", "FEMALE":
		return "F"
	default:
		return ""
	}
}

// BulkCreateStudents importe un tableau d'élèves dans l'école du directeur
// (ou l'école spécifiée pour un admin). Skip les matricules existants, signale
// les classes introuvables et les genres invalides. Insère en transaction GORM.
//
// RBAC :
//   - director : schoolID = ctxSchoolID() (son école, payload ignoré).
//   - admin    : schoolID = payload.SchoolID (requis).
//   - autres   : 403.
func BulkCreateStudents(w http.ResponseWriter, r *http.Request) {
	defer InvalidateDashboardCache() // Fix C: import étudiants → invalidate cache dashboard
	role := ctxRole(r)
	var schoolID string
	switch role {
	case "director":
		schoolID = ctxSchoolID(r)
		if schoolID == "" {
			middleware.JSONError(w, "directeur sans école rattachée", http.StatusForbidden)
			return
		}
	case "admin":
		// schoolID lu dans le payload ci-dessous
	default:
		middleware.JSONError(w, "rôle non autorisé (director ou admin requis)", http.StatusForbidden)
		return
	}

	var req BulkImportRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		middleware.JSONError(w, "payload invalide : "+err.Error(), http.StatusBadRequest)
		return
	}
	if role == "admin" {
		schoolID = strings.TrimSpace(req.SchoolID)
		if schoolID == "" {
			middleware.JSONError(w, "school_id requis pour un admin", http.StatusBadRequest)
			return
		}
	}
	if len(req.Students) == 0 {
		middleware.JSONError(w, "aucun élève à importer", http.StatusBadRequest)
		return
	}

	// Charger toutes les classes de l'école une fois (map UPPER(name) → class_id).
	var classes []models.Class
	if err := database.DB.Where("school_id = ? AND active = ?", schoolID, true).
		Find(&classes).Error; err != nil {
		middleware.JSONError(w, "erreur récupération classes : "+err.Error(), http.StatusInternalServerError)
		return
	}
	classByName := make(map[string]string, len(classes))
	for _, c := range classes {
		classByName[strings.ToUpper(strings.TrimSpace(c.Name))] = c.ID
	}

	// Transaction pour insérer tous les élèves valides d'un coup.
	tx := database.DB.Begin()
	// Skipped/Failed initialisés à slice vide (pas nil) pour que le JSON
	// renvoie [] et non null — sinon le frontend .length crash (null.length).
	result := BulkImportResult{
		Total:   len(req.Students),
		Skipped: []BulkImportDetail{},
		Failed:  []BulkImportDetail{},
	}
	// Map des matricules déjà vus dans CE fichier (pour skip intra-fichier).
	seenInFile := make(map[string]bool)

	for i, in := range req.Students {
		row := i + 1 // 1-based pour le reporting

		// 1) Normaliser + valider le genre.
		gender := normalizeGenderBulk(in.Gender)
		if gender == "" {
			result.Failed = append(result.Failed, BulkImportDetail{
				Row: row, Matricule: ptrToStr(in.Matricule),
				Reason: fmt.Sprintf("genre invalide : %q (attendu MASCULIN/FEMININ ou M/F)", in.Gender),
			})
			continue
		}

		// 2) Valider nom + prénoms non vides.
		firstName := strings.TrimSpace(in.FirstName)
		lastName := strings.TrimSpace(in.LastName)
		if firstName == "" || lastName == "" {
			result.Failed = append(result.Failed, BulkImportDetail{
				Row: row, Matricule: ptrToStr(in.Matricule),
				Reason: "first_name et last_name requis",
			})
			continue
		}

		// 3) Lookup class_name → class_id (case-insensitive).
		className := strings.ToUpper(strings.TrimSpace(in.ClassName))
		classID, ok := classByName[className]
		if !ok {
			result.Failed = append(result.Failed, BulkImportDetail{
				Row: row, Matricule: ptrToStr(in.Matricule),
				Reason: fmt.Sprintf("classe %q introuvable dans l'école (classes dispo : %s)", in.ClassName, classListStr(classByName)),
			})
			continue
		}

		// 4) Matricule : skip si déjà en base OU déjà vu dans ce fichier.
		var matricule *string
		if in.Matricule != nil {
			matricule = normalizeMatricule(*in.Matricule)
		}
		if matricule != nil {
			m := *matricule
			if seenInFile[m] {
				result.Skipped = append(result.Skipped, BulkImportDetail{
					Row: row, Matricule: m,
					Reason: "matricule en double dans le fichier",
				})
				continue
			}
			var existing int64
			tx.Model(&models.Student{}).Where("matricule = ?", m).Count(&existing)
			if existing > 0 {
				result.Skipped = append(result.Skipped, BulkImportDetail{
					Row: row, Matricule: m,
					Reason: "matricule déjà en base",
				})
				continue
			}
			seenInFile[m] = true
		}

		// 5) Insérer (état civil facultatif : trim, vide → NULL).
		st := models.Student{
			Matricule:   matricule,
			ClassID:     classID,
			FirstName:   firstName,
			LastName:    lastName,
			Gender:      gender,
			Nationality: optStrPtr(in.Nationality),
			BirthPlace:  optStrPtr(in.BirthPlace),
			FatherName:  optStrPtr(in.FatherName),
			MotherName:  optStrPtr(in.MotherName),
			ActeNumber:  optStrPtr(in.ActeNumber),
			ActeDate:    optStrPtr(in.ActeDate),
			ActePlace:   optStrPtr(in.ActePlace),
		}
		if err := tx.Create(&st).Error; err != nil {
			result.Failed = append(result.Failed, BulkImportDetail{
				Row: row, Matricule: ptrToStr(matricule),
				Reason: "erreur création : " + err.Error(),
			})
			continue
		}
		result.Created++
	}

	if err := tx.Commit().Error; err != nil {
		middleware.JSONError(w, "erreur commit transaction : "+err.Error(), http.StatusInternalServerError)
		return
	}

	jsonResponse(w, http.StatusOK, result)
}

// ptrToStr retourne la valeur pointée, ou "" si nil. Utilisé pour le reporting.
func ptrToStr(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// optStrPtr trimme une chaîne optionnelle : nil/vide → nil (NULL en base).
func optStrPtr(s *string) *string {
	if s == nil {
		return nil
	}
	t := strings.TrimSpace(*s)
	if t == "" {
		return nil
	}
	return &t
}

// classListStr retourne les noms de classes dispo (pour message d'erreur).
func classListStr(m map[string]string) string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	return strings.Join(keys, ", ")
}
