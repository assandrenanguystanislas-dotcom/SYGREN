package handlers

// === Listes nominatives du personnel (module « Fichier du personnel »,
// Task 74 + affinages Task 75/76) ===
//
// Deux documents officiels à l'échelle de l'IEP — même entête que
// l'ÉTAT NOMINATIF DU PERSONNEL (bloc ministériel + République +
// armoiries, boîte du titre, ligne IEP / Année scolaire / Date) :
//
//   - « LISTE NOMINATIVE DES DIRECTEURS D'ECOLE » — une ligne par
//     directeur (role=director) avec son école, son code école et
//     l'EFFECTIF de l'école ;
//   - « LISTE NOMINATIVE DES MAITRES DE CM2 » — une ligne par agent
//     (enseignant ou directeur) tenant le CM2, avec son école, son
//     code école et l'EFFECTIF de son cours.
//
// Affinages Task 75 :
//   - SEULEMENT LES ENSEIGNANTS ISSUS DES EPP (Écoles Primaires
//     Publiques) : écoles dont le NOM commence par « EPP » — les
//     préscolaires publics (PRESCOLAIRE …), les écoles communautaires
//     (EC …) et les privées (EPC/EPI/EPV …) sont EXCLUS ;
//   - ORDRE ALPHABÉTIQUE des NOM ET PRENOMS (plus de regroupement
//     par école).
//
// Affinages Task 76 (colonne NIVEAU repensée) :
//   - MAÎTRES DE CM2 : la colonne NIVEAU est ANNULÉE (le document
//     reprend ses 8 colonnes d'origine) ;
//   - DIRECTEURS : NIVEAU = NOMBRE DE CLASSES DE L'ÉCOLE (classes
//     actives — même convention que sessions.go, classes.active =
//     true), case vide si l'école n'a aucune classe.
//
// Colonnes (ordre du modèle) :
//   - directeurs : N° | NOM ET PRENOMS | MATRICULE | DATE DE 1ERE
//     PRISE DE SERVICE | ECOLE | CODE ECOLE | EFFECTIF | NIVEAU |
//     EMARGEMENT (9 colonnes) ;
//   - maîtres CM2 : N° | NOM ET PRENOMS | MATRICULE | DATE DE 1ERE
//     PRISE DE SERVICE | ECOLE | CODE ECOLE | EFFECTIF | EMARGEMENT
//     (8 colonnes — sans NIVEAU).
//
// Conventions reprises de l'existant (aucune nouvelle règle) :
//   - DATE DE 1ERE PRISE DE SERVICE = date d'entrée à la FONCTION
//     PUBLIQUE du dossier personnel (users.date_entree_fp — libellé
//     « Date d'entrée à la F.P ») ;
//   - COURS TENU = champ explicite du dossier (users.cours, bande
//     déroulante PS MS GS · CP1..CM2 · RPL MAC) EN PRIORITÉ, sinon la
//     classe affectée (classes.teacher_id) — même résolution que
//     l'état nominatif (handlers/personnel.go) ;
//   - EFFECTIF D'APRÈS L'ÉTAT NOMINATIF (v14/v15 — même calcul que
//     Mon Secteur, handlers/sectors.go) : T saisi, sinon F+G ; par
//     école = somme des dossiers des agents + des niveaux déclarés
//     sans enseignant (staff_level_reports) dont le cours n'est pas
//     déjà tenu (le dossier reprend la main) ;
//   - les agents SUSPENDUS figurent sur les listes (comme sur l'état
//     nominatif — un agent en congé reste un agent) ; les comptes
//     supprimés sont exclus (soft-delete GORM).
//
// RBAC de périmètre (module staff-data — admin + inspector, même
// convention que /api/reports/personnel) :
//   - inspector : uniquement les écoles de son IEP ;
//   - admin     : toutes les écoles (?iep_id=… pour restreindre) ;
//   - les autres rôles : 403.

import (
        "fmt"
        "net/http"
        "sort"
        "strconv"
        "strings"
        "time"

        "sygren-api/database"
        "sygren-api/middleware"
        "sygren-api/models"
)

// PersonnelListRow — une ligne de liste nominative.
type PersonnelListRow struct {
        ID string `json:"id"`
        // Identité — NOM ET PRENOMS affiché en caractère d'imprimerie,
        // noms des femmes EN ROUGE (N.B du modèle, comme l'état nominatif).
        FullName string  `json:"full_name"`
        Sexe     *string `json:"sexe,omitempty"`
        // Matricule + DATE DE 1ERE PRISE DE SERVICE (dossier personnel).
        Matricule    *string    `json:"matricule,omitempty"`
        DateEntreeFP *time.Time `json:"date_entree_fp,omitempty"`
        // ECOLE + CODE ECOLE.
        SchoolName string `json:"school_name"`
        SchoolCode string `json:"school_code"`
        // EFFECTIF — école (directeurs) ou cours tenu (maîtres de CM2),
        // calculé d'après l'état nominatif du personnel. nil = non
        // renseigné (case vide du document).
        Effectif *int `json:"effectif,omitempty"`
        // NIVEAU — Task 76 : NOMBRE DE CLASSES DE L'ÉCOLE pour les
        // directeurs (« 6 ») ; colonne ANNULÉE pour les maîtres de CM2
        // (toujours nil — le document CM2 n'affiche pas la colonne).
        Niveau *string `json:"niveau,omitempty"`
        // Contexte dossier (fonction / cours tenu résolu) — utile au
        // document pour distinguer directeur titulaire CM2 et maître.
        Fonction *string `json:"fonction,omitempty"`
        Cours    *string `json:"cours,omitempty"`
        SchoolID string  `json:"school_id,omitempty"`
}

// effInt : pointeur entier → valeur (nil = 0).
func effInt(p *int) int {
        if p == nil {
                return 0
        }
        return *p
}

// effTotal — effectif TOTAL d'une ligne de dossier : T saisi, sinon
// F+G (convention v9 du dossier personnel, identique sectors.go).
func effTotal(f, g, t *int) int {
        if t != nil {
                return *t
        }
        return effInt(f) + effInt(g)
}

// anneeScolaireNow — « 2025 2026 » (rentrée d'août/septembre →
// juillet), même règle que l'état nominatif (handlers/personnel.go).
func anneeScolaireNow() string {
        now := time.Now()
        start := now.Year()
        if now.Month() < time.August {
                start--
        }
        return fmt.Sprintf("%d %d", start, start+1)
}

// personnelListScope — écoles du périmètre de l'appelant (admin :
// toutes, filtrées par ?iep_id=… si fourni ; inspector : son IEP).
// Retourne les écoles triées par nom et l'IEP de l'entête (celui du
// périmètre — premier iep_id rencontré). Les autres rôles sont
// refusés (403) : les listes vivent dans le module Fichier du
// personnel (admin + inspector).
func personnelListScope(r *http.Request) ([]models.School, *models.IEP, int, string) {
        role := ctxRole(r)
        switch role {
        case models.RoleAdmin, models.RoleInspector:
                // OK — périmètre résolu plus bas.
        default:
                return nil, nil, http.StatusForbidden, "accès refusé : listes nominatives réservées à l'Admin IEP et au Super Admin"
        }

        q := database.DB.Model(&models.School{})
        var iepID string
        if role == models.RoleInspector {
                iepID = ctxIEPID(r)
                if iepID == "" {
                        return nil, nil, http.StatusForbidden, "aucune IEP rattachée à votre compte"
                }
        } else if v := strings.TrimSpace(r.URL.Query().Get("iep_id")); v != "" {
                // Super Admin : restriction optionnelle à une IEP.
                iepID = v
        }
        if iepID != "" {
                q = q.Where("iep_id = ?", iepID)
        }
        var schools []models.School
        if err := q.Order("name ASC").Find(&schools).Error; err != nil {
                return nil, nil, http.StatusInternalServerError, "erreur récupération des écoles"
        }

        // IEP de l'entête : celui du périmètre (le premier rencontré).
        var iep models.IEP
        if iepID != "" {
                database.DB.First(&iep, "id = ?", iepID)
        } else if len(schools) > 0 {
                database.DB.First(&iep, "id = ?", schools[0].IEPID)
        }
        return schools, &iep, 0, ""
}

// schoolEffectifs — EFFECTIF D'APRÈS L'ÉTAT NOMINATIF de chaque école
// du périmètre (somme des cours tenus par les agents — T saisi, sinon
// F+G — et des niveaux déclarés sans enseignant non déjà tenus).
// Même calcul que Mon Secteur (handlers/sectors.go v14/v15).
func schoolEffectifs(schoolIDs []string) map[string]int {
        out := make(map[string]int, len(schoolIDs))
        if len(schoolIDs) == 0 {
                return out
        }

        // Agents (directeurs + enseignants) des écoles.
        var agents []models.User
        database.DB.
                Where("school_id IN ? AND role IN ?", schoolIDs,
                        []string{models.RoleDirector, models.RoleTeacher}).
                Find(&agents)

        // Cours tenus via les classes affectées (une seule requête).
        var heldClasses []models.Class
        database.DB.
                Where("school_id IN ? AND teacher_id IS NOT NULL", schoolIDs).
                Find(&heldClasses)
        classNameByTeacher := make(map[string]string, len(heldClasses))
        for _, c := range heldClasses {
                if c.TeacherID == nil {
                        continue
                }
                classNameByTeacher[*c.TeacherID] = c.Name
        }

        // Cumul par école des cours tenus (le dossier reprend la main).
        held := make(map[string]bool, len(agents)) // "schoolID|COURS"
        for _, u := range agents {
                if u.SchoolID == nil {
                        continue
                }
                cours := ""
                if u.Cours != nil && strings.TrimSpace(*u.Cours) != "" {
                        cours = strings.ToUpper(strings.TrimSpace(*u.Cours))
                } else if n, ok := classNameByTeacher[u.ID]; ok {
                        cours = strings.ToUpper(strings.TrimSpace(n))
                }
                if cours == "" {
                        continue
                }
                key := *u.SchoolID + "|" + cours
                held[key] = true
                out[*u.SchoolID] += effTotal(u.EffectifF, u.EffectifG, u.EffectifT)
        }

        // Niveaux déclarés SANS enseignant (le cours non déjà tenu compte).
        var reports []models.StaffLevelReport
        database.DB.Where("school_id IN ?", schoolIDs).Find(&reports)
        for _, rep := range reports {
                cours := strings.ToUpper(strings.TrimSpace(rep.Cours))
                if cours == "" {
                        continue
                }
                key := rep.SchoolID + "|" + cours
                if held[key] {
                        continue
                }
                out[rep.SchoolID] += effTotal(rep.EffectifF, rep.EffectifG, rep.EffectifT)
        }
        return out
}

// resolveCoursTenu — cours tenu d'un agent : champ explicite du
// dossier EN PRIORITÉ, sinon classe affectée (même résolution que
// l'état nominatif — handlers/personnel.go). "" si aucun.
func resolveCoursTenu(u models.User, classNameByTeacher map[string]string) string {
        if u.Cours != nil && strings.TrimSpace(*u.Cours) != "" {
                return strings.ToUpper(strings.TrimSpace(*u.Cours))
        }
        if n, ok := classNameByTeacher[u.ID]; ok {
                return strings.ToUpper(strings.TrimSpace(n))
        }
        return ""
}

// classCountBySchool — NOMBRE DE CLASSES ACTIVES de chaque école
// (convention sessions.go : classes.active = true). Alimente la
// colonne NIVEAU des DIRECTEURS (Task 76 : le niveau d'un directeur
// est le nombre de classes de son école).
func classCountBySchool(schoolIDs []string) map[string]int {
        out := make(map[string]int, len(schoolIDs))
        if len(schoolIDs) == 0 {
                return out
        }
        type cnt struct {
                SchoolID string
                N        int
        }
        var counts []cnt
        database.DB.Model(&models.Class{}).
                Select("school_id, COUNT(*) AS n").
                Where("school_id IN ? AND active = ?", schoolIDs, true).
                Group("school_id").
                Scan(&counts)
        for _, c := range counts {
                out[c.SchoolID] = c.N
        }
        return out
}

// niveauDirecteur — NIVEAU d'un directeur (Task 76) : NOMBRE DE
// CLASSES DE SON ÉCOLE (« 6 »), case vide si l'école n'en a aucune.
func niveauDirecteur(n int) *string {
        if n <= 0 {
                return nil
        }
        s := strconv.Itoa(n)
        return &s
}

// nomKey — clé de tri alphabétique d'un NOM ET PRENOMS : sans les
// espaces parasites (quelques noms saisis avec un espace de tête) et
// insensible à la casse (« Ayekoue Syvette… » après « ATSIN… »).
func nomKey(s string) string {
        return strings.ToLower(strings.TrimSpace(s))
}

// sortRows — ordre du document (Task 75) : ORDRE ALPHABÉTIQUE des
// NOM ET PRENOMS, tous écoles confondues (l'ordre par école de la
// Task 74 est abandonné).
func sortRows(rows []PersonnelListRow) {
        sort.SliceStable(rows, func(i, j int) bool {
                return nomKey(rows[i].FullName) < nomKey(rows[j].FullName)
        })
}

// === GET /api/reports/personnel-list?kind=directeurs|cm2[&iep_id=…] ===
//
// Données des documents « LISTE NOMINATIVE DES DIRECTEURS D'ECOLE » et
// « LISTE NOMINATIVE DES MAITRES DE CM2 » (module Fichier du personnel,
// Task 74/75/76) : entête (IEP + année scolaire) + lignes N°/NOM/
// MATRICULE/DATE DE 1ERE PRISE DE SERVICE/ECOLE/CODE ECOLE/EFFECTIF/
// [NIVEAU]/EMARGEMENT — agents des EPP uniquement, ordre alphabétique.
// NIVEAU (Task 76) : nombre de classes de l'école pour les directeurs,
// colonne annulée pour les maîtres de CM2.
func GetPersonnelList(w http.ResponseWriter, r *http.Request) {
        kind := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("kind")))
        if kind != "directeurs" && kind != "cm2" {
                middleware.JSONError(w, "kind invalide — directeurs ou cm2 attendu", http.StatusBadRequest)
                return
        }

        schools, iep, status, errMsg := personnelListScope(r)
        if status != 0 {
                middleware.JSONError(w, errMsg, status)
                return
        }

        // Task 75 — SEULEMENT LES ENSEIGNANTS ISSUS DES EPP : on ne
        // garde que les écoles PRIMAIRES PUBLIQUES, identifiées par le
        // préfixe « EPP » de leur nom (les préscolaires publics, écoles
        // communautaires EC et écoles privées EPC/EPI/EPV sont exclus).
        eppSchools := make([]models.School, 0, len(schools))
        for _, s := range schools {
                if strings.HasPrefix(strings.ToUpper(strings.TrimSpace(s.Name)), "EPP") {
                        eppSchools = append(eppSchools, s)
                }
        }
        schools = eppSchools

        schoolIDs := make([]string, 0, len(schools))
        schoolByID := make(map[string]models.School, len(schools))
        for _, s := range schools {
                schoolIDs = append(schoolIDs, s.ID)
                schoolByID[s.ID] = s
        }

        // EFFECTIF par école d'après l'état nominatif (directeurs) —
        // partagé avec le tri des maîtres CM2 (aucun surcoût notable).
        effectifBySchool := schoolEffectifs(schoolIDs)

        // NIVEAU des directeurs (Task 76) : NOMBRE DE CLASSES ACTIVES
        // de chaque école.
        classCount := classCountBySchool(schoolIDs)

        // Classes affectées (cours tenu de repli — même résolution que
        // l'état nominatif).
        var heldClasses []models.Class
        if len(schoolIDs) > 0 {
                database.DB.
                        Where("school_id IN ? AND teacher_id IS NOT NULL", schoolIDs).
                        Find(&heldClasses)
        }
        classNameByTeacher := make(map[string]string, len(heldClasses))
        for _, c := range heldClasses {
                if c.TeacherID == nil {
                        continue
                }
                classNameByTeacher[*c.TeacherID] = c.Name
        }

        // Agents des écoles du périmètre (directeurs + enseignants —
        // suspendus compris, comptes supprimés exclus).
        rows := make([]PersonnelListRow, 0, 64)
        if len(schoolIDs) > 0 {
                var agents []models.User
                if err := database.DB.
                        Where("school_id IN ? AND role IN ?", schoolIDs,
                                []string{models.RoleDirector, models.RoleTeacher}).
                        Order("full_name ASC").
                        Find(&agents).Error; err != nil {
                        middleware.JSONError(w, "erreur récupération du personnel", http.StatusInternalServerError)
                        return
                }
                for _, u := range agents {
                        if u.SchoolID == nil {
                                continue
                        }
                        school, ok := schoolByID[*u.SchoolID]
                        if !ok {
                                continue
                        }
                        coursTenu := resolveCoursTenu(u, classNameByTeacher)

                        switch kind {
                        case "directeurs":
                                // Une ligne par DIRECTEUR (role=director).
                                if u.Role != models.RoleDirector {
                                        continue
                                }
                                var eff *int
                                if v := effectifBySchool[*u.SchoolID]; v > 0 {
                                        e := v
                                        eff = &e
                                }
                                rows = append(rows, PersonnelListRow{
                                        ID:           u.ID,
                                        FullName:     u.FullName,
                                        Sexe:         u.Sexe,
                                        Matricule:    u.Matricule,
                                        DateEntreeFP: u.DateEntreeFP,
                                        SchoolName:   school.Name,
                                        SchoolCode:   school.Code,
                                        Effectif:     eff,
                                        // Task 76 — NIVEAU d'un directeur =
                                        // NOMBRE DE CLASSES DE SON ÉCOLE.
                                        Niveau:   niveauDirecteur(classCount[school.ID]),
                                        Fonction: u.Fonction,
                                        SchoolID: school.ID,
                                })
                        case "cm2":
                                // Une ligne par agent (enseignant OU directeur) tenant
                                // le CM2 — cours du dossier EN PRIORITÉ, sinon classe
                                // affectée (convention de l'état nominatif).
                                if coursTenu != "CM2" {
                                        continue
                                }
                                var eff *int
                                if t := effTotal(u.EffectifF, u.EffectifG, u.EffectifT); t > 0 {
                                        e := t
                                        eff = &e
                                }
                                c := coursTenu
                                rows = append(rows, PersonnelListRow{
                                        ID:           u.ID,
                                        FullName:     u.FullName,
                                        Sexe:         u.Sexe,
                                        Matricule:    u.Matricule,
                                        DateEntreeFP: u.DateEntreeFP,
                                        SchoolName:   school.Name,
                                        SchoolCode:   school.Code,
                                        Effectif:     eff,
                                        // Task 76 — colonne NIVEAU ANNULÉE
                                        // pour les maîtres de CM2 (nil).
                                        Niveau:   nil,
                                        Fonction: u.Fonction,
                                        Cours:    &c,
                                        SchoolID: school.ID,
                                })
                        }
                }
        }

        sortRows(rows)

        total := 0
        for _, rw := range rows {
                total += effInt(rw.Effectif)
        }

        jsonResponse(w, http.StatusOK, map[string]interface{}{
                "kind":           kind,
                "iep":            iep,
                "annee_scolaire": anneeScolaireNow(),
                "rows":           rows,
                "count":          len(rows),
                "total_effectif": total,
        })
}
