// Script de migration SQLite → PostgreSQL (Neon)
// Usage : DATABASE_URL=... go run scripts/migrate_sqlite_to_neon.go
//
// Lit les données de la base SQLite locale (data/sygren.db) et les insère
// dans la base PostgreSQL (DATABASE_URL), en préservant les UUIDs.

package main

import (
        "log"
        "os"

        "sygren-api/models"

        "gorm.io/driver/postgres"
        "gorm.io/driver/sqlite"
        "gorm.io/gorm"
)

func main() {
        // 1. Ouvrir SQLite (source)
        sqlitePath := "data/sygren.db"
        if _, err := os.Stat(sqlitePath); os.IsNotExist(err) {
                log.Fatalf("Base SQLite non trouvée : %s", sqlitePath)
        }
        srcDB, err := gorm.Open(sqlite.Open(sqlitePath), &gorm.Config{})
        if err != nil {
                log.Fatalf("Erreur ouverture SQLite : %v", err)
        }
        srcSQL, _ := srcDB.DB()
        defer srcSQL.Close()
        log.Println("[OK] SQLite source ouverte :", sqlitePath)

        // 2. Ouvrir PostgreSQL (destination)
        dbURL := os.Getenv("DATABASE_URL")
        if dbURL == "" {
                log.Fatal("DATABASE_URL non défini")
        }
        dstDB, err := gorm.Open(postgres.Open(dbURL), &gorm.Config{})
        if err != nil {
                log.Fatalf("Erreur ouverture PostgreSQL : %v", err)
        }
        dstSQL, _ := dstDB.DB()
        defer dstSQL.Close()
        log.Println("[OK] PostgreSQL destination ouverte (Neon)")

        // Migration dans l'ordre des dépendances
        migrateTable(srcDB, dstDB, "IEPs", func() interface{} { return &[]models.IEP{} })
        migrateTable(srcDB, dstDB, "Schools", func() interface{} { return &[]models.School{} })
        migrateTable(srcDB, dstDB, "Classes", func() interface{} { return &[]models.Class{} })
        migrateTable(srcDB, dstDB, "Students", func() interface{} { return &[]models.Student{} })
        migrateTable(srcDB, dstDB, "Subjects", func() interface{} { return &[]models.Subject{} })
        migrateTable(srcDB, dstDB, "EvaluationSessions", func() interface{} { return &[]models.EvaluationSession{} })
        migrateTable(srcDB, dstDB, "Grades", func() interface{} { return &[]models.Grade{} })
        migrateTable(srcDB, dstDB, "ReportCards", func() interface{} { return &[]models.ReportCard{} })
        migrateTeachers(srcDB, dstDB)

        log.Println("=== Migration terminée avec succès ===")
}

func migrateTable(srcDB, dstDB *gorm.DB, label string, newSlice func() interface{}) {
        records := newSlice()
        if err := srcDB.Find(records).Error; err != nil {
                log.Printf("[WARN] Erreur lecture %s : %v", label, err)
                return
        }

        count := 0
        switch s := records.(type) {
        case *[]models.IEP:
                count = len(*s)
        case *[]models.School:
                count = len(*s)
        case *[]models.Class:
                count = len(*s)
        case *[]models.Student:
                count = len(*s)
        case *[]models.Subject:
                count = len(*s)
        case *[]models.EvaluationSession:
                count = len(*s)
        case *[]models.Grade:
                count = len(*s)
        case *[]models.ReportCard:
                count = len(*s)
        }
        if count == 0 {
                log.Printf("[SKIP] %s : 0 enregistrement dans SQLite", label)
                return
        }

        // Fallback : insertion record par record en ignorant les doublons
        insertOneByOne(dstDB, records, label, count)
}

func insertOneByOne(dstDB *gorm.DB, records interface{}, label string, total int) {
        inserted := 0
        switch s := records.(type) {
        case *[]models.IEP:
                for i := range *s {
                        r := (*s)[i]
                        if err := dstDB.Where("id = ?", r.ID).FirstOrCreate(&(*s)[i]).Error; err == nil {
                                inserted++
                        }
                }
        case *[]models.School:
                for i := range *s {
                        r := (*s)[i]
                        if err := dstDB.Where("id = ?", r.ID).FirstOrCreate(&(*s)[i]).Error; err == nil {
                                inserted++
                        }
                }
        case *[]models.Class:
                for i := range *s {
                        r := (*s)[i]
                        if err := dstDB.Where("id = ?", r.ID).FirstOrCreate(&(*s)[i]).Error; err == nil {
                                inserted++
                        }
                }
        case *[]models.Student:
                for i := range *s {
                        r := (*s)[i]
                        if err := dstDB.Where("id = ?", r.ID).FirstOrCreate(&(*s)[i]).Error; err == nil {
                                inserted++
                        }
                }
        case *[]models.Subject:
                // Pour les matières, on vérifie par nom (déjà seedées par défaut)
                for i := range *s {
                        r := (*s)[i]
                        if err := dstDB.Where("name = ?", r.Name).FirstOrCreate(&(*s)[i]).Error; err == nil {
                                inserted++
                        }
                }
        case *[]models.EvaluationSession:
                for i := range *s {
                        r := (*s)[i]
                        if err := dstDB.Where("id = ?", r.ID).FirstOrCreate(&(*s)[i]).Error; err == nil {
                                inserted++
                        }
                }
        case *[]models.Grade:
                for i := range *s {
                        r := (*s)[i]
                        if err := dstDB.Where("id = ?", r.ID).FirstOrCreate(&(*s)[i]).Error; err == nil {
                                inserted++
                        }
                }
        case *[]models.ReportCard:
                for i := range *s {
                        r := (*s)[i]
                        if err := dstDB.Where("id = ?", r.ID).FirstOrCreate(&(*s)[i]).Error; err == nil {
                                inserted++
                        }
                }
        }
        log.Printf("[OK] %s : %d/%d migré(s)", label, inserted, total)
}

func migrateTeachers(srcDB, dstDB *gorm.DB) {
        var teachers []models.User
        if err := srcDB.Where("role = ?", models.RoleTeacher).Find(&teachers).Error; err != nil {
                log.Printf("[WARN] Erreur lecture Teachers : %v", err)
                return
        }
        if len(teachers) == 0 {
                log.Println("[SKIP] Teachers : 0 dans SQLite")
                return
        }
        inserted := 0
        for _, t := range teachers {
                var existing models.User
                query := dstDB.Model(&models.User{})
                if t.Email != nil && *t.Email != "" {
                        query = query.Where("email = ?", *t.Email)
                } else if t.Phone != nil && *t.Phone != "" {
                        query = query.Where("phone = ?", *t.Phone)
                } else {
                        continue
                }
                result := query.First(&existing)
                if result.Error != nil {
                        if err := dstDB.Create(&t).Error; err == nil {
                                inserted++
                        }
                } else {
                        log.Printf("[SKIP] Teacher %s existe déjà sur Neon", t.FullName)
                }
        }
        log.Printf("[OK] Teachers : %d/%d migré(s)", inserted, len(teachers))
}
