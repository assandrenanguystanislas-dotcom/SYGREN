package handlers

// === Dossier personnel des agents (module Utilisateurs) ===
//
// Document officiel « ÉTAT NOMINATIF DU PERSONNEL » : chaque agent
// (directeur ou enseignant) porte un dossier administratif — matricule,
// date et lieu de naissance, catégorie (IO IA IS IAS), classe (1..4),
// échelon (1..4), dates d'entrée (F.P / DREN / IEP), fonction
// (DIRECTEUR | ADJOINT(E)), sexe (F | G), effectif et redoublants du
// cours tenu (F/G/T).
//
// PersonnelDossierInput est embarqué (pointeur) dans les payloads
// create/update des enseignants et des directeurs : nil = dossier non
// touché (compatibilité avec les clients existants), non-nil = mise à
// jour COMPLÈTE du dossier (le frontend envoie toujours le dossier
// entier — un champ vide efface la valeur stockée).

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

// PersonnelDossierInput — payload du dossier personnel.
// Les dates arrivent en "YYYY-MM-DD" (listes déroulantes Jour/Mois/Année
// du formulaire) ; vide = non renseignée.
type PersonnelDossierInput struct {
	Matricule      *string `json:"matricule"`
	Sexe           *string `json:"sexe"`
	DateNaissance  *string `json:"date_naissance"`
	LieuNaissance  *string `json:"lieu_naissance"`
	Categorie      *string `json:"categorie"`
	ClasseGrade    *int    `json:"classe_grade"`
	Echelon        *int    `json:"echelon"`
	DateEntreeFP   *string `json:"date_entree_fp"`
	Fonction       *string `json:"fonction"`
	DateEntreeDREN *string `json:"date_entree_dren"`
	DateEntreeIEP  *string `json:"date_entree_iep"`
	EffectifF      *int    `json:"effectif_f"`
	EffectifG      *int    `json:"effectif_g"`
	EffectifT      *int    `json:"effectif_t"`
	RedoublantF    *int    `json:"redoublant_f"`
	RedoublantG    *int    `json:"redoublant_g"`
	RedoublantT    *int    `json:"redoublant_t"`
}

var (
	validSexe      = map[string]bool{"F": true, "G": true}
	validCategorie = map[string]bool{"IO": true, "IA": true, "IS": true, "IAS": true}
	validFonction  = map[string]bool{"DIRECTEUR": true, "ADJOINT(E)": true}
)

// classRank retourne l'ordre pédagogique d'un cours (CP1=1 … CM2=6),
// 0 si le nom est inconnu.
func classRank(name string) int {
	order := []string{"CP1", "CP2", "CE1", "CE2", "CM1", "CM2"}
	for i, n := range order {
		if strings.EqualFold(strings.TrimSpace(name), n) {
			return i + 1
		}
	}
	return 0
}

// parseDossierDate convertit une date ISO "YYYY-MM-DD" (peut être nil ou
// vide) en *time.Time (minuit UTC). Erreur si le format est invalide.
func parseDossierDate(s *string) (*time.Time, error) {
	if s == nil || *s == "" {
		return nil, nil
	}
	t, err := time.Parse("2006-01-02", strings.TrimSpace(*s))
	if err != nil {
		return nil, fmt.Errorf("date invalide (%q) — utilisez les listes déroulantes Jour/Mois/Année", *s)
	}
	return &t, nil
}

// cleanDossierStr : chaîne du dossier → pointeur (vide = nil, trim).
func cleanDossierStr(s *string) *string {
	if s == nil {
		return nil
	}
	v := strings.TrimSpace(*s)
	if v == "" {
		return nil
	}
	return &v
}

// cleanDossierInt : entier borné du dossier (nil autorisé = non renseigné).
func cleanDossierInt(n *int, lo, hi int, label string) (*int, error) {
	if n == nil {
		return nil, nil
	}
	if *n < lo || *n > hi {
		return nil, fmt.Errorf("%s doit être compris entre %d et %d", label, lo, hi)
	}
	return n, nil
}

// applyTo valide le dossier puis l'applique sur l'utilisateur.
func (in *PersonnelDossierInput) applyTo(u *models.User) error {
	matricule := cleanDossierStr(in.Matricule)

	sexe := cleanDossierStr(in.Sexe)
	if sexe != nil {
		*sexe = strings.ToUpper(*sexe)
		if !validSexe[*sexe] {
			return fmt.Errorf("sexe invalide — F ou G attendu")
		}
	}

	lieu := cleanDossierStr(in.LieuNaissance)

	categorie := cleanDossierStr(in.Categorie)
	if categorie != nil {
		*categorie = strings.ToUpper(*categorie)
		if !validCategorie[*categorie] {
			return fmt.Errorf("catégorie invalide — IO, IA, IS ou IAS attendu")
		}
	}

	fonction := cleanDossierStr(in.Fonction)
	if fonction != nil {
		*fonction = strings.ToUpper(*fonction)
		if !validFonction[*fonction] {
			return fmt.Errorf("fonction invalide — DIRECTEUR ou ADJOINT(E) attendu")
		}
	}

	classeGrade, err := cleanDossierInt(in.ClasseGrade, 1, 4, "la classe administrative")
	if err != nil {
		return err
	}
	echelon, err := cleanDossierInt(in.Echelon, 1, 4, "l'échelon")
	if err != nil {
		return err
	}

	effectifs := [3]*int{}
	for i, f := range []struct {
		n   *int
		lbl string
	}{{in.EffectifF, "l'effectif F"}, {in.EffectifG, "l'effectif G"}, {in.EffectifT, "l'effectif T"}} {
		v, err := cleanDossierInt(f.n, 0, 999, f.lbl)
		if err != nil {
			return err
		}
		effectifs[i] = v
	}
	redoublants := [3]*int{}
	for i, f := range []struct {
		n   *int
		lbl string
	}{{in.RedoublantF, "les redoublants F"}, {in.RedoublantG, "les redoublants G"}, {in.RedoublantT, "les redoublants T"}} {
		v, err := cleanDossierInt(f.n, 0, 999, f.lbl)
		if err != nil {
			return err
		}
		redoublants[i] = v
	}

	dNaissance, err := parseDossierDate(in.DateNaissance)
	if err != nil {
		return err
	}
	dFP, err := parseDossierDate(in.DateEntreeFP)
	if err != nil {
		return err
	}
	dDREN, err := parseDossierDate(in.DateEntreeDREN)
	if err != nil {
		return err
	}
	dIEP, err := parseDossierDate(in.DateEntreeIEP)
	if err != nil {
		return err
	}

	u.Matricule = matricule
	u.Sexe = sexe
	u.DateNaissance = dNaissance
	u.LieuNaissance = lieu
	u.Categorie = categorie
	u.ClasseGrade = classeGrade
	u.Echelon = echelon
	u.DateEntreeFP = dFP
	u.Fonction = fonction
	u.DateEntreeDREN = dDREN
	u.DateEntreeIEP = dIEP
	u.EffectifF = effectifs[0]
	u.EffectifG = effectifs[1]
	u.EffectifT = effectifs[2]
	u.RedoublantF = redoublants[0]
	u.RedoublantG = redoublants[1]
	u.RedoublantT = redoublants[2]
	return nil
}

// === GET /api/reports/personnel?school_id=… ===
//
// Données du document « ÉTAT NOMINATIF DU PERSONNEL » pour une école :
// école + IEP (en-tête officiel), année scolaire en cours et liste des
// agents — directeur d'abord, puis enseignants dans l'ordre des cours
// (CP1→CM2), puis agents sans cours, chacun enrichi du nom du cours tenu.
//
// RBAC de périmètre (comme /api/reports/synthese-data) :
//   - director  : uniquement son école
//   - inspector : uniquement les écoles de son IEP
//   - admin     : toutes les écoles

// PersonnelStaffRow — agent enrichi pour l'état nominatif.
type PersonnelStaffRow struct {
	models.User
	ClassName *string `json:"class_name,omitempty"` // cours tenu (CP1..CM2)
	SortKey   int     `json:"-"`                    // tri serveur (non sérialisé)
}

func GetPersonnelSheet(w http.ResponseWriter, r *http.Request) {
	schoolID := r.URL.Query().Get("school_id")
	if schoolID == "" {
		middleware.JSONError(w, "school_id est requis", http.StatusBadRequest)
		return
	}

	var school models.School
	if err := database.DB.First(&school, "id = ?", schoolID).Error; err != nil {
		middleware.JSONError(w, "école introuvable", http.StatusNotFound)
		return
	}

	role := ctxRole(r)
	switch role {
	case "director":
		if ctxSchoolID(r) != school.ID {
			middleware.JSONError(w, "accès refusé : état nominatif limité à votre école", http.StatusForbidden)
			return
		}
	case "inspector":
		if ctxIEPID(r) == "" || school.IEPID != ctxIEPID(r) {
			middleware.JSONError(w, "accès refusé : école hors de votre IEP", http.StatusForbidden)
			return
		}
	}

	var iep models.IEP
	database.DB.First(&iep, "id = ?", school.IEPID)

	// Agents de l'école : directeur + enseignants. L'état nominatif liste
	// le personnel (actifs comme suspendus — un agent en congé maladie
	// figure sur la feuille).
	var staff []models.User
	if err := database.DB.
		Where("school_id = ? AND role IN ?", school.ID,
			[]string{models.RoleDirector, models.RoleTeacher}).
		Order("full_name ASC").
		Find(&staff).Error; err != nil {
		middleware.JSONError(w, "erreur récupération du personnel", http.StatusInternalServerError)
		return
	}

	// Cours tenus (classe dont teacher_id = agent) — une seule requête.
	var classes []models.Class
	database.DB.
		Where("school_id = ? AND teacher_id IS NOT NULL", school.ID).
		Find(&classes)
	classNameByTeacher := make(map[string]string, len(classes))
	for _, c := range classes {
		if c.TeacherID == nil {
			continue
		}
		classNameByTeacher[*c.TeacherID] = c.Name
	}

	rows := make([]PersonnelStaffRow, 0, len(staff))
	for _, u := range staff {
		row := PersonnelStaffRow{User: u}
		if u.Role == models.RoleDirector {
			row.SortKey = 0 // directeur toujours en tête
		} else if rank := classRank(classNameByTeacher[u.ID]); rank > 0 {
			row.SortKey = 100 + rank // enseignants dans l'ordre des cours
		} else {
			row.SortKey = 200 // agents sans cours (RPL, adjoints…)
		}
		if n, ok := classNameByTeacher[u.ID]; ok {
			nn := n
			row.ClassName = &nn
		}
		rows = append(rows, row)
	}
	sort.SliceStable(rows, func(i, j int) bool {
		if rows[i].SortKey != rows[j].SortKey {
			return rows[i].SortKey < rows[j].SortKey
		}
		return rows[i].FullName < rows[j].FullName
	})

	// Année scolaire en cours (rentrée d'août/septembre → juillet) :
	// « 2025 2026 » comme sur le document reçu.
	now := time.Now()
	start := now.Year()
	if now.Month() < time.August {
		start--
	}

	jsonResponse(w, http.StatusOK, map[string]interface{}{
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
		"annee_scolaire": fmt.Sprintf("%d %d", start, start+1),
		"staff":          rows,
		"count":          len(rows),
	})
}
