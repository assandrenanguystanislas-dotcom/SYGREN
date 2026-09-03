package database

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"time"

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
		//
		// PreferSimpleProtocol (protocole simple pgx, sans prepared
		// statements serveur) : l'endpoint POOLER de Neon est un
		// PgBouncer en mode transaction. Avec le mode par défaut de
		// pgx (CacheStatement), les statements nommés survivent côté
		// pooler et, dès qu'AutoMigrate ajoute une colonne, chaque
		// SELECT * re-préparé échoue avec « cached plan must not
		// change result type » (SQLSTATE 0A000) → 404 en cascade sur
		// tous les handlers First-by-id (ex: PUT /api/students/{id}).
		// Le protocole simple est la parade documentée PgBouncer.
		db, err = gorm.Open(postgres.New(postgres.Config{
			DSN:                  cfg.DatabaseURL,
			PreferSimpleProtocol: true,
		}), &gorm.Config{
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

	// Backfill PDA — la colonne kind a été introduite avec l'extension
	// « compositions mensuelles » du plan d'action : les examens créés
	// avant sont des examens blancs (saisie manuelle). Idempotent.
	if err := db.Model(&models.PDAExam{}).
		Where("kind = '' OR kind IS NULL").
		Update("kind", "blanc").Error; err != nil {
		log.Println("[DB] backfill pda_exams.kind warning:", err)
	}

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

// seedRBAC peuple les rôles système et la matrice role × module.
//
// Idempotent + VERSIONNÉ : la matrice par défaut est (ré)appliquée quand le
// setting "rbac.matrix_version" est antérieur à models.RbacMatrixVersion.
// Cela permet :
//   - premier déploiement : création des rôles + de toutes les cellules ;
//   - base EXISTANTE (ex. Neon en production) : ajout du rôle parent (v2),
//     des nouveaux modules et synchronisation des cellules avec la
//     politique d'accès v2 (élèves pour l'enseignant, documents
//     consultables non imprimables pour le directeur, portail parent) ;
//   - personnalisations ultérieures du Super Admin (via /api/permissions)
//     préservées : tant que la version ne change pas, rien n'est écrasé.
func seedRBAC(db *gorm.DB) error {
	// 5a. Rôles — créer les rôles manquants (v2 ajoute "parent" aux bases
	// existantes sans toucher aux 4 rôles historiques).
	var roles []models.Role
	if err := db.Find(&roles).Error; err != nil {
		return err
	}
	roleByName := make(map[string]string, len(roles))
	for _, r := range roles {
		roleByName[r.Name] = r.ID
	}
	createdRoles := 0
	for _, r := range models.DefaultRoles() {
		if _, ok := roleByName[r.Name]; ok {
			continue
		}
		role := models.Role{
			Name:        r.Name,
			Label:       r.Label,
			Description: r.Description,
			IsSystem:    r.IsSystem,
			SortOrder:   r.SortOrder,
		}
		if err := db.Create(&role).Error; err != nil {
			log.Println("[DB] seed role:", r.Name, err)
			continue
		}
		roleByName[r.Name] = role.ID
		createdRoles++
	}
	if createdRoles > 0 {
		log.Printf("[DB] %d rôle(s) système créé(s)", createdRoles)
	}

	// 5b. Matrice role × module — versionnée.
	applied := 0
	var marker models.Setting
	hasMarker := db.Where(models.Setting{Key: models.RbacMatrixVersionKey}).First(&marker).Error == nil
	if hasMarker {
		fmt.Sscanf(marker.Value, "%d", &applied)
	}

	if applied >= models.RbacMatrixVersion {
		// Base à jour : créer uniquement les cellules MANQUANTES (nouveaux
		// modules ajoutés sans changement de politique).
		var rmCount int64
		db.Model(&models.RoleModule{}).Count(&rmCount)
		if rmCount == 0 {
			return seedRBACCells(db, roleByName, false)
		}
		// Cellules manquantes pour les nouveaux modules/rôles (idempotent).
		return seedRBACCells(db, roleByName, true)
	}

	// Migration : appliquer la matrice COMPLÈTE (créer les cellules
	// manquantes + mettre à jour les existantes aux valeurs par défaut v2).
	if err := seedRBACCells(db, roleByName, false); err != nil {
		return err
	}
	value := fmt.Sprintf("%d", models.RbacMatrixVersion)
	if hasMarker {
		if err := db.Model(&models.Setting{}).Where(models.Setting{Key: models.RbacMatrixVersionKey}).
			Updates(map[string]interface{}{"value": value, "updated_at": time.Now()}).Error; err != nil {
			return err
		}
	} else {
		if err := db.Create(&models.Setting{
			Key:      models.RbacMatrixVersionKey,
			Value:    value,
			Category: "system",
			Label:    "Version de la matrice RBAC appliquée au démarrage",
		}).Error; err != nil {
			return err
		}
	}
	log.Printf("[DB] matrice RBAC v%d appliquée (rôles × modules)", models.RbacMatrixVersion)
	return nil
}

// seedRBACCells crée/met à jour les cellules (role × module) depuis la
// matrice par défaut. force=true → écrase les valeurs existantes ;
// force=false → crée uniquement les cellules absentes.
func seedRBACCells(db *gorm.DB, roleByName map[string]string, onlyMissing bool) error {
	count := 0
	for _, cell := range models.DefaultRoleModules() {
		roleID, ok := roleByName[cell.RoleName]
		if !ok {
			log.Printf("[DB] seed role_module: rôle %q introuvable, skip", cell.RoleName)
			continue
		}
		var rm models.RoleModule
		exists := db.Where("role_id = ? AND module_key = ?", roleID, cell.Module).First(&rm).Error == nil
		if exists && onlyMissing {
			continue
		}
		if exists {
			if rm.CanRead == cell.CanRead && rm.CanWrite == cell.CanWrite {
				continue
			}
			if err := db.Model(&models.RoleModule{}).Where("id = ?", rm.ID).
				Updates(map[string]interface{}{
					"can_read":   cell.CanRead,
					"can_write":  cell.CanWrite,
					"updated_at": time.Now(),
				}).Error; err != nil {
				log.Printf("[DB] update role_module (%s, %s): %v", cell.RoleName, cell.Module, err)
				continue
			}
			count++
			continue
		}
		rm = models.RoleModule{
			RoleID:    roleID,
			ModuleKey: cell.Module,
			CanRead:   cell.CanRead,
			CanWrite:  cell.CanWrite,
		}
		if err := db.Create(&rm).Error; err != nil {
			log.Printf("[DB] seed role_module (%s, %s): %v", cell.RoleName, cell.Module, err)
			continue
		}
		count++
	}
	if count > 0 {
		log.Printf("[DB] %d cellules role_module créées/mises à jour", count)
	}
	return nil
}
