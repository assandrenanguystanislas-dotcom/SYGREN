package database

import (
	"log"
	"os"
	"path/filepath"

	"sygren-api/config"
	"sygren-api/models"
	"sygren-api/utils"

	"gorm.io/driver/postgres"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// DB is the global GORM database instance.
// En dev : SQLite (fichier local). En prod : PostgreSQL (Neon).
var DB *gorm.DB

// Init opens the database, runs migrations, and seeds initial data.
func Init(cfg *config.Config) error {
	gormLogLevel := logger.Warn
	if cfg.Env == "dev" {
		gormLogLevel = logger.Info
	}

	var db *gorm.DB
	var err error

	if cfg.DatabaseURL != "" {
		// Mode production : PostgreSQL (Neon.tech)
		log.Println("[DB] Connexion à PostgreSQL (Neon)…")
		db, err = gorm.Open(postgres.Open(cfg.DatabaseURL), &gorm.Config{
			Logger: logger.Default.LogMode(gormLogLevel),
		})
		if err != nil {
			return err
		}
		log.Println("[DB] Connecté à PostgreSQL (Neon)")
	} else {
		// Mode dev : SQLite local
		// Note : les champs *time.Time du modèle EvaluationSession utilisent
		// `gorm:"type:timestamp"` (et NON timestamptz) car le driver
		// mattn/go-sqlite3 ne reconnaît que les types "timestamp"/"datetime"/
		// "date" pour parser automatiquement les TEXT en time.Time. Avec
		// timestamptz, il retourne une string → erreur "unsupported Scan".
		if err := os.MkdirAll(filepath.Dir(cfg.DBPath), 0755); err != nil {
			return err
		}
		sqliteDSN := cfg.DBPath + "?_busy_timeout=5000&_journal_mode=WAL"
		db, err = gorm.Open(sqlite.Open(sqliteDSN), &gorm.Config{
			Logger: logger.Default.LogMode(gormLogLevel),
		})
		if err != nil {
			return err
		}
		log.Println("[DB] Connecté à SQLite :", cfg.DBPath)
	}
	DB = db

	// Auto-migrate all models
	if err := db.AutoMigrate(models.AllModels()...); err != nil {
		return err
	}

	log.Println("[DB] Migrations terminées")

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

	// 3. Paramètres système par défaut (cahier des charges §3 Module 5)
	var settingCount int64
	db.Model(&models.Setting{}).Count(&settingCount)
	if settingCount == 0 {
		defaults := models.DefaultSettings()
		for _, s := range defaults {
			if err := db.Create(&s).Error; err != nil {
				log.Println("[DB] seed setting:", s.Key, err)
			}
		}
		log.Printf("[DB] %d paramètres par défaut créés", len(defaults))
	}

	// 4. Barèmes de notation par défaut (cahier des charges §3 Module 2)
	//     CP=/10, CE=/30 (Dictée /20), CM=/50 (Dictée /20)
	var scaleCount int64
	db.Model(&models.GradeScale{}).Count(&scaleCount)
	if scaleCount == 0 {
		// D'abord les barèmes par défaut par niveau
		for _, gs := range models.DefaultGradeScales() {
			if err := db.Create(&gs).Error; err != nil {
				log.Println("[DB] seed grade_scale:", gs.Level, err)
			}
		}
		// Puis les exceptions Dictée (/20) pour CE et CM
		var dictee models.Subject
		if err := db.Where("name = ?", "Dictée").First(&dictee).Error; err == nil {
			for _, level := range []string{"CE", "CM"} {
				exc := models.GradeScale{
					Level:     level,
					SubjectID: &dictee.ID,
					MaxScore:  20,
				}
				if err := db.Create(&exc).Error; err != nil {
					log.Println("[DB] seed grade_scale dictée:", level, err)
				}
			}
			log.Printf("[DB] exceptions Dictée /20 créées pour CE et CM")
		}
		log.Printf("[DB] barèmes de notation créés (CP=/10, CE=/30, CM=/50, Dictée CE+CM=/20)")
	}

	// 5. Architecture D — RBAC roles + matrice de permissions
	if err := seedRBAC(db); err != nil {
		log.Println("[DB] seed RBAC warning:", err)
	}

	return nil
}

// seedRBAC peuple les 4 rôles système et la matrice role × module si vides.
// Idempotent : ne rien écrase si déjà présent (sauf si forceRBACSeed=true en
// dev local via env). La matrice est conçue pour refléter exactement le
// comportement RequireRole(...) actuel — aucun changement comportemental au
// premier déploiement.
func seedRBAC(db *gorm.DB) error {
	// 5a. Rôles
	var roleCount int64
	db.Model(&models.Role{}).Count(&roleCount)
	if roleCount == 0 {
		for _, r := range models.DefaultRoles() {
			role := models.Role{
				Name:        r.Name,
				Label:       r.Label,
				Description: r.Description,
				IsSystem:    r.IsSystem,
				SortOrder:   r.SortOrder,
			}
			if err := db.Create(&role).Error; err != nil {
				log.Println("[DB] seed role:", r.Name, err)
			}
		}
		log.Printf("[DB] %d rôles système créés (admin, inspector, director, teacher)", len(models.DefaultRoles()))
	}

	// 5b. Matrice role × module (uniquement si vide)
	var rmCount int64
	db.Model(&models.RoleModule{}).Count(&rmCount)
	if rmCount == 0 {
		// Index roles by name for quick lookup
		var roles []models.Role
		if err := db.Find(&roles).Error; err != nil {
			return err
		}
		roleByName := make(map[string]string, len(roles))
		for _, r := range roles {
			roleByName[r.Name] = r.ID
		}
		for _, cell := range models.DefaultRoleModules() {
			roleID, ok := roleByName[cell.RoleName]
			if !ok {
				// Role missing — skip and warn
				log.Printf("[DB] seed role_module: role %q introuvable, skip", cell.RoleName)
				continue
			}
			rm := models.RoleModule{
				RoleID:    roleID,
				ModuleKey: cell.Module,
				CanRead:   cell.CanRead,
				CanWrite:  cell.CanWrite,
			}
			if err := db.Create(&rm).Error; err != nil {
				log.Printf("[DB] seed role_module (%s, %s): %v", cell.RoleName, cell.Module, err)
			}
		}
		log.Printf("[DB] %d cellules role_module créées (matrice RBAC)", len(models.DefaultRoleModules()))
	}

	return nil
}
