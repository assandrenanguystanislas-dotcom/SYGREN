package database

import (
        "log"
        "os"
        "path/filepath"

        "sygren-api/config"
        "sygren-api/models"
        "sygren-api/utils"

        "gorm.io/driver/sqlite"
        "gorm.io/gorm"
        "gorm.io/gorm/logger"
)

// DB is the global GORM database instance.
// En dev : SQLite (fichier local). En prod : remplacer le driver par gorm.io/driver/postgres.
var DB *gorm.DB

// Init opens the database, runs migrations, and seeds initial data.
func Init(cfg *config.Config) error {
        // Ensure data directory exists
        if err := os.MkdirAll(filepath.Dir(cfg.DBPath), 0755); err != nil {
                return err
        }

        gormLogLevel := logger.Warn
        if cfg.Env == "dev" {
                gormLogLevel = logger.Info
        }

        db, err := gorm.Open(sqlite.Open(cfg.DBPath), &gorm.Config{
                Logger: logger.Default.LogMode(gormLogLevel),
        })
        if err != nil {
                return err
        }
        DB = db

        // Auto-migrate all models
        if err := db.AutoMigrate(models.AllModels()...); err != nil {
                return err
        }

        log.Println("[DB] Migrations terminées — SQLite prêt:", cfg.DBPath)

        // Seed initial data (super-admin + matières par défaut)
        if err := seedDefaults(db); err != nil {
                log.Println("[DB] seed warning:", err)
        }

        return nil
}

// seedDefaults creates the super-admin account and default subjects if DB is empty.
func seedDefaults(db *gorm.DB) error {
        // 1. Super-admin (compte racine — cahier des charges §2)
        var adminCount int64
        db.Model(&models.User{}).Where("role = ?", models.RoleAdmin).Count(&adminCount)
        if adminCount == 0 {
                adminPass, _ := utils.HashPassword("admin123")
                email := "admin@sygren.ci"
                admin := models.User{
                        FullName: "Super Administrateur SYGREN",
                        Email:    &email,
                        Password: adminPass,
                        Role:     models.RoleAdmin,
                        Active:   true,
                }
                if err := db.Create(&admin).Error; err != nil {
                        return err
                }
                log.Println("[DB] Super-admin créé — login: admin@sygren.ci / mot de passe: admin123")
        }

        // 2. Matières par défaut pour l'école primaire ivoirienne
        var subjectCount int64
        db.Model(&models.Subject{}).Count(&subjectCount)
        if subjectCount == 0 {
                defaultSubjects := []models.Subject{
                        {Name: "Français", Coefficient: 1},
                        {Name: "Mathématiques", Coefficient: 1},
                        {Name: "Histoire-Géographie", Coefficient: 1},
                        {Name: "Sciences", Coefficient: 1},
                        {Name: "Anglais", Coefficient: 1},
                        {Name: "EPS", Coefficient: 1},
                        {Name: "Leçon de choses", Coefficient: 1},
                        {Name: "Chant et Dessin", Coefficient: 1},
                }
                for _, s := range defaultSubjects {
                        if err := db.Create(&s).Error; err != nil {
                                log.Println("[DB] seed subject:", s.Name, err)
                        }
                }
                log.Printf("[DB] %d matières par défaut créées", len(defaultSubjects))
        }

        return nil
}
