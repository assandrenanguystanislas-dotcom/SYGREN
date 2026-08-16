package config

import (
	"os"
	"path/filepath"
)

// Config holds application configuration.
// En dev : SQLite local + secret JWT fixe.
// En prod : swap vers PostgreSQL (Neon) + secret JWT via env.
type Config struct {
	Port          string
	JWTSecret     string
	DBPath        string
	StoragePath   string
	Env           string // dev | prod
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

	// Le backend Go vit dans mini-services/sygren-api/
	baseDir, _ := os.Getwd()
	dbPath := filepath.Join(baseDir, "data", "sygren.db")
	storagePath := filepath.Join(baseDir, "storage")

	return &Config{
		Port:        port,
		JWTSecret:   jwtSecret,
		DBPath:      dbPath,
		StoragePath: storagePath,
		Env:         env,
	}
}
