package config

import (
	"os"
	"path/filepath"
	"strconv"
)

// Config holds application configuration.
// En dev : SQLite local + secret JWT fixe.
// En prod : PostgreSQL (Neon) via DATABASE_URL + secret JWT via env.
type Config struct {
	Port        string
	JWTSecret   string
	DBPath      string // SQLite (dev)
	DatabaseURL string // PostgreSQL (prod) — si non vide, on utilise Postgres
	StoragePath string
	Env         string // dev | prod

	// Cloudflare R2 (S3-compatible) — si les 4 variables sont présentes,
	// le stockage fichiers bascule sur R2 (prod). Sinon, en dev sans
	// DATABASE_URL, fallback filesystem local ; en prod sans R2, aucune
	// fonctionnalité fichier (les handlers renvoient 503 — jamais de
	// fichiers éphémères sur le disque d'une instance Render).
	R2AccountID     string
	R2AccessKeyID   string
	R2SecretKey     string
	R2Bucket        string
	R2URLTTLMinutes int // TTL des URLs présignées (défaut 60)
}

// R2Configured retourne true si toutes les variables requises sont présentes.
func (c *Config) R2Configured() bool {
	return c.R2AccountID != "" && c.R2AccessKeyID != "" && c.R2SecretKey != "" && c.R2Bucket != ""
}

func Load() *Config {
	env := os.Getenv("APP_ENV")
	if env == "" {
		env = "dev"
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	jwtSecret := os.Getenv("JWT_SECRET")
	if jwtSecret == "" {
		// Secret de dev seulement — en prod on utilise une variable d'env sécurisée
		jwtSecret = "sygren-dev-secret-change-in-production-2024"
	}

	// DatabaseURL : si présent, on bascule en mode PostgreSQL (prod / Neon)
	dbURL := os.Getenv("DATABASE_URL")

	// Le backend Go vit dans mini-services/sygren-api/
	baseDir, _ := os.Getwd()
	dbPath := filepath.Join(baseDir, "data", "sygren.db")
	storagePath := filepath.Join(baseDir, "storage")

	// Auto-détecte l'environnement "prod" si DATABASE_URL est présent
	if dbURL != "" && env == "dev" {
		env = "prod"
	}

	ttl := 60
	if v := os.Getenv("R2_URL_TTL_MINUTES"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 24*60 {
			ttl = n
		}
	}

	return &Config{
		Port:        port,
		JWTSecret:   jwtSecret,
		DBPath:      dbPath,
		DatabaseURL: dbURL,
		StoragePath: storagePath,
		Env:         env,

		R2AccountID:   os.Getenv("R2_ACCOUNT_ID"),
		R2AccessKeyID: os.Getenv("R2_ACCESS_KEY_ID"),
		R2SecretKey:   os.Getenv("R2_SECRET_ACCESS_KEY"),
		R2Bucket:      os.Getenv("R2_BUCKET_NAME"),

		R2URLTTLMinutes: ttl,
	}
}
