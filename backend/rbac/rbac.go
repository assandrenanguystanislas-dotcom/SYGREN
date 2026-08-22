// Package rbac implémente le cache des permissions et la fonction de vérification
// dynamique (Architecture D). Il est séparé de middleware/ et handlers/ pour
// éviter les imports circulaires : middleware/ et handlers/ importent tous deux
// rbac/, qui n'importe que models/ et database/.
package rbac

import (
	"fmt"
	"sync"
	"time"

	"sygren-api/database"
	"sygren-api/models"
)

// === In-memory permission cache (mirrors dashboard cache pattern) ===
//
// Structure : cache[roleName] -> map[moduleKey] -> {CanRead, CanWrite}
// TTL : 5 minutes. Invalidated on any write to role_modules table.
// RWMutex pour permettre les lectures concurrentes (read-many, write-rare).
const permissionsCacheTTL = 5 * time.Minute

type permCell struct {
	CanRead  bool
	CanWrite bool
}

type permissionsCacheEntry struct {
	mods      map[string]permCell
	expiresAt time.Time
}

var (
	permCache   = make(map[string]*permissionsCacheEntry) // key = role name (e.g., "admin")
	permCacheMu sync.RWMutex
)

// InvalidatePermissionCache vide le cache. À appeler après toute écriture sur
// la table role_modules (ou un changement de rôle d'un user, pour rafraîchir
// les listes de modules accessibles).
func InvalidatePermissionCache() {
	permCacheMu.Lock()
	permCache = make(map[string]*permissionsCacheEntry)
	permCacheMu.Unlock()
}

// loadRoleIntoCache charge la matrice (role_modules + roles) pour un rôle
// donné depuis la DB, et met à jour le cache.
func loadRoleIntoCache(roleName string) (*permissionsCacheEntry, error) {
	// Find role by name
	var role models.Role
	if err := database.DB.Where("name = ?", roleName).First(&role).Error; err != nil {
		// Role not found — empty cache entry (will be treated as no permissions)
		entry := &permissionsCacheEntry{
			mods:      map[string]permCell{},
			expiresAt: time.Now().Add(permissionsCacheTTL),
		}
		permCacheMu.Lock()
		permCache[roleName] = entry
		permCacheMu.Unlock()
		return entry, nil
	}

	// Load all RoleModule rows for this role
	var rows []models.RoleModule
	if err := database.DB.Where("role_id = ?", role.ID).Find(&rows).Error; err != nil {
		return nil, fmt.Errorf("load role_modules: %w", err)
	}

	mods := make(map[string]permCell, len(rows))
	for _, r := range rows {
		mods[r.ModuleKey] = permCell{CanRead: r.CanRead, CanWrite: r.CanWrite}
	}

	// Apply irreducible permissions (admin always has settings/permissions/audit/users-admin/users-inspectors)
	for _, mod := range models.AllModuleKeys() {
		if models.IsIrreducible(roleName, mod) {
			c := mods[mod]
			c.CanRead = true
			c.CanWrite = true // for audit, we set CanWrite=false irreducible? No — irreducible means always granted at the requested mode.
			mods[mod] = c
		}
	}

	entry := &permissionsCacheEntry{
		mods:      mods,
		expiresAt: time.Now().Add(permissionsCacheTTL),
	}
	permCacheMu.Lock()
	permCache[roleName] = entry
	permCacheMu.Unlock()
	return entry, nil
}

// getRoleEntry returns the cache entry for the role, loading from DB if stale.
func getRoleEntry(roleName string) (*permissionsCacheEntry, error) {
	permCacheMu.RLock()
	entry, ok := permCache[roleName]
	permCacheMu.RUnlock()
	if ok && time.Now().Before(entry.expiresAt) {
		return entry, nil
	}
	return loadRoleIntoCache(roleName)
}

// CheckPermission vérifie que le rôle peut faire l'action demandée sur le module.
// mode = "read" ou "write".
// Renvoie true si autorisé. Les permissions irréductibles renvoient toujours true
// (sécurité anti auto-blocage).
func CheckPermission(roleName, module, mode string) bool {
	// Irreducible first — always granted regardless of cache/DB state
	if models.IsIrreducible(roleName, module) {
		return true
	}
	entry, err := getRoleEntry(roleName)
	if err != nil {
		// On error, fail-safe: deny
		return false
	}
	c, ok := entry.mods[module]
	if !ok {
		return false
	}
	if mode == "write" {
		return c.CanWrite
	}
	return c.CanRead || c.CanWrite // read OR write both allow read
}

// CanRead est un raccourci pour CheckPermission(role, module, "read").
func CanRead(roleName, module string) bool {
	return CheckPermission(roleName, module, "read")
}

// CanWrite est un raccourci pour CheckPermission(role, module, "write").
func CanWrite(roleName, module string) bool {
	return CheckPermission(roleName, module, "write")
}

// GetAccessibleModules renvoie la liste des clés de modules accessibles
// au rôle (en lecture OU écriture). Utilisé par GET /api/me/modules pour
// construire dynamiquement la navigation frontend.
func GetAccessibleModules(roleName string) []string {
	entry, err := getRoleEntry(roleName)
	if err != nil {
		return nil
	}
	out := make([]string, 0, len(entry.mods))
	for k, c := range entry.mods {
		if c.CanRead || c.CanWrite {
			out = append(out, k)
		}
	}
	return out
}
