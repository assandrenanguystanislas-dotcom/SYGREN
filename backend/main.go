package main

import (
        "log"
        "net/http"
        "time"

        "sygren-api/config"
        "sygren-api/database"
        "sygren-api/router"
        "sygren-api/storage"
)

func main() {
        cfg := config.Load()

        // Initialize database (SQLite dev → PostgreSQL prod)
        if err := database.Init(cfg); err != nil {
                log.Fatalf("[FATAL] Échec initialisation base de données: %v", err)
        }

        // Initialize file storage
        store, err := storage.New(cfg)
        if err != nil {
                log.Fatalf("[FATAL] Échec initialisation stockage: %v", err)
        }
        _ = store // utilisé plus tard pour les bulletins PDF (Module 4)

        // Build router
        r := router.New(cfg)

        // Configure HTTP server
        server := &http.Server{
                Addr:              ":" + cfg.Port,
                Handler:           r,
                ReadHeaderTimeout: 10 * time.Second,
                ReadTimeout:       30 * time.Second,
                WriteTimeout:      30 * time.Second,
                IdleTimeout:       120 * time.Second,
        }

        log.Printf("╔════════════════════════════════════════════╗")
        log.Printf("║  SYGREN API — Backend Go                   ║")
        log.Printf("║  Port: %s                                  ║", cfg.Port)
        log.Printf("║  Env:  %s                                  ║", padEnv(cfg.Env))
        log.Printf("║  DB:   %s ║", padPath(dbLabel(cfg)))
        log.Printf("╚════════════════════════════════════════════╝")
        log.Printf("[HTTP] Serveur démarré sur le port %s", cfg.Port)

        if err := server.ListenAndServe(); err != nil {
                log.Fatalf("[FATAL] Serveur: %v", err)
        }
}

// dbLabel retourne un label lisible pour la DB selon le driver utilisé.
func dbLabel(cfg *config.Config) string {
        if cfg.DatabaseURL != "" {
                return "PostgreSQL (Neon)"
        }
        return "SQLite (" + cfg.DBPath + ")"
}

func padEnv(s string) string {
        for len(s) < 33 {
                s += " "
        }
        return s
}

func padPath(s string) string {
        for len(s) < 24 {
                s += " "
        }
        return s
}
