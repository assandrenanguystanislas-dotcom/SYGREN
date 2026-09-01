# SYGREN — Système de Gestion de Relevé Électronique de Note

Plateforme web de digitalisation de la gestion des évaluations scolaires pour les écoles primaires de Côte d'Ivoire. Application conforme au cahier des charges SYGREN.

## 📐 Architecture monorepo

```
SYGREN/
├── frontend/                 # Application Next.js 16 (port 3000)
│   ├── src/
│   │   ├── app/              # App Router (layout, page, globals.css)
│   │   ├── components/
│   │   │   ├── ui/           # shadcn/ui (Radix + Tailwind)
│   │   │   ├── views/        # 12 vues métier
│   │   │   ├── dashboards/
│   │   │   └── ...
│   │   └── lib/              # API client, types, auth store, hooks
│   ├── package.json
│   └── ...
│
├── backend/                  # API Go 1.25 (port 8080)
│   ├── main.go
│   ├── config/               # Configuration (env, DB, JWT)
│   ├── database/             # GORM (SQLite dev / PostgreSQL prod)
│   ├── models/               # 9 modèles + RBAC
│   ├── handlers/             # 23 handlers (auth, CRUD, calcul, rapports, PDA, dashboard)
│   ├── router/               # Chi router + RBAC middleware
│   ├── middleware/           # JWT auth + RequireRole + CORS
│   ├── utils/                # JWT + bcrypt
│   ├── storage/              # Interface stockage fichiers + client R2 (logos d'écoles)
│   ├── scripts/              # Migration SQLite → PostgreSQL
│   ├── go.mod  go.sum  package.json
│   └── ...
│
├── Caddyfile                 # Gateway (port 81)
├── package.json              # Orchestrateur monorepo
├── worklog.md                # Journal de développement
└── README.md
```

## 🚀 Démarrage rapide

### Prérequis
- [Bun](https://bun.sh) (runtime JavaScript)
- [Go 1.23+](https://go.dev/dl/)
- [Caddy](https://caddyserver.com/) (gateway, optionnel)

### Installation
```bash
# Frontend
cd frontend && bun install

# Backend
cd backend && go mod tidy && go build -o sygren-api main.go
```

### Démarrage
```bash
# Depuis la racine du monorepo
bun run dev              # Frontend Next.js (port 3000)
bun run dev:backend      # Backend Go (port 8080)

# Ou les deux simultanément
bun run dev:all
```

### Configuration de la base de données

**Développement (SQLite)** — par défaut, aucune config nécessaire :
```bash
# Le backend crée automatiquement backend/data/sygren.db
```

**Production (PostgreSQL sur Neon)** — définir `DATABASE_URL` :
```bash
export DATABASE_URL="postgresql://user:pass@host/db?sslmode=require"
export JWT_SECRET="votre-secret-jwt"
```

**Fichiers (Cloudflare R2 en production)** — optionnel : sans ces variables, les
fonctionnalités fichiers répondent 503 (aucun fallback disque éphémère) :
```bash
export R2_ACCOUNT_ID="<account-id-cloudflare>"
export R2_ACCESS_KEY_ID="<clé-api-R2>"
export R2_SECRET_ACCESS_KEY="<secret-clé-api-R2>"
export R2_BUCKET_NAME="<nom-du-bucket>"
export R2_URL_TTL_MINUTES="60"  # optionnel — TTL des URLs présignées
```

Migration des données SQLite → PostgreSQL :
```bash
bun run migrate:db  # (nécessite DATABASE_URL pointant vers Neon)
```

## 📊 Modules implémentés (cahier des charges)

| Module | Description | Statut |
|--------|-------------|--------|
| **Auth + RBAC** | JWT + bcrypt, 4 rôles (admin, director, inspector, teacher) | ✅ |
| **Module 1** | Gestion administrative (IEP, écoles, classes, élèves, enseignants, matières) | ✅ |
| **Module 2** | Saisie des notes mensuelles (grille tableur + auto-save brouillon) | ✅ |
| **Module 3** | Calcul des moyennes + classement (ex-aequo) + mentions automatiques | ✅ |
| **Module 4** | Bulletins A5 (rendu navigateur + impression par lot) | ✅ |
| **Module 5** | Tableaux de bord analytiques (KPIs + graphiques recharts) | ✅ |

## 🔐 Comptes de démonstration

| Rôle | Identifiant | Mot de passe |
|------|-------------|--------------|
| Super-Admin | `admin@sygren.ci` | `admin123` |
| Enseignant | `marie.konan@sygren.ci` | `passer123` |

## 🎨 Charte graphique (Côte d'Ivoire)

- **Blanc** (dominant) — fonds, cartes
- **Orange** (accentuation) — Call-to-Action, alertes
- **Vert** (institution) — barre de navigation, validation, succès

## 🔧 Stack technique

| Couche | Technologie |
|--------|-------------|
| Frontend | Next.js 16, React 19, TypeScript 5, Tailwind CSS 4, shadcn/ui, Recharts, Zustand, TanStack Query |
| Backend | Go 1.25, Chi router, GORM, JWT, bcrypt, minio-go (R2) |
| Base de données | SQLite (dev) → PostgreSQL sur Neon.tech (prod) |
| Fichiers (logos) | Filesystem local (dev) → Cloudflare R2 (prod, URLs présignées via minio-go) |
| Gateway | Caddy (port 81) avec routing `?XTransformPort` |

## 📜 Licence

Voir le fichier [LICENSE](LICENSE).
