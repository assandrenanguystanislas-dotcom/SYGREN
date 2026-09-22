package middleware

import (
	"net/http"
	"strings"

	"sygren-api/models"
)

// ConseillerScope — v5 (session 26) : périmètre STRICT du rôle CONSEILLER.
//
// Demande utilisateur : « ces conseillers pourront voir seulement leurs
// directeurs et leurs adjoints aux directeurs ». Or une grande partie des
// routes GET du backend sont en « lecture ouverte » (scope éventuellement
// incomplet pour un rôle sans école ni IEP : ListStudents, ListClasses,
// ListSchools, ListTeachers, ListDirectors, ListParents…). Plutôt que de
// patcher chaque handler (fragile — toute nouvelle route serait par défaut
// visible), un MIDDLEWARE interdit au conseiller toute route hors de sa
// liste blanche :
//
//	/api/me, /api/me/modules         → profil + nav
//	/api/auth/change-password        → mot de passe
//	/api/conseiller/*                → sa vue « Mon Secteur »
//
// === v6 (session 34) — CONSULTATION des documents de son secteur ===
//
// Demande utilisateur : « les conseillers pourront voir tous les documents
// PDF de leurs secteurs mais ne pourront pas les imprimer (grisés) ». La
// liste blanche est étendue aux routes de LECTURE des documents officiels ;
// le périmètre SECTORIEL est appliqué dans chaque handler (écoles du
// secteur via users.sector_id) et l'IMPRESSION reste verrouillée côté
// frontend (print-guard.tsx — le rôle conseiller n'est pas autorisé) :
//
//	/api/schools                     → écoles de son secteur (scope handler)
//	/api/sessions                    → sessions des écoles du secteur
//	/api/classes                     → classes des écoles du secteur
//	/api/computation/*               → résultats de session / bilan annuel
//	/api/reports/*                   → synthèses, relevés, fin d'année, personnel
//	/api/pda/*                       → plan d'action pluriannuel (GET)
//
// NB : les routes d'ÉCRITURE de ces familles restent protégées par
// RequireModule (schools/sessions/grades… :write) — la matrice v6
// n'accorde au conseiller AUCUNE écriture (défense en profondeur).
//
// === v8 (session 40) — CORRECTION des inscriptions de son secteur ===
//
// Demande utilisateur : « je n'arrive pas à faire des corrections sur des
// erreurs faites par les directeurs et leurs adjoints. exemple sur des
// inscriptions ». Le conseiller voit les erreurs de saisie dans les
// documents de son secteur (v6) sans pouvoir les corriger : la liste
// blanche est étendue au module Élèves :
//
//	/api/students, /api/students/* → élèves de son secteur (scope
//	handler) ; la MISE À JOUR (PUT) est bornée dans UpdateStudent
//	(élève ET classe cible du secteur) ; les routes de création /
//	suppression / import restent refusées par les HANDLERS (403
//	explicites — la correction n'inclut ni inscription ni suppression).
//
// La matrice v8 accorde au conseiller students:read + students:write
// (nécessaire au PUT, qui contrôle rbac.CanWrite) ; le périmètre et les
// interdits fins sont appliqués dans les handlers (défense en profondeur,
// la matrice restant modifiable à chaud).
//
// Toute autre route renvoie un 403 explicite, que la matrice RBAC
// l'autorise ou non (défense en profondeur — la matrice reste modifiable
// à chaud).
func ConseillerScope(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		role, ok := r.Context().Value(CtxRole).(string)
		if ok && role == models.RoleConseiller {
			p := r.URL.Path
			allowed :=
				p == "/api/me" ||
					p == "/api/me/modules" ||
					p == "/api/auth/change-password" ||
					strings.HasPrefix(p, "/api/conseiller/") ||
					// v6 — consultation des documents de son secteur
					// (lecture seule : périmètre sectoriel dans les
					// handlers, écritures bloquées par RequireModule).
					p == "/api/schools" ||
					p == "/api/sessions" ||
					p == "/api/classes" ||
					// v8 — correction des inscriptions de
					// son secteur (scope + interdits dans
					// les handlers students).
					p == "/api/students" ||
					strings.HasPrefix(p, "/api/students/") ||
					strings.HasPrefix(p, "/api/computation/") ||
					strings.HasPrefix(p, "/api/reports/") ||
					strings.HasPrefix(p, "/api/pda/")
			if !allowed {
				JSONError(w, "accès refusé : le conseiller accède uniquement à sa vue « Mon Secteur », à la consultation des documents de son secteur et à la correction des inscriptions de son secteur", http.StatusForbidden)
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}
