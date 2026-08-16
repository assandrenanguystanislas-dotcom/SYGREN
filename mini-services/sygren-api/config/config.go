package config

import (
        "os"
        "path/filepath"
)

// Config holds application configuration.
// En dev : SQLite local + secret JWT fixe.
// En prod : PostgreSQL (Neon) via DATABASE_URL + secret JWT via env.
type Config struct {
        Port        string
        JWTSecret   string
        DBPath      string   // SQLite (dev)
        DatabaseURL string   // PostgreSQL (prod) — si non vide, on utilise Postgres
        StoragePath string
        Env         string // dev | prod
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

        return &Config{
                Port:        port,
                JWTSecret:   jwtSecret,
                DBPath:      dbPath,
                DatabaseURL: dbURL,
                StoragePath: storagePath,
                Env:         env,
        }
}
