package storage

import (
	"fmt"
	"io"
	"mime/multipart"
	"os"
	"path/filepath"

	"sygren-api/config"
)

// LocalStorage stores files on the local filesystem (dev).
// In production, swap to a Cloudflare R2 / S3 client using the same interface.
type LocalStorage struct {
	BasePath string
}

func New(cfg *config.Config) (*LocalStorage, error) {
	if err := os.MkdirAll(cfg.StoragePath, 0755); err != nil {
		return nil, err
	}
	return &LocalStorage{BasePath: cfg.StoragePath}, nil
}

// SaveFile persists a multipart file under the given relative path.
func (s *LocalStorage) SaveFile(header *multipart.FileHeader, relPath string) (string, error) {
	full := filepath.Join(s.BasePath, relPath)
	if err := os.MkdirAll(filepath.Dir(full), 0755); err != nil {
		return "", err
	}
	src, err := header.Open()
	if err != nil {
		return "", err
	}
	defer src.Close()
	dst, err := os.Create(full)
	if err != nil {
		return "", err
	}
	defer dst.Close()
	if _, err := io.Copy(dst, src); err != nil {
		return "", err
	}
	return relPath, nil
}

// SaveBytes persists raw bytes under the given relative path (used for generated PDFs).
func (s *LocalStorage) SaveBytes(data []byte, relPath string) (string, error) {
	full := filepath.Join(s.BasePath, relPath)
	if err := os.MkdirAll(filepath.Dir(full), 0755); err != nil {
		return "", err
	}
	if err := os.WriteFile(full, data, 0644); err != nil {
		return "", err
	}
	return relPath, nil
}

// FullPath returns the absolute path for a stored file.
func (s *LocalStorage) FullPath(relPath string) string {
	return filepath.Join(s.BasePath, relPath)
}

// FileExists checks whether a file exists.
func (s *LocalStorage) FileExists(relPath string) bool {
	_, err := os.Stat(filepath.Join(s.BasePath, relPath))
	return err == nil
}

// URL returns a relative URL for accessing the file (in prod this would be a signed R2 URL).
func (s *LocalStorage) URL(relPath string) string {
	return fmt.Sprintf("/storage/%s", relPath)
}
