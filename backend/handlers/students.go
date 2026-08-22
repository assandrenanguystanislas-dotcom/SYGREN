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

// CreateStudentRequest — payload pour créer un élève
type CreateStudentRequest struct {
	Matricule *string `json:"matricule,omitempty"` // fourni par le Ministère de l'Éducation (optionnel)
	ClassID   string  `json:"class_id"`
	FirstName string  `json:"first_name"`
	LastName  string  `json:"last_name"`
	Gender    string  `json:"gender"`               // M / F
	BirthDate *string `json:"birth_date,omitempty"` // ISO 8601
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

	if err := database.DB.Create(&student).Error; err != nil {
		middleware.JSONError(w, "erreur création élève: "+err.Error(), http.StatusInternalServerError)
		return
	}
	jsonResponse(w, http.StatusCreated, student)
}

// UpdateStudent updates a student.
// Le matricule peut être modifié (ou effacé en envoyant une string vide).
func UpdateStudent(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req CreateStudentRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		middleware.JSONError(w, "payload invalide", http.StatusBadRequest)
		return
	}
	var student models.Student
	if err := database.DB.First(&student, "id = ?", id).Error; err != nil {
		middleware.JSONError(w, "élève introuvable", http.StatusNotFound)
		return
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
type BulkStudentInput struct {
	Matricule *string `json:"matricule,omitempty"`
	FirstName string  `json:"first_name"`
	LastName  string  `json:"last_name"`
	Gender    string  `json:"gender"`     // M/F (ou MASCULIN/FEMININ — normalisé)
	ClassName string  `json:"class_name"` // "CP2" — lookup par nom dans l'école
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

		// 5) Insérer.
		st := models.Student{
			Matricule: matricule,
			ClassID:   classID,
			FirstName: firstName,
			LastName:  lastName,
			Gender:    gender,
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

// classListStr retourne les noms de classes dispo (pour message d'erreur).
func classListStr(m map[string]string) string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	return strings.Join(keys, ", ")
}
