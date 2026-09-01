package storage

import (
	"bytes"
	"context"
	"fmt"
	"net/url"
	"time"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

// R2Storage — backend Cloudflare R2 (API S3-compatible).
//
// Choix de la bibliothèque : minio-go v7 (client S3 léger, arbre de
// dépendances réduit face à aws-sdk-go-v2, utilisé par la doc R2 comme
// client S3 alternatif). Endpoint dérivé du Account ID :
// https://<account_id>.r2.cloudflarestorage.com — style "path"
// (bucket dans le chemin), conforme au schéma R2.
//
// Modèle d'accès : écritures et suppressions uniquement côté serveur (JWT),
// lectures via URLs présignées GET (signature SigV4 dans l'URL, TTL
// configuré — défaut 60 min). Aucun octet de fichier ne transite par Render
// en lecture : le navigateur va directement chez R2 (egress R2 gratuit).
type R2Storage struct {
	client *minio.Client
	bucket string
	urlTTL time.Duration
}

// NewR2 construit le client R2. accountID = identifiant de compte Cloudflare,
// accessKey/secret = paire de clés API R2 (créée dans Cloudflare → R2 →
// Manage API tokens), bucket = nom du bucket existant.
func NewR2(accountID, accessKey, secret, bucket string, urlTTL time.Duration) (*R2Storage, error) {
	if accountID == "" || accessKey == "" || secret == "" || bucket == "" {
		return nil, fmt.Errorf("storage: configuration R2 incomplète (accountID/accessKey/secret/bucket requis)")
	}
	if urlTTL <= 0 {
		urlTTL = 60 * time.Minute
	}
	endpoint := fmt.Sprintf("%s.r2.cloudflarestorage.com", accountID)
	client, err := minio.New(endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(accessKey, secret, ""),
		Secure: true,
		// R2 : style path (bucket dans le chemin) — détection automatique
		// minio pour les endpoints non-AWS, forcé ici pour la clarté.
		BucketLookup: minio.BucketLookupPath,
	})
	if err != nil {
		return nil, fmt.Errorf("storage: client R2: %w", err)
	}
	return &R2Storage{client: client, bucket: bucket, urlTTL: urlTTL}, nil
}

// Put écrit le fichier dans le bucket (création ou remplacement même clé).
func (s *R2Storage) Put(ctx context.Context, key, contentType string, data []byte) error {
	_, err := s.client.PutObject(ctx, s.bucket, key, bytes.NewReader(data), int64(len(data)),
		minio.PutObjectOptions{ContentType: contentType})
	if err != nil {
		return fmt.Errorf("storage: put %s: %w", key, err)
	}
	return nil
}

// Delete supprime l'objet (idempotent : R2 ne renvoie pas d'erreur si absent).
func (s *R2Storage) Delete(ctx context.Context, key string) error {
	if err := s.client.RemoveObject(ctx, s.bucket, key, minio.RemoveObjectOptions{}); err != nil {
		return fmt.Errorf("storage: delete %s: %w", key, err)
	}
	return nil
}

// PresignURL génère une URL GET présignée (SigV4 query) valable urlTTL.
func (s *R2Storage) PresignURL(ctx context.Context, key string) (string, error) {
	u, err := s.client.PresignedGetObject(ctx, s.bucket, key, s.urlTTL, url.Values{})
	if err != nil {
		return "", fmt.Errorf("storage: presign %s: %w", key, err)
	}
	return u.String(), nil
}

func (s *R2Storage) Kind() string { return "r2" }
