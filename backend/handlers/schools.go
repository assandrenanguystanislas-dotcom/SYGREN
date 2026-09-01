package handlers

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"

	"sygren-api/database"
	"sygren-api/middleware"
	"sygren-api/models"
	"sygren-api/storage"

	"github.com/go-chi/chi/v5"
)

// === Schools — Gestion des établissements scolaires ===
// Accès :
//   - admin : toutes les écoles
//   - inspector : écoles de son IEP
//   - director/teacher : école de son école_id

// SchoolWithStats — école enrichie avec compteurs
type SchoolWithStats struct {
	models.School
	IEPName      string `json:"iep_name,omitempty"`
	ClassCount   int64  `json:"class_count"`
	StudentCount int64  `json:"student_count"`
	// LogoURL — URL de lecture présignée (R2) ou chemin public (dev),
	// calculée par le handler à partir de LogoPath (jamais stockée en DB).
	LogoURL string `json:"logo_url,omitempty"`
	// ExamCenterName — nom du centre d'examen de rattachement (documents
	// officiels du plan IEPP), résolu en masse par ListSchools.
	ExamCenterName string `json:"exam_center_name,omitempty"`
}

// ListSchools returns schools filtered by the user's scope.
//
// Perf : 4 requêtes au TOTAL (écoles, IEPs, compteurs classes, compteurs
// élèves) au lieu de 3 requêtes PAR école (pattern N+1). Avec 97 écoles,
// l'ancienne version émettait ~291 requêtes séquentielles : invisible depuis
// Render (co-localisé avec Neon eu-central-1, ~2 ms/requête → 0,6 s) mais
// >2 min depuis un client éloigné du pooler (~400 ms/requête). Les agrégats
// GROUP BY rendent le coût constant quel que soit le nombre d'écoles.
func ListSchools(w http.ResponseWriter, r *http.Request) {
	role := ctxRole(r)
	query := database.DB.Model(&models.School{})

	switch role {
	case "director", "teacher":
		schoolID := ctxSchoolID(r)
		if schoolID == "" {
			jsonResponse(w, http.StatusOK, map[string]interface{}{"schools": []interface{}{}, "count": 0})
			return
		}
		query = query.Where("id = ?", schoolID)
	}

	var schools []models.School
	if err := query.Order("name ASC").Find(&schools).Error; err != nil {
		middleware.JSONError(w, "erreur récupération écoles", http.StatusInternalServerError)
		return
	}

	// IDs des écoles retournées (pour les 3 requêtes d'enrichissement en masse)
	schoolIDs := make([]string, len(schools))
	for i, s := range schools {
		schoolIDs[i] = s.ID
	}

	// Noms d'IEP : 1 requête IN (...) au lieu de 1 requête par école
	iepName := make(map[string]string)
	iepIDs := make([]string, 0, len(schools))
	seen := make(map[string]bool, len(schools))
	for _, s := range schools {
		if s.IEPID != "" && !seen[s.IEPID] {
			seen[s.IEPID] = true
			iepIDs = append(iepIDs, s.IEPID)
		}
	}
	if len(iepIDs) > 0 {
		var ieps []models.IEP
		if err := database.DB.Select("id", "name").Where("id IN ?", iepIDs).Find(&ieps).Error; err != nil {
			log.Println("[schools] enrichissement IEP:", err)
		}
		for _, i := range ieps {
			iepName[i.ID] = i.Name
		}
	}

	// Noms des centres d'examen : 1 requête IN (...) (pattern anti-N+1,
	// même convention que les noms d'IEP ci-dessus) — affichés sur les
	// cartes écoles et utilisés par le filtre « centre d'examen ».
	centerName := make(map[string]string)
	centerIDs := make([]string, 0, len(schools))
	centerSeen := make(map[string]bool, len(schools))
	for _, s := range schools {
		if s.ExamCenterID != nil && *s.ExamCenterID != "" && !centerSeen[*s.ExamCenterID] {
			centerSeen[*s.ExamCenterID] = true
			centerIDs = append(centerIDs, *s.ExamCenterID)
		}
	}
	if len(centerIDs) > 0 {
		var centers []models.ExamCenter
		if err := database.DB.Select("id", "name").Where("id IN ?", centerIDs).Find(&centers).Error; err != nil {
			log.Println("[schools] enrichissement centres d'examen:", err)
		}
		for _, c := range centers {
			centerName[c.ID] = c.Name
		}
	}

	// Compteurs : 2 agrégats GROUP BY au lieu de 2 requêtes par école
	// NB : une slice DISTINCTE par Scan — gorm Scan RÉUTILISE la slice
	// passée en paramètre si sa capacité est non nulle (scan.go : « the
	// externally initialized slice is directly used here ») ; réutiliser la
	// même variable ferait persister les lignes de la 1re requête quand la
	// 2de en retourne moins (ex : école avec classes mais 0 élève).
	type idCount struct {
		SchoolID string `json:"school_id"`
		Count    int64  `json:"count"`
	}
	classCounts := make(map[string]int64, len(schools))
	studentCounts := make(map[string]int64, len(schools))
	if len(schoolIDs) > 0 {
		var classRows []idCount
		if err := database.DB.Model(&models.Class{}).
			Select("school_id", "COUNT(*) AS count").
			Where("school_id IN ?", schoolIDs).
			Group("school_id").
			Scan(&classRows).Error; err != nil {
			log.Println("[schools] compteur classes:", err)
		}
		for _, row := range classRows {
			classCounts[row.SchoolID] = row.Count
		}

		var studentRows []idCount
		if err := database.DB.Model(&models.Student{}).
			Joins("JOIN classes ON classes.id = students.class_id").
			Select("classes.school_id AS school_id", "COUNT(*) AS count").
			Where("classes.school_id IN ?", schoolIDs).
			Group("classes.school_id").
			Scan(&studentRows).Error; err != nil {
			log.Println("[schools] compteur élèves:", err)
		}
		for _, row := range studentRows {
			studentCounts[row.SchoolID] = row.Count
		}
	}

	// Assemblage en mémoire — plus aucune requête DB dans cette boucle
	// (la présignature du logo est un calcul local HMAC, pas un appel réseau)
	result := make([]SchoolWithStats, 0, len(schools))
	for _, s := range schools {
		stats := SchoolWithStats{
			School:       s,
			IEPName:      iepName[s.IEPID],
			ClassCount:   classCounts[s.ID],
			StudentCount: studentCounts[s.ID],
		}
		if s.ExamCenterID != nil && *s.ExamCenterID != "" {
			stats.ExamCenterName = centerName[*s.ExamCenterID]
		}
		if s.LogoPath != nil && *s.LogoPath != "" && storage.Global != nil {
			if u, err := storage.Global.PresignURL(r.Context(), *s.LogoPath); err == nil {
				stats.LogoURL = u
			} else {
				log.Println("[schools] présignature logo:", err)
			}
		}
		result = append(result, stats)
	}

	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"schools": result,
		"count":   len(result),
	})
}

// ValidSchoolStatus — statuts autorisés pour une école
var ValidSchoolStatus = map[string]string{
	"public":    "Public",
	"private":   "Privé",
	"community": "Communautaire",
}

// CreateSchoolRequest — payload pour créer une école
type CreateSchoolRequest struct {
	IEPID   string `json:"iep_id"`
	Code    string `json:"code"` // code unique identifiant l'école dans le système IEP
	Name    string `json:"name"`
	Address string `json:"address"`
	Status  string `json:"status"` // public | private | community
	// ExamCenterID — rattachement au centre d'examen (documents du plan IEPP).
	// Pointeur pour distinguer « absent » (inchangé) de « vide » (détacher).
	ExamCenterID *string `json:"exam_center_id,omitempty"`
}

// resolveExamCenter — valide le rattachement d'une école à un centre
// d'examen. Règles : "" = détacher (nil) ; sinon le centre doit exister ET
// appartenir à la même IEP que l'école (les documents officiels groupent
// les écoles PAR centre au sein d'une IEP).
func resolveExamCenter(centerID string, iepID string) (*string, error) {
	if centerID == "" {
		return nil, nil
	}
	var center models.ExamCenter
	if err := database.DB.First(&center, "id = ?", centerID).Error; err != nil {
		return nil, fmt.Errorf("centre d'examen introuvable")
	}
	if center.IEPID != iepID {
		return nil, fmt.Errorf("ce centre d'examen appartient à une autre IEP")
	}
	return &center.ID, nil
}

// CreateSchool creates a new school (admin only).
// Auto-crée les 6 classes standard du primaire ivoirien (CP1, CP2, CE1, CE2, CM1, CM2)
// — cahier des charges §3 Module 1. Toutes actives par défaut.
func CreateSchool(w http.ResponseWriter, r *http.Request) {
	var req CreateSchoolRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		middleware.JSONError(w, "payload invalide", http.StatusBadRequest)
		return
	}
	if req.Name == "" || req.IEPID == "" || req.Code == "" {
		middleware.JSONError(w, "code, nom et iep_id requis", http.StatusBadRequest)
		return
	}
	// Valider le statut (défaut: public)
	if req.Status == "" {
		req.Status = "public"
	}
	if _, ok := ValidSchoolStatus[req.Status]; !ok {
		middleware.JSONError(w, "statut invalide (public, private, community)", http.StatusBadRequest)
		return
	}
	// Vérifier que l'IEP existe réellement en base (évite les écoles orphelines)
	var iep models.IEP
	if err := database.DB.First(&iep, "id = ?", req.IEPID).Error; err != nil {
		middleware.JSONError(w, "IEP introuvable — créez l'inspection avant d'y ajouter une école", http.StatusBadRequest)
		return
	}
	// Vérifier l'unicité du code école
	var existing int64
	database.DB.Model(&models.School{}).Where("code = ?", req.Code).Count(&existing)
	if existing > 0 {
		middleware.JSONError(w, "une école avec ce code existe déjà", http.StatusConflict)
		return
	}
	school := models.School{
		IEPID:   req.IEPID,
		Code:    req.Code,
		Name:    req.Name,
		Address: req.Address,
		Status:  req.Status,
	}
	// Rattachement optionnel au centre d'examen (documents du plan IEPP).
	if req.ExamCenterID != nil {
		centerID, err := resolveExamCenter(*req.ExamCenterID, req.IEPID)
		if err != nil {
			middleware.JSONError(w, err.Error(), http.StatusBadRequest)
			return
		}
		school.ExamCenterID = centerID
	}
	if err := database.DB.Create(&school).Error; err != nil {
		middleware.JSONError(w, "erreur création école", http.StatusInternalServerError)
		return
	}

	// Auto-création des 6 classes standard (actives par défaut)
	for name, level := range ValidClassNames {
		cls := models.Class{
			SchoolID: school.ID,
			Name:     name,
			Level:    level,
			Active:   true,
		}
		if err := database.DB.Create(&cls).Error; err != nil {
			log.Printf("[DB] auto-create class %s for school %s: %v", name, school.ID, err)
		}
	}
	log.Printf("[DB] 6 classes auto-créées pour l'école %s", school.ID)

	jsonResponse(w, http.StatusCreated, school)
}

// UpdateSchool updates an existing school.
// Le code peut être modifié (avec vérification d'unicité) ainsi que le statut.
func UpdateSchool(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req CreateSchoolRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		middleware.JSONError(w, "payload invalide", http.StatusBadRequest)
		return
	}
	var school models.School
	if err := database.DB.First(&school, "id = ?", id).Error; err != nil {
		middleware.JSONError(w, "école introuvable", http.StatusNotFound)
		return
	}
	if req.Name != "" {
		school.Name = req.Name
	}
	if req.Address != "" {
		school.Address = req.Address
	}
	if req.IEPID != "" {
		school.IEPID = req.IEPID
	}
	if req.Code != "" && req.Code != school.Code {
		// Vérifier l'unicité du nouveau code
		var existing int64
		database.DB.Model(&models.School{}).Where("code = ? AND id != ?", req.Code, id).Count(&existing)
		if existing > 0 {
			middleware.JSONError(w, "une école avec ce code existe déjà", http.StatusConflict)
			return
		}
		school.Code = req.Code
	}
	if req.Status != "" {
		if _, ok := ValidSchoolStatus[req.Status]; !ok {
			middleware.JSONError(w, "statut invalide (public, private, community)", http.StatusBadRequest)
			return
		}
		school.Status = req.Status
	}
	// Centre d'examen : nil = inchangé, "" = détacher, sinon rattacher
	// (le centre doit exister et appartenir à l'IEP de l'école).
	if req.ExamCenterID != nil {
		centerID, err := resolveExamCenter(*req.ExamCenterID, school.IEPID)
		if err != nil {
			middleware.JSONError(w, err.Error(), http.StatusBadRequest)
			return
		}
		school.ExamCenterID = centerID
	}
	if err := database.DB.Save(&school).Error; err != nil {
		middleware.JSONError(w, "erreur mise à jour", http.StatusInternalServerError)
		return
	}
	jsonResponse(w, http.StatusOK, school)
}

// DeleteSchool removes a school (cascade-check: must have no classes).
func DeleteSchool(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var classCount int64
	database.DB.Model(&models.Class{}).Where("school_id = ?", id).Count(&classCount)
	if classCount > 0 {
		middleware.JSONError(w, "impossible de supprimer : des classes existent dans cette école", http.StatusConflict)
		return
	}
	if err := database.DB.Delete(&models.School{}, "id = ?", id).Error; err != nil {
		middleware.JSONError(w, "erreur suppression", http.StatusInternalServerError)
		return
	}
	// Nettoyage du logo dans le stockage (best effort — l'école est déjà supprimée)
	if storage.Global != nil {
		var school models.School
		if err := database.DB.Unscoped().First(&school, "id = ?", id).Error; err == nil && school.LogoPath != nil && *school.LogoPath != "" {
			if err := storage.Global.Delete(r.Context(), *school.LogoPath); err != nil {
				log.Println("[schools] nettoyage logo école supprimée:", err)
			}
		}
	}
	jsonResponse(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// === Logos d'écoles — stockage fichiers (R2 en prod, filesystem en dev) ===
//
// RBAC : même groupe que l'écriture écoles (RequireModule "schools" write) —
// cohérent avec Create/Update/DeleteSchool (pas de re-check rôle ici).
// Le logo est une image publique de l'établissement : la lecture passe par
// une URL présignée R2 (signature dans l'URL) — même modèle d'accès que le
// filesystem dev public /storage/*.

const (
	// MaxLogoBytes — limite stricte du corps de requête (2 MiB).
	MaxLogoBytes = 2 << 20
	// DefaultLogoKeyPrefix — préfixe des clés R2/local des logos.
	// Clé finale : school-logos/<school_id>.<ext> (1 logo par école).
)

// Types d'images acceptés pour un logo (sniffé sur le CONTENU, jamais sur
// l'extension du fichier envoyé — anti-renommage malveillant). SVG exclu :
// exécutable dans le navigateur (vecteur XSS s'il est servi en direct).
var allowedLogoTypes = map[string]string{
	"image/png":  "png",
	"image/jpeg": "jpg",
	"image/webp": "webp",
}

// UploadSchoolLogo — POST /api/schools/{id}/logo (multipart, champ "logo").
// Remplace l'ancien logo s'il existe (objet R2 différent supprimé).
func UploadSchoolLogo(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var school models.School
	if err := database.DB.First(&school, "id = ?", id).Error; err != nil {
		middleware.JSONError(w, "école introuvable", http.StatusNotFound)
		return
	}
	if storage.Global == nil {
		middleware.JSONError(w, "stockage fichiers non configuré (R2 requis en production — variables R2_* absentes)", http.StatusServiceUnavailable)
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, MaxLogoBytes)
	if err := r.ParseMultipartForm(MaxLogoBytes); err != nil {
		middleware.JSONError(w, "logo trop volumineux ou requête invalide (max 2 Mo)", http.StatusBadRequest)
		return
	}
	file, _, err := r.FormFile("logo")
	if err != nil {
		middleware.JSONError(w, "champ fichier \"logo\" requis", http.StatusBadRequest)
		return
	}
	defer file.Close()

	data, err := io.ReadAll(file)
	if err != nil || len(data) == 0 {
		middleware.JSONError(w, "fichier vide ou illisible", http.StatusBadRequest)
		return
	}
	contentType := http.DetectContentType(data)
	ext, ok := allowedLogoTypes[contentType]
	if !ok {
		middleware.JSONError(w, "format non supporté (PNG, JPEG ou WebP attendu)", http.StatusUnsupportedMediaType)
		return
	}

	key := fmt.Sprintf("school-logos/%s.%s", school.ID, ext)
	if err := storage.Global.Put(r.Context(), key, contentType, data); err != nil {
		log.Println("[schools] upload logo:", err)
		middleware.JSONError(w, "échec de l'enregistrement du logo", http.StatusInternalServerError)
		return
	}

	// Remplacement : si l'ancien objet a une clé différente (extension
	// différente), on le supprime pour éviter les orphelins.
	if school.LogoPath != nil && *school.LogoPath != "" && *school.LogoPath != key {
		if err := storage.Global.Delete(r.Context(), *school.LogoPath); err != nil {
			log.Println("[schools] suppression ancien logo:", err)
		}
	}

	if err := database.DB.Model(&models.School{}).Where("id = ?", school.ID).
		Update("logo_path", key).Error; err != nil {
		middleware.JSONError(w, "échec de la mise à jour de l'école", http.StatusInternalServerError)
		return
	}

	logoURL, _ := storage.Global.PresignURL(r.Context(), key)
	jsonResponse(w, http.StatusOK, map[string]interface{}{"logo_path": key, "logo_url": logoURL})
}

// DeleteSchoolLogo — DELETE /api/schools/{id}/logo.
func DeleteSchoolLogo(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var school models.School
	if err := database.DB.First(&school, "id = ?", id).Error; err != nil {
		middleware.JSONError(w, "école introuvable", http.StatusNotFound)
		return
	}
	if school.LogoPath == nil || *school.LogoPath == "" {
		middleware.JSONError(w, "aucun logo à supprimer", http.StatusNotFound)
		return
	}
	if storage.Global == nil {
		middleware.JSONError(w, "stockage fichiers non configuré (R2 requis en production)", http.StatusServiceUnavailable)
		return
	}

	if err := storage.Global.Delete(r.Context(), *school.LogoPath); err != nil {
		log.Println("[schools] delete logo:", err)
		middleware.JSONError(w, "échec de la suppression du logo", http.StatusInternalServerError)
		return
	}
	if err := database.DB.Model(&models.School{}).Where("id = ?", school.ID).
		Update("logo_path", nil).Error; err != nil {
		middleware.JSONError(w, "échec de la mise à jour de l'école", http.StatusInternalServerError)
		return
	}
	jsonResponse(w, http.StatusOK, map[string]string{"status": "deleted"})
}
