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
