package handlers

import (
	"encoding/json"
	"log"
	"net/http"
	"strings"

	"sygren-api/database"
	"sygren-api/middleware"
	"sygren-api/models"

	"github.com/go-chi/chi/v5"
	"gorm.io/gorm"
)

// === Secteurs d'écoles — v5 (session 26) ===
//
// Regroupement des écoles par SECTEUR confié à un ou plusieurs CONSEILLERS
// pédagogiques (demande utilisateur : « dans le module école créer une plage
// SECTEURS D'ECOLES… dans chaque secteur d'écoles seront affectés des
// conseillers qui auront leur gestion. Les directeurs et les adjoints au
// directeurs dont les écoles sont dans les secteurs d'écoles concernés
// seront sous l'autorité de ces conseillers »).
//
// Deux rattachements :
//   - schools.sector_id  : l'école appartient au secteur ;
//   - users.sector_id    : le conseiller est affecté au secteur (role=conseiller).
//
// RBAC (aligné sur le module Écoles, dont la gestion des secteurs est une
// extension — même convention que les centres d'examen) :
//   - lecture  : admin (tous) + inspector (son IEP) — scope dans le handler
//   - écriture : RequireModule("schools", "write") — posé au routage

// SectorWithStats — secteur enrichi (compteurs + conseillers affectés).
type SectorWithStats struct {
	models.Sector
	SchoolCount int64    `json:"school_count"`
	Conseillers []string `json:"conseillers"` // noms des conseillers affectés
}

// ListSectors — GET /api/sectors
// Scope : admin = tous les secteurs ; inspector = ceux de son IEP ;
// autres rôles = refusé (la gestion des secteurs est administrative).
func ListSectors(w http.ResponseWriter, r *http.Request) {
	role := ctxRole(r)
	query := database.DB.Model(&models.Sector{})

	switch role {
	case models.RoleAdmin:
		// tous
	case models.RoleInspector:
		query = query.Where("iep_id = ?", ctxIEPID(r))
	default:
		middleware.JSONError(w, "accès refusé : la consultation des secteurs est réservée à l'administration", http.StatusForbidden)
		return
	}

	var sectors []models.Sector
	if err := query.Order("position ASC, name ASC").Find(&sectors).Error; err != nil {
		middleware.JSONError(w, "erreur récupération secteurs", http.StatusInternalServerError)
		return
	}

	// Compteur d'écoles rattachées : 1 agrégat GROUP BY (pattern anti-N+1,
	// même convention que ListExamCenters — slice DISTINCTE par Scan).
	counts := make(map[string]int64, len(sectors))
	// Noms des conseillers affectés : 1 requête par agrégat Go (les
	// conseillers sont peu nombreux — l'affectation est une colonne
	// users.sector_id, un GROUP_CONCAT n'est pas portable SQLite/PostgreSQL
	// au même degré, on résout donc en mémoire).
	conseillerNames := make(map[string][]string, len(sectors))
	if len(sectors) > 0 {
		ids := make([]string, len(sectors))
		for i, s := range sectors {
			ids[i] = s.ID
		}

		var rows []struct {
			SectorID string `json:"sector_id"`
			Count    int64  `json:"count"`
		}
		if err := database.DB.Model(&models.School{}).
			Select("sector_id", "COUNT(*) AS count").
			Where("sector_id IN ?", ids).
			Group("sector_id").
			Scan(&rows).Error; err != nil {
			log.Println("[sectors] compteur écoles:", err)
		}
		for _, row := range rows {
			counts[row.SectorID] = row.Count
		}

		var cons []models.User
		if err := database.DB.Select("sector_id", "full_name").
			Where("role = ? AND active = ? AND sector_id IN ?",
				models.RoleConseiller, true, ids).
			Order("full_name ASC").Find(&cons).Error; err != nil {
			log.Println("[sectors] conseillers affectés:", err)
		}
		for _, c := range cons {
			if c.SectorID != nil && *c.SectorID != "" {
				conseillerNames[*c.SectorID] = append(conseillerNames[*c.SectorID], c.FullName)
			}
		}
	}

	result := make([]SectorWithStats, 0, len(sectors))
	for _, s := range sectors {
		// Fix session 27 : une slice Go nil est sérialisée « null » en JSON —
		// le frontend lit .length (badge conseillers) et l'application
		// plantait (« a client-side exception ») dès l'ouverture de la plage
		// Secteurs tant qu'aucun conseiller n'était affecté. On force [].
		cons := conseillerNames[s.ID]
		if cons == nil {
			cons = []string{}
		}
		result = append(result, SectorWithStats{
			Sector:      s,
			SchoolCount: counts[s.ID],
			Conseillers: cons,
		})
	}

	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"sectors": result,
		"count":   len(result),
	})
}

// sectorRequest — payload de création / modification.
type sectorRequest struct {
	IEPID    string `json:"iep_id"`
	Name     string `json:"name"`
	Position *int   `json:"position,omitempty"` // pointeur : absent = inchangé
}

// CreateSector — POST /api/sectors {iep_id, name, position?}.
func CreateSector(w http.ResponseWriter, r *http.Request) {
	var req sectorRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		middleware.JSONError(w, "payload invalide", http.StatusBadRequest)
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" || req.IEPID == "" {
		middleware.JSONError(w, "nom et iep_id requis", http.StatusBadRequest)
		return
	}
	// L'IEP doit exister (évite les secteurs orphelins).
	var iep models.IEP
	if err := database.DB.First(&iep, "id = ?", req.IEPID).Error; err != nil {
		middleware.JSONError(w, "IEP introuvable — créez l'inspection avant d'y ajouter un secteur", http.StatusBadRequest)
		return
	}
	// Unicité du nom au sein de l'IEP (le secteur s'affiche sur les écoles).
	var existing int64
	database.DB.Model(&models.Sector{}).
		Where("iep_id = ? AND LOWER(name) = LOWER(?)", req.IEPID, req.Name).
		Count(&existing)
	if existing > 0 {
		middleware.JSONError(w, "un secteur de ce nom existe déjà dans cette IEP", http.StatusConflict)
		return
	}
	position := 0
	if req.Position != nil {
		position = *req.Position
	}
	sector := models.Sector{IEPID: req.IEPID, Name: req.Name, Position: position}
	if err := database.DB.Create(&sector).Error; err != nil {
		middleware.JSONError(w, "erreur création secteur", http.StatusInternalServerError)
		return
	}
	LogAction(r, "sector.created", "sector", &sector.ID, map[string]interface{}{
		"name": sector.Name,
	})
	jsonResponse(w, http.StatusCreated, sector)
}

// UpdateSector — PUT /api/sectors/{id} {name?, position?}.
func UpdateSector(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req sectorRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		middleware.JSONError(w, "payload invalide", http.StatusBadRequest)
		return
	}
	var sector models.Sector
	if err := database.DB.First(&sector, "id = ?", id).Error; err != nil {
		middleware.JSONError(w, "secteur introuvable", http.StatusNotFound)
		return
	}
	if name := strings.TrimSpace(req.Name); name != "" && name != sector.Name {
		var existing int64
		database.DB.Model(&models.Sector{}).
			Where("iep_id = ? AND LOWER(name) = LOWER(?) AND id != ?", sector.IEPID, name, id).
			Count(&existing)
		if existing > 0 {
			middleware.JSONError(w, "un secteur de ce nom existe déjà dans cette IEP", http.StatusConflict)
			return
		}
		sector.Name = name
	}
	if req.Position != nil {
		sector.Position = *req.Position
	}
	if err := database.DB.Save(&sector).Error; err != nil {
		middleware.JSONError(w, "erreur mise à jour", http.StatusInternalServerError)
		return
	}
	jsonResponse(w, http.StatusOK, sector)
}

// DeleteSector — DELETE /api/sectors/{id}.
// Refusé (409) tant que des écoles ou des conseillers y sont rattachés :
// supprimer un secteur non vidé ferait perdre silencieusement leur
// périmètre aux conseillers et le rattachement des écoles.
func DeleteSector(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var sector models.Sector
	if err := database.DB.First(&sector, "id = ?", id).Error; err != nil {
		middleware.JSONError(w, "secteur introuvable", http.StatusNotFound)
		return
	}
	var schoolCount int64
	database.DB.Model(&models.School{}).Where("sector_id = ?", id).Count(&schoolCount)
	if schoolCount > 0 {
		middleware.JSONError(w, "impossible de supprimer : des écoles sont rattachées à ce secteur (détachez-les d'abord)", http.StatusConflict)
		return
	}
	var consCount int64
	database.DB.Model(&models.User{}).
		Where("role = ? AND sector_id = ?", models.RoleConseiller, id).Count(&consCount)
	if consCount > 0 {
		middleware.JSONError(w, "impossible de supprimer : des conseillers sont affectés à ce secteur (retirez-les d'abord)", http.StatusConflict)
		return
	}
	if err := database.DB.Delete(&models.Sector{}, "id = ?", id).Error; err != nil {
		middleware.JSONError(w, "erreur suppression", http.StatusInternalServerError)
		return
	}
	LogAction(r, "sector.deleted", "sector", &id, map[string]interface{}{
		"name": sector.Name,
	})
	jsonResponse(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// setSectorSchoolsRequest — payload de l'affectation des écoles.
type setSectorSchoolsRequest struct {
	SchoolIDs []string `json:"school_ids"`
}

// SetSectorSchools — PUT /api/sectors/{id}/schools {school_ids: [...]}.
// Remplacement complet (sémantique « cochées ») : les écoles du secteur non
// listées sont détachées, celles listées sont rattachées. Toutes les écoles
// doivent appartenir à l'IEP du secteur (cohérence de l'arborescence).
func SetSectorSchools(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req setSectorSchoolsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		middleware.JSONError(w, "payload invalide", http.StatusBadRequest)
		return
	}
	var sector models.Sector
	if err := database.DB.First(&sector, "id = ?", id).Error; err != nil {
		middleware.JSONError(w, "secteur introuvable", http.StatusNotFound)
		return
	}

	// Dédoublonnage de la liste reçue.
	unique := make([]string, 0, len(req.SchoolIDs))
	seen := make(map[string]bool, len(req.SchoolIDs))
	for _, sid := range req.SchoolIDs {
		if sid == "" || seen[sid] {
			continue
		}
		seen[sid] = true
		unique = append(unique, sid)
	}

	// Validation : les écoles doivent exister ET appartenir à l'IEP du secteur.
	if len(unique) > 0 {
		var schools []models.School
		if err := database.DB.Select("id", "name", "iep_id").
			Where("id IN ?", unique).Find(&schools).Error; err != nil {
			middleware.JSONError(w, "erreur vérification des écoles", http.StatusInternalServerError)
			return
		}
		if len(schools) != len(unique) {
			middleware.JSONError(w, "certaines écoles sont introuvables", http.StatusBadRequest)
			return
		}
		for _, s := range schools {
			if s.IEPID != sector.IEPID {
				middleware.JSONError(w, "l'école "+s.Name+" n'appartient pas à l'IEP du secteur", http.StatusBadRequest)
				return
			}
		}
	}

	// Transaction : détacher les écoles sortantes, rattacher les entrantes.
	err := database.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&models.School{}).
			Where("sector_id = ?", id).
			Update("sector_id", nil).Error; err != nil {
			return err
		}
		if len(unique) > 0 {
			return tx.Model(&models.School{}).
				Where("id IN ?", unique).
				Update("sector_id", id).Error
		}
		return nil
	})
	if err != nil {
		middleware.JSONError(w, "erreur affectation des écoles", http.StatusInternalServerError)
		return
	}
	LogAction(r, "sector.schools_updated", "sector", &id, map[string]interface{}{
		"name":         sector.Name,
		"school_count": len(unique),
	})
	jsonResponse(w, http.StatusOK, map[string]interface{}{"status": "ok", "school_count": len(unique)})
}

// setSectorConseillersRequest — payload de l'affectation des conseillers.
type setSectorConseillersRequest struct {
	UserIDs []string `json:"user_ids"`
}

// SetSectorConseillers — PUT /api/sectors/{id}/conseillers {user_ids: [...]}.
// Remplacement complet (sémantique « cochées ») : users.sector_id est mis à
// NULL pour les conseillers retirés, renseigné pour les affectés. Seuls les
// comptes role=conseiller ACTIFS sont acceptés.
func SetSectorConseillers(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req setSectorConseillersRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		middleware.JSONError(w, "payload invalide", http.StatusBadRequest)
		return
	}
	var sector models.Sector
	if err := database.DB.First(&sector, "id = ?", id).Error; err != nil {
		middleware.JSONError(w, "secteur introuvable", http.StatusNotFound)
		return
	}

	// Dédoublonnage.
	unique := make([]string, 0, len(req.UserIDs))
	seen := make(map[string]bool, len(req.UserIDs))
	for _, uid := range req.UserIDs {
		if uid == "" || seen[uid] {
			continue
		}
		seen[uid] = true
		unique = append(unique, uid)
	}

	// Validation : les utilisateurs doivent exister, être des conseillers
	// actifs (un directeur/enseignant ne peut pas être « affecté » à un
	// secteur — son périmètre est son école).
	if len(unique) > 0 {
		var users []models.User
		if err := database.DB.Select("id", "full_name", "role", "active").
			Where("id IN ?", unique).Find(&users).Error; err != nil {
			middleware.JSONError(w, "erreur vérification des conseillers", http.StatusInternalServerError)
			return
		}
		if len(users) != len(unique) {
			middleware.JSONError(w, "certains comptes sont introuvables", http.StatusBadRequest)
			return
		}
		for _, u := range users {
			if u.Role != models.RoleConseiller {
				middleware.JSONError(w, u.FullName+" n'est pas un compte conseiller", http.StatusBadRequest)
				return
			}
			if !u.Active {
				middleware.JSONError(w, "le compte conseiller "+u.FullName+" est suspendu", http.StatusBadRequest)
				return
			}
		}
	}

	// Transaction : détacher les conseillers sortants, affecter les entrants.
	err := database.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&models.User{}).
			Where("role = ? AND sector_id = ?", models.RoleConseiller, id).
			Update("sector_id", nil).Error; err != nil {
			return err
		}
		if len(unique) > 0 {
			return tx.Model(&models.User{}).
				Where("id IN ?", unique).
				Update("sector_id", id).Error
		}
		return nil
	})
	if err != nil {
		middleware.JSONError(w, "erreur affectation des conseillers", http.StatusInternalServerError)
		return
	}
	LogAction(r, "sector.conseillers_updated", "sector", &id, map[string]interface{}{
		"name":             sector.Name,
		"conseiller_count": len(unique),
	})
	jsonResponse(w, http.StatusOK, map[string]interface{}{"status": "ok", "conseiller_count": len(unique)})
}

// ConseillerStaffMember — personnel du secteur (directeur ou adjoint).
type ConseillerStaffMember struct {
	models.User
	SchoolName string `json:"school_name,omitempty"`
	SchoolCode string `json:"school_code,omitempty"`
}

// ConseillerStaff — GET /api/conseiller/staff
//
// Vue « Mon Secteur » du conseiller (périmètre STRICT — demande utilisateur :
// « ces conseillers pourront voir seulement leurs directeurs et leurs
// adjoints aux directeurs ») :
//   - conseiller : son secteur est déduit de users.sector_id (serveur) ;
//   - admin / inspector : ?sector_id=... (assistance/contrôle) ;
//   - autres rôles : 403.
//
// Réponse : secteur + écoles du secteur + personnel (directeurs ET adjoints
// au directeur ACTIFS des écoles du secteur).
func ConseillerStaff(w http.ResponseWriter, r *http.Request) {
	role := ctxRole(r)
	var sectorID string
	switch role {
	case models.RoleConseiller:
		var me models.User
		if err := database.DB.Select("sector_id").First(&me, "id = ?", ctxUserID(r)).Error; err != nil {
			middleware.JSONError(w, "compte introuvable", http.StatusUnauthorized)
			return
		}
		if me.SectorID == nil || *me.SectorID == "" {
			// Aucun secteur encore affecté — réponse vide (l'UI affiche
			// « aucun secteur ne vous est encore affecté »).
			jsonResponse(w, http.StatusOK, map[string]interface{}{
				"sector":  nil,
				"schools": []interface{}{},
				"staff":   []interface{}{},
			})
			return
		}
		sectorID = *me.SectorID
	case models.RoleAdmin, models.RoleInspector:
		sectorID = r.URL.Query().Get("sector_id")
		if sectorID == "" {
			middleware.JSONError(w, "sector_id requis pour ce rôle", http.StatusBadRequest)
			return
		}
		// L'inspector ne consulte que les secteurs de SON IEP.
		if role == models.RoleInspector {
			var sector models.Sector
			if err := database.DB.Select("iep_id").First(&sector, "id = ?", sectorID).Error; err != nil {
				middleware.JSONError(w, "secteur introuvable", http.StatusNotFound)
				return
			}
			if sector.IEPID != ctxIEPID(r) {
				middleware.JSONError(w, "accès refusé : ce secteur relève d'une autre IEP", http.StatusForbidden)
				return
			}
		}
	default:
		middleware.JSONError(w, "accès refusé : cette vue est réservée aux conseillers", http.StatusForbidden)
		return
	}

	var sector models.Sector
	if err := database.DB.First(&sector, "id = ?", sectorID).Error; err != nil {
		middleware.JSONError(w, "secteur introuvable", http.StatusNotFound)
		return
	}

	// Écoles du secteur.
	var schools []models.School
	if err := database.DB.Where("sector_id = ?", sectorID).
		Order("name ASC").Find(&schools).Error; err != nil {
		middleware.JSONError(w, "erreur récupération des écoles du secteur", http.StatusInternalServerError)
		return
	}

	schoolIDs := make([]string, len(schools))
	for i, s := range schools {
		schoolIDs[i] = s.ID
	}

	// Statistiques des écoles du secteur (demande utilisateur session 27 :
	// « ajouter des statistiques des écoles » à la vue Mon Secteur) — mêmes
	// agrégats GROUP BY que la liste des écoles, même piège gorm : une slice
	// DISTINCTE par Scan (gorm réutilise la slice passée en paramètre).
	classCounts := make(map[string]int64, len(schools))
	studentCounts := make(map[string]int64, len(schools))
	if len(schoolIDs) > 0 {
		type idCount struct {
			SchoolID string `json:"school_id"`
			Count    int64  `json:"count"`
		}
		var classRows []idCount
		if err := database.DB.Model(&models.Class{}).
			Select("school_id", "COUNT(*) AS count").
			Where("school_id IN ?", schoolIDs).
			Group("school_id").
			Scan(&classRows).Error; err != nil {
			log.Println("[conseiller] compteur classes:", err)
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
			log.Println("[conseiller] compteur élèves:", err)
		}
		for _, row := range studentRows {
			studentCounts[row.SchoolID] = row.Count
		}
	}

	var totalClasses, totalStudents int64
	schoolsView := make([]map[string]interface{}, 0, len(schools))
	for _, s := range schools {
		totalClasses += classCounts[s.ID]
		totalStudents += studentCounts[s.ID]
		schoolsView = append(schoolsView, map[string]interface{}{
			"id":     s.ID,
			"code":   s.Code,
			"name":   s.Name,
			"status": s.Status,
			// Statistiques par école (cartes Mon Secteur)
			"class_count":   classCounts[s.ID],
			"student_count": studentCounts[s.ID],
		})
	}

	// Personnel du secteur : directeurs ET adjoints au directeur ACTIFS des
	// écoles du secteur (roles director + teacher — l'adjoint au directeur
	// est un compte teacher dans SYGREN, cf. libellés RBAC).
	var staff []models.User
	if len(schoolIDs) > 0 {
		if err := database.DB.
			Where("school_id IN ? AND role IN ? AND active = ?",
				schoolIDs, []string{models.RoleDirector, models.RoleTeacher}, true).
			Order("full_name ASC").Find(&staff).Error; err != nil {
			middleware.JSONError(w, "erreur récupération du personnel", http.StatusInternalServerError)
			return
		}
	}
	schoolName := make(map[string]string, len(schools))
	schoolCode := make(map[string]string, len(schools))
	for _, s := range schools {
		schoolName[s.ID] = s.Name
		schoolCode[s.ID] = s.Code
	}
	staffView := make([]ConseillerStaffMember, 0, len(staff))
	for _, u := range staff {
		m := ConseillerStaffMember{User: u}
		if u.SchoolID != nil {
			m.SchoolName = schoolName[*u.SchoolID]
			m.SchoolCode = schoolCode[*u.SchoolID]
		}
		staffView = append(staffView, m)
	}

	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"sector": map[string]interface{}{
			"id":     sector.ID,
			"name":   sector.Name,
			"iep_id": sector.IEPID,
		},
		"schools": schoolsView,
		"staff":   staffView,
		"counts": map[string]int64{
			"schools":  int64(len(schools)),
			"staff":    int64(len(staffView)),
			"classes":  totalClasses,
			"students": totalStudents,
		},
	})
}
