// Package storage fournit l'abstraction du stockage fichiers de SYGREN.
//
// Production : Cloudflare R2 (S3-compatible) via r2.go — activé par les
// variables R2_* ; les fichiers survivent aux redéploiements Render et les
// lectures passent par des URLs présignées (signature dans l'URL, aucune
// charge bande passante sur Render).
//
// Développement : filesystem local (SQLite, pas de DATABASE_URL) — les
// fichiers sont servis publiquement via /storage/* (router, montage actif
// uniquement quand le stockage local est choisi).
//
// Production SANS R2 configuré : New() retourne nil — les handlers de
// fichiers répondent 503. AUCUN fallback disque en prod : les fichiers
// écrits sur une instance Render disparaissent à chaque redéploiement
// (filesystem éphémère), ce qui rendrait le silencieux.
package storage

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"sygren-api/config"
)

// Storage est l'interface commune des backends de stockage fichiers.
type Storage interface {
	// Put écrit data sous la clé key (ex: "school-logos/<id>.png").
	Put(ctx context.Context, key, contentType string, data []byte) error
	// Delete supprime l'objet sous la clé key (idempotent : ne doit pas
	// échouer si l'objet est absent).
	Delete(ctx context.Context, key string) error
	// PresignURL retourne une URL de lecture directe du fichier (signature
	// incluse pour R2, chemin public pour le dev local).
	PresignURL(ctx context.Context, key string) (string, error)
	// Kind identifie le backend ("r2" | "local") pour les logs.
	Kind() string
}

// Global est l'instance active, posée par New() au boot (même pattern que
// database.DB). nil = stockage non configuré (prod sans R2) — les handlers
// doivent répondre 503.
var Global Storage

// New choisit le backend selon la configuration :
//  1. R2 si R2_ACCOUNT_ID + R2_ACCESS_KEY_ID + R2_SECRET_ACCESS_KEY +
//     R2_BUCKET_NAME sont définis (prod).
//  2. Filesystem local en dev (pas de DATABASE_URL).
//  3. nil en prod sans R2 — fonctionnalités fichiers désactivées, jamais de
//     fallback éphémère.
func New(cfg *config.Config) (Storage, error) {
	if cfg.R2Configured() {
		ttl := time.Duration(cfg.R2URLTTLMinutes) * time.Minute
		s, err := NewR2(cfg.R2AccountID, cfg.R2AccessKeyID, cfg.R2SecretKey, cfg.R2Bucket, ttl)
		if err != nil {
			return nil, err
		}
		Global = s
		return s, nil
	}

	if cfg.DatabaseURL == "" {
		if err := os.MkdirAll(cfg.StoragePath, 0755); err != nil {
			return nil, err
		}
		s := &LocalStorage{BasePath: cfg.StoragePath}
		Global = s
		return s, nil
	}

	// Prod sans R2 : pas de stockage (nil) — volontaire, voir doc du package.
	Global = nil
	return nil, nil
}

// LocalStorage — backend filesystem du DEV UNIQUEMENT. Un consommateur réel
// existe (logos d'écoles en dev), il n'est donc plus du code mort : en prod il
// n'est JAMAIS sélectionné (voir New).
type LocalStorage struct {
	BasePath string
}

// Put écrit data sous BasePath/key (crée les dossiers intermédiaires).
func (s *LocalStorage) Put(_ context.Context, key, _ string, data []byte) error {
	full := filepath.Join(s.BasePath, key)
	if err := os.MkdirAll(filepath.Dir(full), 0755); err != nil {
		return err
	}
	return os.WriteFile(full, data, 0644)
}

// Delete supprime le fichier local (absent = déjà supprimé, pas d'erreur).
func (s *LocalStorage) Delete(_ context.Context, key string) error {
	err := os.Remove(filepath.Join(s.BasePath, key))
	if err != nil && os.IsNotExist(err) {
		return nil
	}
	return err
}

// PresignURL retourne le chemin public servi par le montage statique dev
// (/storage/* dans le router — sans authentification, même modèle d'accès
// « qui a l'URL lit le fichier » que les URLs présignées R2).
func (s *LocalStorage) PresignURL(_ context.Context, key string) (string, error) {
	return fmt.Sprintf("/storage/%s", key), nil
}

func (s *LocalStorage) Kind() string { return "local" }
