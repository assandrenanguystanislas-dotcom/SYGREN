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
// Toute autre route renvoie un 403 explicite, que la matrice RBAC
// l'autorise ou non (défense en profondeur — la matrice v5 n'accorde au
// conseiller que users.conseiller, mais elle reste modifiable à chaud).
func ConseillerScope(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		role, ok := r.Context().Value(CtxRole).(string)
		if ok && role == models.RoleConseiller {
			p := r.URL.Path
			allowed :=
				p == "/api/me" ||
					p == "/api/me/modules" ||
					p == "/api/auth/change-password" ||
					strings.HasPrefix(p, "/api/conseiller/")
			if !allowed {
				JSONError(w, "accès refusé : le conseiller accède uniquement à sa vue « Mon Secteur »", http.StatusForbidden)
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}
