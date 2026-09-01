package main

import (
	"fmt"
	"log"
	"net/http"
	"time"

	"sygren-api/config"
	"sygren-api/database"
	"sygren-api/handlers"
	"sygren-api/models"
	"sygren-api/router"
	"sygren-api/storage"
)

func main() {
	cfg := config.Load()

	// Initialize database (SQLite dev → PostgreSQL prod)
	if err := database.Init(cfg); err != nil {
		log.Fatalf("[FATAL] Échec initialisation base de données: %v", err)
	}

	// Fix E : backfill de la table des moyennes précalculées (student_session_results)
	// au démarrage si elle est vide. En goroutine pour ne pas bloquer le boot.
	go handlers.BackfillStudentSessionResults()

	// Initialize file storage — R2 (prod, env R2_*) / filesystem (dev).
	// nil en prod sans R2 : les handlers fichiers répondent 503 (jamais de
	// fallback disque éphémère sur Render).
	store, err := storage.New(cfg)
	if err != nil {
		log.Fatalf("[FATAL] Échec initialisation stockage: %v", err)
	}
	if store == nil {
		log.Println("[STORAGE] Aucun stockage fichiers configuré (R2 absent) — fonctionnalités fichiers désactivées")
	} else {
		log.Println("[STORAGE] Stockage fichiers:", store.Kind())
	}

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

	// Goroutine : planification automatique des sessions
	// Toutes les 60 secondes :
	//   1. Sessions draft avec AutoOpen=true et OpenAt ≤ now → statut = open
	//   2. Sessions open avec CloseAt ≤ now → statut = closed
	//   3. (1x/jour) Auto-archivage des sessions validated dont l'année
	//      scolaire est antérieure à l'année courante (setting
	//      system.school_year). Les notes sont CONSERVÉES (l'archivage
	//      est soft — il nettoie l'UI active sans détruire les données,
	//      qui continuent de nourrir le bilan annuel + la comparaison
	//      inter-annuelle).
	go startSessionScheduler()

	if err := server.ListenAndServe(); err != nil {
		log.Fatalf("[FATAL] Serveur: %v", err)
	}
}

// startSessionScheduler gère l'ouverture et la clôture automatique des sessions.
// Tourne en boucle toutes les 60 secondes.
func startSessionScheduler() {
	ticker := time.NewTicker(60 * time.Second)
	defer ticker.Stop()
	// Suivi de la dernière date d'exécution de l'auto-archivage (1x/jour max)
	lastArchiveRunDate := ""
	for range ticker.C {
		now := time.Now()

		// 1. Ouvrir automatiquement les sessions draft dont OpenAt est passé
		result1 := database.DB.Model(&models.EvaluationSession{}).
			Where("status = ? AND auto_open = ? AND open_at IS NOT NULL AND open_at <= ?",
				"draft", true, now).
			Updates(map[string]interface{}{"status": "open", "updated_at": now})
		if result1.RowsAffected > 0 {
			log.Printf("[SCHEDULER] %d session(s) ouverte(s) automatiquement", result1.RowsAffected)
		}

		// 2. Clôturer automatiquement les sessions open dont CloseAt est passé
		result2 := database.DB.Model(&models.EvaluationSession{}).
			Where("status = ? AND close_at IS NOT NULL AND close_at <= ?",
				"open", now).
			Updates(map[string]interface{}{"status": "closed", "updated_at": now})
		if result2.RowsAffected > 0 {
			log.Printf("[SCHEDULER] %d session(s) clôturée(s) automatiquement", result2.RowsAffected)
		}

		// 3. Auto-archivage quotidien : une seule fois par jour (vers 03:00 local).
		//    Archive les sessions validated dont l'année scolaire est
		//    strictement antérieure à l'année scolaire courante (setting
		//    system.school_year). Les notes sont conservées.
		//    Rationale : nettoyer l'UI active sans détruire les données —
		//    le bilan annuel élève + la comparaison inter-annuelle ont
		//    besoin des sessions des années précédentes.
		today := now.Format("2006-01-02")
		if today != lastArchiveRunDate && now.Hour() >= 3 {
			archived := autoArchivePastSessions(now)
			if archived > 0 {
				log.Printf("[SCHEDULER] Auto-archivage : %d session(s) validée(s) d'années antérieures archivée(s)", archived)
			}
			lastArchiveRunDate = today
		}
	}
}

// autoArchivePastSessions archive automatiquement les sessions validated dont
// l'année est strictement inférieure à l'année scolaire courante (setting
// system.school_year). Retourne le nombre de sessions archivées.
//
// Politique de rétention :
//   - Les notes sont CONSERVÉES (l'archivage est soft).
//   - L'auteur est marqué comme "system-cron" pour distinguer l'archivage
//     automatique de l'archivage manuel (ArchivedBy = user id).
//   - Les sessions de l'année courante ne sont JAMAIS auto-archivées,
//     même si validated (l'admin peut les archiver manuellement si besoin).
func autoArchivePastSessions(now time.Time) int64 {
	// Lire l'année scolaire courante depuis les settings
	var setting models.Setting
	if err := database.DB.First(&setting, "key = ?", "system.school_year").Error; err != nil {
		// Setting absent — fallback sur l'année civile courante
		log.Printf("[SCHEDULER] Setting system.school_year absent — fallback année civile %d", now.Year())
		setting.Value = ""
	}
	currentSchoolYear := 0
	if setting.Value != "" {
		if _, err := fmt.Sscanf(setting.Value, "%d", &currentSchoolYear); err != nil {
			currentSchoolYear = now.Year()
		}
	}
	if currentSchoolYear == 0 {
		currentSchoolYear = now.Year()
	}

	// Archiver les sessions validated d'années strictement antérieures
	systemActor := "system-cron"
	result := database.DB.Model(&models.EvaluationSession{}).
		Where("status = ? AND year < ?", "validated", currentSchoolYear).
		Updates(map[string]interface{}{
			"status":      "archived",
			"archived_at": now,
			"archived_by": systemActor,
			"updated_at":  now,
		})
	return result.RowsAffected
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
