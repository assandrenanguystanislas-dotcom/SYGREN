# SYGREN — Journal de suivi du projet

Projet : Système de Gestion de Relevé Électronique de Note
Cahier des charges : `/home/z/my-project/upload/Cahier des Charges - SYGREN.pdf`

## Stack technique (conforme au cahier des charges)
- **Frontend** : Next.js 16 (React, App Router) — port 3000
- **Backend** : Golang 1.23 (API REST) — port 8080 (mini-service)
- **Base de données** : SQLite en dev → PostgreSQL (Neon.tech) en prod
- **Stockage PDF** : Filesystem local en dev → Cloudflare R2 (S3) en prod
- **Auth** : JWT + bcrypt
- **RBAC** : 4 rôles (Instituteur, Directeur, Inspecteur IEP, Super-Admin)

## Architecture
- Gateway Caddy (port 81) route selon `?XTransformPort=XXXX`
- Frontend Next.js appelle le backend Go via `fetch('/api/...?XTransformPort=8080')`
- Backend Go autonome dans `mini-services/sygren-api/`

## Convention de couleurs (charte Côte d'Ivoire)
- Blanc (dominant) : fonds, cartes
- Orange (accent) : Call-to-Action, alertes
- Vert (institution) : barre de navigation, validation, succès

---

---
Task ID: 0
Agent: Main (tutor mode)
Task: Scaffolding backend Go + architecture SYGREN

Work Log:
- Lu et extrait le cahier des charges SYGREN (5 pages PDF)
- Vérifié l'environnement : Go non installé, réseau disponible
- Téléchargé et installé Go 1.23.4 en espace utilisateur (/home/z/.local/go)
- Créé la structure du mini-service `mini-services/sygren-api/` (config, models, database, middleware, handlers, router, utils, storage)
- Écrit les modèles GORM (User, IEP, School, Class, Student, Subject, EvaluationSession, Grade, ReportCard)
- Implémenté l'auth JWT + bcrypt + middleware RBAC (4 rôles)
- Configuré le routeur chi avec routes publiques (/api/health, /api/auth/login) et protégées (/api/me, /api/subjects + stubs modules 2-5)
- Seed initial : super-admin (admin@sygren.ci / admin123) + 8 matières par défaut école primaire ivoirienne
- Découvert que les processus en arrière-plan sont tués entre commandes Bash
- Solution : lancer le serveur Go via `bun run dev` (wrapper bun) → le processus persiste (PID 4064)
- Validé le routing gateway : `?XTransformPort=8080` → backend Go fonctionne via Caddy (port 81)

Stage Summary:
- Backend Go SYGREN opérationnel sur port 8080
- Stack : Go 1.25 + GORM + SQLite (dev) + chi router + JWT
- Auth : login par téléphone OU email, JWT 72h, bcrypt
- RBAC : 4 rôles (teacher, director, inspector, admin) avec middleware RequireRole
- Compte super-admin : admin@sygren.ci / admin123
- 8 matières seedées (Français, Maths, HG, Sciences, Anglais, EPS, Leçon de choses, Chant et Dessin)
- Architecture : Next.js (3000) ↔ Caddy (81) ↔ Go (8080)

---
Task ID: 1-bis
Agent: Main (tutor mode)
Task: Frontend — API client, auth store, page de connexion, layouts par rôle

Work Log:
- Créé les types TypeScript (src/lib/types.ts) correspondant aux modèles GORM
- Implémenté le client API (src/lib/api.ts) avec routing gateway (?XTransformPort=8080) et injection JWT automatique
- Créé le store d'auth Zustand (src/lib/auth-store.ts) avec persistance localStorage
- Configuré le thème Côte d'Ivoire dans globals.css : orange (primary/CTA), vert (sidebar/institution), blanc (fond)
- Ajouté les utilitaires glassmorphism (.glass, .glass-green), bande tricolore (ci-flag-stripe), scrollbar personnalisée, micro-animations
- Mis à jour layout.tsx : police Inter, métadonnées SYGREN, Sonner toaster
- Créé la vue de connexion (login-view.tsx) : carte glassmorphism, validation zod, identifiants démo visibles
- Créé le shell du dashboard (dashboard-shell.tsx) : sidebar verte glassmorphism, navigation RBAC (10 items filtrés par rôle), header sticky, footer sticky, drawer mobile (Sheet)
- Créé le dashboard d'accueil (welcome-dashboard.tsx) : bannière personnalisée par rôle, 4 cartes stats, actions rapides, notice pédagogique
- Créé la vue Matières fonctionnelle (subjects-view.tsx) : React Query → API Go, recherche, grille de cartes
- Créé la vue placeholder (placeholder-view.tsx) pour les modules à venir (Phases 2-5)
- Créé la page principale (page.tsx) : orchestration auth (login/dashboard), switching de vues, providers React Query
- Corrigé 3 erreurs de lint (react-hooks/set-state-in-effect) : useSyncExternalStore pour la date, dérivation d'état pour l'auth, handler centralisé pour le drawer mobile

Stage Summary:
- Frontend Next.js 16 opérationnel sur port 3000
- Auth JWT complète : login (email OU téléphone) → store Zustand persistant → refreshUser automatique
- RBAC frontend : navigation filtrée par rôle, 4 rôles (admin, director, inspector, teacher)
- Design : charte Côte d'Ivoire (blanc/orange/vert), glassmorphism léger, responsive mobile + desktop
- Vue Matières fonctionnelle : 8 matières chargées depuis le backend Go via le gateway Caddy
- Vérification Agent Browser : login OK, dashboard OK, navigation OK, données API OK, 0 erreur console
- Sticky footer : validé sur le dashboard (poussé naturellement sur contenu long)

