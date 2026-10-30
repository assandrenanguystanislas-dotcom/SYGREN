package handlers

import (
        "encoding/json"
        "net/http"
        "strconv"
        "strings"

        "sygren-api/database"
        "sygren-api/middleware"
        "sygren-api/models"
)

// jsonResponse writes a JSON response with the given status code.
func jsonResponse(w http.ResponseWriter, status int, data interface{}) {
        w.Header().Set("Content-Type", "application/json")
        w.WriteHeader(status)
        _ = json.NewEncoder(w).Encode(data)
}

// readQueryPagination extracts page & pageSize from query string.
// Defaults: page=1, pageSize=20. Max pageSize=100.
type Pagination struct {
        Page     int
        PageSize int
        Offset   int
}

func readQueryPagination(r *http.Request) Pagination {
        p := Pagination{Page: 1, PageSize: 20}
        if v := r.URL.Query().Get("page"); v != "" {
                if n, err := strconv.Atoi(v); err == nil && n > 0 {
                        p.Page = n
                }
        }
        if v := r.URL.Query().Get("pageSize"); v != "" {
                if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 100 {
                        p.PageSize = n
                }
        }
        p.Offset = (p.Page - 1) * p.PageSize
        return p
}

// ctxUserID extracts the authenticated user ID from the request context.
func ctxUserID(r *http.Request) string {
        if v, ok := r.Context().Value(middleware.CtxUserID).(string); ok {
                return v
        }
        return ""
}

// ctxRole extracts the authenticated user's role.
func ctxRole(r *http.Request) string {
        if v, ok := r.Context().Value(middleware.CtxRole).(string); ok {
                return v
        }
        return ""
}

// sessionWritable — la saisie des notes (ajout, modification, suppression)
// reste possible tant que la session n'est pas VALIDÉE : « la saisie des
// notes soit fermée qu'après validation » (demande utilisateur).
//   - open / closed : saisie possible (la clôture prépare la validation,
//     elle ne bloque plus la saisie) ;
//   - draft         : saisie pas encore ouverte ;
//   - validated     : verrouillée DÉFINITIVEMENT pour tout le monde (y
//     compris l'admin — cohérent avec le bandeau frontend) ;
//   - archived / cancelled : clôturées.
func sessionWritable(status string) bool {
        return status == "open" || status == "closed"
}

// ctxSchoolID extracts the school scope (director/teacher).
func ctxSchoolID(r *http.Request) string {
        if v, ok := r.Context().Value(middleware.CtxSchoolID).(string); ok {
                return v
        }
        return ""
}

// ctxIEPID extracts the IEP scope (inspector).
func ctxIEPID(r *http.Request) string {
        if v, ok := r.Context().Value(middleware.CtxIEPID).(string); ok {
                return v
        }
        return ""
}

// conseillerSectorID — v6 (session 34) : résout le SECTEUR D'ECOLES du
// conseiller courant (users.sector_id, lookup serveur — même convention que
// ConseillerStaff). Le périmètre sectoriel n'est JAMAIS lu depuis le JWT :
// une réaffectation est donc effective immédiatement, sans reconnexion.
//
// Retourne "" si le rôle n'est PAS conseiller ou si aucun secteur n'est
// affecté — les handlers doivent alors renvoyer une réponse vide ou un 403
// (jamais un périmètre élargi).
func conseillerSectorID(r *http.Request) string {
        if ctxRole(r) != models.RoleConseiller {
                return ""
        }
        var me models.User
        if err := database.DB.Select("sector_id").First(&me, "id = ?", ctxUserID(r)).Error; err != nil {
                return ""
        }
        if me.SectorID == nil {
                return ""
        }
        return *me.SectorID
}

// conseillerSectorSchoolIDs — IDs des écoles DU SECTEUR du conseiller
// courant ([] vide si rôle autre, secteur non affecté ou secteur sans
// école). Utilisé par les handlers dont le périmètre est une LISTE d'écoles
// (PDA : examens du plan rattachés à une école).
func conseillerSectorSchoolIDs(r *http.Request) []string {
        sectorID := conseillerSectorID(r)
        if sectorID == "" {
                return []string{}
        }
        var ids []string
        if err := database.DB.Model(&models.School{}).
                Where("sector_id = ?", sectorID).Pluck("id", &ids).Error; err != nil {
                return []string{}
        }
        if ids == nil {
                ids = []string{}
        }
        return ids
}

// matriculeOrNA retourne la valeur du matricule s'il est non nil,
// sinon "N/A". Utilisé pour les réponses JSON destinées à l'affichage.
func matriculeOrNA(m *string) string {
        if m == nil || strings.TrimSpace(*m) == "" {
                return "N/A"
        }
        return *m
}

// monthLabelFR retourne le nom français du mois (1-12) pour les
// libellés de session/évaluation. Historiquement défini dans
// report_cards.go (supprimé lors du passage 100 % impression A5) —
// déplacé ici car dashboard.go l'utilise.
func monthLabelFR(month int) string {
        months := []string{
                "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
                "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
        }
        if month >= 1 && month <= 12 {
                return months[month-1]
        }
        return "—"
}

// resolveClassTeacherName retourne le nom du TENANT DU COURS d'une classe
// — partagé par le document officiel « Resultats de fin d'année » (Le
// tenant du cours), le bulletin individuel (Le Maître chargé du cours) et
// les relevés/bulletins A5 (Appréciation et Visa du Maître) :
//  1. PRIORITÉ : l'utilisateur affecté à la classe (classes.teacher_id —
//     quel que soit son rôle : un directeur peut tenir une classe, RBAC) ;
//  2. REPLI (v25 — 4 classes sur 582 seulement ont un teacher_id) :
//     l'enseignant ACTIF de la même école dont le COURS TENU (users.cours,
//     bande déroulante CP1..CM2 du dossier personnel, cf.
//     handlers/personnel.go) correspond au nom de la classe (ex :
//     cours='CM2' pour la classe CM2).
//
// Noms nettoyés (TrimSpace) ; champs existants : AUCUNE migration Neon.
func resolveClassTeacherName(cls models.Class) string {
        teacherName := ""
        if cls.TeacherID != nil && *cls.TeacherID != "" {
                var t models.User
                if err := database.DB.Select("full_name").First(&t, "id = ?", *cls.TeacherID).Error; err == nil {
                        teacherName = strings.TrimSpace(t.FullName)
                }
        }
        if strings.TrimSpace(teacherName) != "" {
                return teacherName
        }
        var t models.User
        if err := database.DB.Select("full_name").
                Where("school_id = ? AND role = ? AND active = ? AND UPPER(cours) = ?",
                        cls.SchoolID, models.RoleTeacher, true,
                        strings.ToUpper(strings.TrimSpace(cls.Name))).
                Order("created_at ASC").First(&t).Error; err == nil {
                teacherName = strings.TrimSpace(t.FullName)
        }
        return teacherName
}

// === Scoping « les élèves de MON cours » (adjoints au directeur) ===
//
// Demande utilisateur : « permettre à ce que les adjoints au directeur
// aient leurs élèves afin que lors des saisies des notes, chaque
// enseignant soit capable de donner des notes à ses élèves — l'enseignant
// de CP1 a ses élèves et ainsi de suite — le directeur a tous les élèves
// de l'école ».
//
// Dans SYGREN le rôle teacher = l'adjoint(e) au directeur. Or la vraie
// affectation d'un adjoint à son cours vit dans le DOSSIER (users.cours,
// bande déroulante CP1..CM2 — cf. handlers/personnel.go) : sur Neon,
// 4 classes actives sur 754 seulement ont un teacher_id affecté, contre
// 286 enseignants actifs dont le cours tenu correspond au nom d'une
// classe active de leur école. Le scoping des classes/élèves/notes suit
// donc la MÊME résolution que resolveClassTeacherName ci-dessus :
//  1. PRIORITÉ : affectation explicite (classes.teacher_id = utilisateur) ;
//  2. REPLI : classe ACTIVE de la MÊME école dont le nom correspond au
//     cours tenu du dossier (UPPER(classes.name) = UPPER(users.cours)).
//
// Aucune migration Neon (champs existants, 100 % lecture du dossier).

// teacherCoursScope retourne le cours tenu (users.cours, nettoyé) et
// l'école (users.school_id) du dossier de l'utilisateur — "" si absents.
func teacherCoursScope(userID string) (cours, schoolID string) {
        if strings.TrimSpace(userID) == "" {
                return "", ""
        }

        var u models.User
        if err := database.DB.Select("cours, school_id").First(&u, "id = ?", userID).Error; err != nil {
                return "", ""
        }

        if u.Cours != nil {
                cours = strings.TrimSpace(*u.Cours)
        }
        if u.SchoolID != nil {
                schoolID = strings.TrimSpace(*u.SchoolID)
        }
        return cours, schoolID
}

// teacherClassCondition construit la condition SQL « classes enseignées
// par cet utilisateur » (priorité teacher_id, repli cours tenu du dossier
// dans la même école). La clause est parenthésée : elle s'enchîne sans
// ambiguïté avec les autres filtres (AND). École ou cours absents du
// dossier → repli impossible → teacher_id seul (comportement historique).
func teacherClassCondition(userID string) (string, []interface{}) {
        cours, schoolID := teacherCoursScope(userID)
        if cours != "" && schoolID != "" {
                return "(classes.teacher_id = ? OR (classes.school_id = ? AND UPPER(TRIM(classes.name)) = UPPER(?)))",
                        []interface{}{userID, schoolID, strings.ToUpper(cours)}
        }
        return "classes.teacher_id = ?", []interface{}{userID}
}

// teacherOwnsClass — contrôle EN MÉMOIRE (handlers de saisie des notes) :
// l'enseignant ne note que les élèves de SA classe (teacher_id ou repli
// cours tenu dans la même école). Le directeur/admin ne passe PAS ici.
func teacherOwnsClass(userID string, cls models.Class) bool {
        if cls.TeacherID != nil && *cls.TeacherID == userID {
                return true
        }
        cours, schoolID := teacherCoursScope(userID)
        return cours != "" && schoolID != "" && cls.SchoolID == schoolID &&
                strings.EqualFold(strings.TrimSpace(cls.Name), cours)
}
