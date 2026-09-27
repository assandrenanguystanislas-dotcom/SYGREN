package handlers

// === Fichier du personnel (module "staff-data", Task 55) ===
//
// Fichier administratif EXCEL à compléter à tout moment : chaque ligne
// porte les 15 colonnes demandées — N° (ordre d'affichage, calculé par
// le client), SECTEUR, ÉCOLES, NOM ET PRÉNOM, SEXE, DATE DE NAISSANCE,
// LIEU DE NAISSANCE, CATÉGORIE, MATRICULE, DATE D'ENTREE FP, ANCIENNETÉ,
// COURS, FONCTION, CONTACT, EFFECTIF.
//
// Contrairement au dossier personnel des comptes (Utilisateurs), ce
// fichier est INDÉPENDANT des comptes users : il peut lister des agents
// sans compte SYGREN et se complète directement dans son module. Il est
// pré-rempli une seule fois au démarrage (seed one-shot, voir
// database.seedStaffRecords) depuis les dossiers personnels des
// directeurs et adjoints au directeur actifs.
//
// Réutilise les validations du dossier personnel (validSexe,
// validCategorie, validFonction, validCours, parseDossierDate,
// cleanDossierStr — handlers/personnel.go) pour la cohérence des codes.
//
// RBAC : routes protégées par RequireModule(models.ModuleStaffData, ...)
// — lecture+écriture : admin + inspector (le directeur garde son État
// nominatif d'école ; le conseiller est bloqué par ConseillerScope).

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"gorm.io/gorm"

	"sygren-api/database"
	"sygren-api/middleware"
	"sygren-api/models"
)

// StaffRecordInput — payload complet d'une ligne du fichier (create et
// update). Le client envoie TOUJOURS l'objet entier (même convention que
// le dossier personnel) : chaîne vide = valeur effacée. Les dates
// arrivent en "YYYY-MM-DD" (input date) ou RFC3339 (écho d'une valeur
// reçue de l'API).
type StaffRecordInput struct {
	SectorID      *string `json:"sector_id"`
	SchoolID      *string `json:"school_id"`
	FullName      string  `json:"full_name"`
	Sexe          *string `json:"sexe"`
	DateNaissance *string `json:"date_naissance"`
	LieuNaissance *string `json:"lieu_naissance"`
	Categorie     *string `json:"categorie"`
	Matricule     *string `json:"matricule"`
	DateEntreeFP  *string `json:"date_entree_fp"`
	Anciennete    *string `json:"anciennete"`
	Cours         *string `json:"cours"`
	Fonction      *string `json:"fonction"`
	Contact       *string `json:"contact"`
	Effectif      *int    `json:"effectif"`
}

// applyStaffRecordFields valide le payload et applique les 14 colonnes à
// une ligne du fichier (create comme update). Erreur explicite si une
// valeur de liste déroulante est invalide ou si une date est mal formée.
func applyStaffRecordFields(rec *models.StaffRecord, in StaffRecordInput) error {
	if in.FullName == "" {
		return errStaffFullNameRequired
	}

	// Secteur — chaîne vide = aucun secteur (à compléter plus tard).
	rec.SectorID = cleanDossierStr(in.SectorID)
	// École — chaîne vide = aucune école (à compléter plus tard).
	rec.SchoolID = cleanDossierStr(in.SchoolID)
	rec.FullName = in.FullName
	rec.Sexe = nil
	if in.Sexe != nil && *in.Sexe != "" {
		if !validSexe[*in.Sexe] {
			return errStaffEnum("sexe")
		}
		rec.Sexe = in.Sexe
	}
	birth, err := parseDossierDate(in.DateNaissance)
	if err != nil {
		return errStaffDate("date de naissance")
	}
	rec.DateNaissance = birth
	rec.LieuNaissance = cleanDossierStr(in.LieuNaissance)

	rec.Categorie = nil
	if in.Categorie != nil && *in.Categorie != "" {
		if !validCategorie[*in.Categorie] {
			return errStaffEnum("catégorie")
		}
		rec.Categorie = in.Categorie
	}
	rec.Matricule = cleanDossierStr(in.Matricule)

	entry, err := parseDossierDate(in.DateEntreeFP)
	if err != nil {
		return errStaffDate("date d'entrée FP")
	}
	rec.DateEntreeFP = entry
	rec.Anciennete = cleanDossierStr(in.Anciennete)

	rec.Cours = nil
	if in.Cours != nil && *in.Cours != "" {
		if !validCours[*in.Cours] {
			return errStaffEnum("cours")
		}
		rec.Cours = in.Cours
	}
	rec.Fonction = nil
	if in.Fonction != nil && *in.Fonction != "" {
		if !validFonction[*in.Fonction] {
			return errStaffEnum("fonction")
		}
		rec.Fonction = in.Fonction
	}
	rec.Contact = cleanDossierStr(in.Contact)
	rec.Effectif = nil
	if in.Effectif != nil && *in.Effectif > 0 {
		rec.Effectif = in.Effectif
	}
	return nil
}

// Erreurs de validation — messages 100 % français (convention SYGREN).
var errStaffFullNameRequired = &staffError{"le nom et prénom de l'agent est requis"}

type staffError struct{ msg string }

func (e *staffError) Error() string { return e.msg }

func errStaffEnum(field string) error {
	return &staffError{"valeur invalide pour « " + field + " » — utilisez la liste déroulante"}
}

func errStaffDate(field string) error {
	return &staffError{"date invalide (« " + field + " »)"}
}

// ListStaffRecords retourne les lignes du fichier du personnel.
// Query : ?q=recherche (nom, matricule, contact, lieu de naissance,
// nom d'école), ?sector_id= filtrage par secteur et ?school_id=
// filtrage par école (Task 65 — bouton de sélection des écoles du
// module Fichier du personnel). Tri : ordre de
// saisie (created_at), le N° affiché = position dans la liste.
func ListStaffRecords(w http.ResponseWriter, r *http.Request) {
	query := database.DB.Model(&models.StaffRecord{})
	if q := r.URL.Query().Get("q"); q != "" {
		pattern := "%" + q + "%"
		// LOWER() : compatible SQLite (dev) ET PostgreSQL (prod).
		// La recherche par école passe par une sous-requête sur
		// le NOM de l'école (staff_records porte school_id).
		query = query.Where(
			"LOWER(full_name) LIKE ? OR LOWER(matricule) LIKE ? OR LOWER(contact) LIKE ? OR LOWER(lieu_naissance) LIKE ? OR school_id IN (SELECT id FROM schools WHERE LOWER(name) LIKE ?)",
			pattern, pattern, pattern, pattern, pattern,
		)
	}
	if sectorID := r.URL.Query().Get("sector_id"); sectorID != "" {
		query = query.Where("sector_id = ?", sectorID)
	}
	// Task 65 — filtrage par école : même mécanique que le secteur,
	// combiné en ET (une école appartient à un secteur).
	if schoolID := r.URL.Query().Get("school_id"); schoolID != "" {
		query = query.Where("school_id = ?", schoolID)
	}
	var records []models.StaffRecord
	if err := query.Order("created_at ASC").Find(&records).Error; err != nil {
		middleware.JSONError(w, "erreur récupération du fichier du personnel", http.StatusInternalServerError)
		return
	}
	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"staff_records": records,
		"count":         len(records),
	})
}

// CreateStaffRecord ajoute une ligne au fichier du personnel.
func CreateStaffRecord(w http.ResponseWriter, r *http.Request) {
	var req StaffRecordInput
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		middleware.JSONError(w, "payload invalide", http.StatusBadRequest)
		return
	}
	rec := models.StaffRecord{}
	if err := applyStaffRecordFields(&rec, req); err != nil {
		middleware.JSONError(w, err.Error(), http.StatusBadRequest)
		return
	}
	if err := database.DB.Create(&rec).Error; err != nil {
		middleware.JSONError(w, "erreur création de la ligne du fichier", http.StatusInternalServerError)
		return
	}
	LogAction(r, "staff_record.created", "staff_record", &rec.ID, map[string]interface{}{
		"full_name": rec.FullName,
	})
	jsonResponse(w, http.StatusCreated, rec)
}

// UpdateStaffRecord met à jour une ligne du fichier du personnel.
func UpdateStaffRecord(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req StaffRecordInput
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		middleware.JSONError(w, "payload invalide", http.StatusBadRequest)
		return
	}
	var rec models.StaffRecord
	if err := database.DB.First(&rec, "id = ?", id).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			middleware.JSONError(w, "ligne du fichier introuvable", http.StatusNotFound)
			return
		}
		middleware.JSONError(w, "erreur récupération", http.StatusInternalServerError)
		return
	}
	if err := applyStaffRecordFields(&rec, req); err != nil {
		middleware.JSONError(w, err.Error(), http.StatusBadRequest)
		return
	}
	if err := database.DB.Save(&rec).Error; err != nil {
		middleware.JSONError(w, "erreur mise à jour de la ligne du fichier", http.StatusInternalServerError)
		return
	}
	LogAction(r, "staff_record.updated", "staff_record", &id, map[string]interface{}{
		"full_name": rec.FullName,
	})
	jsonResponse(w, http.StatusOK, rec)
}

// DeleteStaffRecord supprime une ligne du fichier du personnel
// (soft-delete — la ligne disparaît du fichier mais reste récupérable
// en base).
func DeleteStaffRecord(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var rec models.StaffRecord
	if err := database.DB.First(&rec, "id = ?", id).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			middleware.JSONError(w, "ligne du fichier introuvable", http.StatusNotFound)
			return
		}
		middleware.JSONError(w, "erreur récupération", http.StatusInternalServerError)
		return
	}
	if err := database.DB.Delete(&rec).Error; err != nil {
		middleware.JSONError(w, "erreur suppression de la ligne du fichier", http.StatusInternalServerError)
		return
	}
	LogAction(r, "staff_record.deleted", "staff_record", &id, map[string]interface{}{
		"full_name": rec.FullName,
	})
	jsonResponse(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// staffSyncAgent — agent de l'état nominatif à reporter dans le fichier.
type staffSyncAgent struct {
	ID            string
	FullName      string
	Phone         *string
	SectorID      *string
	SchoolID      *string
	Matricule     *string
	Sexe          *string
	DateNaissance *time.Time
	LieuNaissance *string
	Categorie     *string
	DateEntreeFP  *time.Time
	Cours         *string
	Fonction      *string
	EffectifF     *int
	EffectifG     *int
	EffectifT     *int
}

// staffSyncNormKey — clé de comparaison (minuscules, espaces réduits).
func staffSyncNormKey(s string) string {
	return strings.Join(strings.Fields(strings.ToLower(strings.TrimSpace(s))), " ")
}

// SyncStaffRecords — POST /api/staff-records/sync (Task 64 — demande
// utilisateur : « il y a des agents qui sont dans l'état nominatif qu'on
// ne retrouve pas dans le fichier du personnel »).
//
// Le fichier du personnel est pré-rempli ONE-SHOT au démarrage (seed
// Task 55) : tout agent ajouté (ou réactivé) APRÈS ce seed manque au
// fichier. Ce complément, déclenchable à tout moment (bouton du module),
// ajoute chaque agent de l'ÉTAT NOMINATIF absent du fichier — même
// population et même mapping que le seed :
//   - population : comptes directeur + enseignant (actifs comme
//     suspendus — un agent en congé figure sur la feuille) ;
//   - rattachement : même matricule, ou même école + même nom (clés
//     normalisées) — jamais de mise à jour ni de suppression des lignes
//     existantes (le fichier appartient à ses utilisateurs) ;
//   - mapping : secteur du dossier, sinon celui de l'école ; effectif du
//     cours tenu (T, sinon F+G) ; contact = téléphone du dossier.
//
// Idempotent : un second appel sans nouveaux agents ne crée rien.
func SyncStaffRecords(w http.ResponseWriter, r *http.Request) {
	var agents []staffSyncAgent
	if err := database.DB.Model(&models.User{}).
		Select("id, full_name, phone, sector_id, school_id, matricule, sexe, date_naissance, lieu_naissance, categorie, date_entree_fp, cours, fonction, effectif_f, effectif_g, effectif_t").
		Where("role IN ? AND deleted_at IS NULL",
			[]string{models.RoleDirector, models.RoleTeacher}).
		Order("full_name ASC").
		Scan(&agents).Error; err != nil {
		middleware.JSONError(w, "erreur lecture des dossiers du personnel", http.StatusInternalServerError)
		return
	}

	var recs []models.StaffRecord
	if err := database.DB.Find(&recs).Error; err != nil {
		middleware.JSONError(w, "erreur lecture du fichier du personnel", http.StatusInternalServerError)
		return
	}
	// Clés des lignes existantes : matricule (global) et école+nom.
	matKeys := make(map[string]bool, len(recs))
	nameSchoolKeys := make(map[string]bool, len(recs))
	for _, rec := range recs {
		if m := staffSyncNormKey(derefStr(rec.Matricule)); m != "" {
			matKeys[m] = true
		}
		nameSchoolKeys[normNameSchoolKey(staffSyncNormKey(rec.FullName), rec.SchoolID)] = true
	}

	// Secteur de chaque école (déduction comme au seed).
	schoolSector := map[string]*string{}
	var schools []models.School
	if err := database.DB.Select("id, sector_id").Find(&schools).Error; err == nil {
		for _, sc := range schools {
			schoolSector[sc.ID] = sc.SectorID
		}
	}

	created := 0
	for _, a := range agents {
		if m := staffSyncNormKey(derefStr(a.Matricule)); m != "" && matKeys[m] {
			continue // même matricule : déjà dans le fichier
		}
		if nameSchoolKeys[normNameSchoolKey(staffSyncNormKey(a.FullName), a.SchoolID)] {
			continue // même école + même nom : déjà dans le fichier
		}
		sectorID := a.SectorID
		if sectorID == nil && a.SchoolID != nil {
			sectorID = schoolSector[*a.SchoolID]
		}
		rec := models.StaffRecord{
			SectorID:      sectorID,
			SchoolID:      a.SchoolID,
			FullName:      a.FullName,
			Sexe:          a.Sexe,
			DateNaissance: a.DateNaissance,
			LieuNaissance: a.LieuNaissance,
			Categorie:     a.Categorie,
			Matricule:     a.Matricule,
			DateEntreeFP:  a.DateEntreeFP,
			Cours:         a.Cours,
			Fonction:      a.Fonction,
			Contact:       a.Phone,
		}
		// EFFECTIF — total du cours tenu (T), sinon F+G.
		if a.EffectifT != nil && *a.EffectifT > 0 {
			rec.Effectif = a.EffectifT
		} else if a.EffectifF != nil || a.EffectifG != nil {
			sum := 0
			if a.EffectifF != nil {
				sum += *a.EffectifF
			}
			if a.EffectifG != nil {
				sum += *a.EffectifG
			}
			rec.Effectif = &sum
		}
		if err := database.DB.Create(&rec).Error; err != nil {
			middleware.JSONError(w, "erreur ajout de l'agent au fichier", http.StatusInternalServerError)
			return
		}
		if m := staffSyncNormKey(derefStr(a.Matricule)); m != "" {
			matKeys[m] = true
		}
		nameSchoolKeys[normNameSchoolKey(staffSyncNormKey(a.FullName), a.SchoolID)] = true
		created++
	}

	LogAction(r, "staff_records.synced", "staff_record", nil, map[string]interface{}{
		"agents": len(agents), "created": created, "existing": len(recs),
	})
	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"status":   "ok",
		"agents":   len(agents),
		"created":  created,
		"existing": len(recs),
	})
}

// normNameSchoolKey — clé « nom @ école » (école vide = "_").
func normNameSchoolKey(name string, schoolID *string) string {
	sid := "_"
	if schoolID != nil && *schoolID != "" {
		sid = *schoolID
	}
	return name + "@" + sid
}
