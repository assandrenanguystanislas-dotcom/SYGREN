package handlers

import (
	"encoding/json"
	"io"
	"net/http"

	"sygren-api/database"
	"sygren-api/middleware"
	"sygren-api/models"
	"sygren-api/rbac"
)

// === Architecture D — Matrice de permissions ===

// GET /api/permissions
// Renvoie la matrice complète : liste des rôles + pour chaque rôle, la liste
// des modules avec leur CanRead/CanWrite actuel + un flag "irreducible"
// (true si la case ne peut pas être décochée car protégée par IsIrreducible).
//
// Format :
//   {
//     "roles": [
//       { "id":"...", "name":"admin", "label":"Super Admin", "is_system":true,
//         "modules": [
//           { "key":"dashboard", "label":"Tableau de bord", "can_read":true, "can_write":false, "irreducible":false },
//           { "key":"settings", "label":"Paramètres système", "can_read":true, "can_write":true, "irreducible":true }
//         ]
//       }, ...
//     ]
//   }

type permissionCell struct {
	Key         string `json:"key"`
	Label       string `json:"label"`
	Description string `json:"description"`
	IconHint    string `json:"icon_hint"`
	CanRead     bool   `json:"can_read"`
	CanWrite    bool   `json:"can_write"`
	Irreducible bool   `json:"irreducible"`
}

type permissionRoleRow struct {
	ID          string           `json:"id"`
	Name        string           `json:"name"`
	Label       string           `json:"label"`
	Description string           `json:"description"`
	IsSystem    bool             `json:"is_system"`
	SortOrder   int              `json:"sort_order"`
	Modules     []permissionCell `json:"modules"`
}

func ListPermissions(w http.ResponseWriter, r *http.Request) {
	// Load all roles
	var roles []models.Role
	if err := database.DB.Order("sort_order ASC").Find(&roles).Error; err != nil {
		middleware.JSONError(w, "erreur récupération rôles: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Load all role_modules
	var rms []models.RoleModule
	if err := database.DB.Find(&rms).Error; err != nil {
		middleware.JSONError(w, "erreur récupération matrice: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Index by role_id → module_key → cell
	matrix := make(map[string]map[string]models.RoleModule, len(roles))
	for _, rm := range rms {
		if _, ok := matrix[rm.RoleID]; !ok {
			matrix[rm.RoleID] = make(map[string]models.RoleModule)
		}
		matrix[rm.RoleID][rm.ModuleKey] = rm
	}

	// Build response
	out := make([]permissionRoleRow, 0, len(roles))
	metas := models.AllModuleMetas()
	for _, role := range roles {
		cells := make([]permissionCell, 0, len(metas))
		for _, m := range metas {
			var canRead, canWrite bool
			if cell, ok := matrix[role.ID][m.Key]; ok {
				canRead = cell.CanRead
				canWrite = cell.CanWrite
			}
			// Force irreducible cells to true
			if models.IsIrreducible(role.Name, m.Key) {
				canRead = true
				canWrite = true
			}
			cells = append(cells, permissionCell{
				Key:         m.Key,
				Label:       m.Label,
				Description: m.Description,
				IconHint:    m.IconHint,
				CanRead:     canRead,
				CanWrite:    canWrite,
				Irreducible: models.IsIrreducible(role.Name, m.Key),
			})
		}
		out = append(out, permissionRoleRow{
			ID:          role.ID,
			Name:        role.Name,
			Label:       role.Label,
			Description: role.Description,
			IsSystem:    role.IsSystem,
			SortOrder:   role.SortOrder,
			Modules:     cells,
		})
	}

	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"roles":   out,
		"modules": metas,
	})
}

// === PUT /api/permissions ===
// Met à jour une cellule de la matrice (role_id, module_key, can_read, can_write).
//
// Body JSON :
//   { "role_id": "...", "module_key": "sessions", "can_read": true, "can_write": true }
//
// Règles de sécurité :
// - Les cellules "irreducible" ne peuvent pas être modifiées (403).
// - Toute modification invalide le cache des permissions (InvalidatePermissionCache).
// - L'action est tracée dans le journal d'audit.

type updatePermissionReq struct {
	RoleID    string `json:"role_id"`
	ModuleKey string `json:"module_key"`
	CanRead   *bool  `json:"can_read,omitempty"`
	CanWrite  *bool  `json:"can_write,omitempty"`
}

func UpdatePermission(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		middleware.JSONError(w, "corps de requête illisible", http.StatusBadRequest)
		return
	}
	defer r.Body.Close()

	var req updatePermissionReq
	if err := json.Unmarshal(body, &req); err != nil {
		middleware.JSONError(w, "JSON invalide", http.StatusBadRequest)
		return
	}
	if req.RoleID == "" || req.ModuleKey == "" {
		middleware.JSONError(w, "role_id et module_key requis", http.StatusBadRequest)
		return
	}
	if req.CanRead == nil && req.CanWrite == nil {
		middleware.JSONError(w, "can_read ou can_write requis", http.StatusBadRequest)
		return
	}

	// Find the role (for irreducible check + label)
	var role models.Role
	if err := database.DB.Where("id = ?", req.RoleID).First(&role).Error; err != nil {
		middleware.JSONError(w, "rôle introuvable", http.StatusNotFound)
		return
	}

	// Irreducible guard — cannot modify these cells
	if models.IsIrreducible(role.Name, req.ModuleKey) {
		middleware.JSONError(w, "permission irréductible — "+role.Label+" garde toujours l'accès à "+req.ModuleKey, http.StatusBadRequest)
		return
	}

	// Validate module key
	validModule := false
	for _, m := range models.AllModuleMetas() {
		if m.Key == req.ModuleKey {
			validModule = true
			break
		}
	}
	if !validModule {
		middleware.JSONError(w, "clé de module invalide: "+req.ModuleKey, http.StatusBadRequest)
		return
	}

	// Find or create the RoleModule row
	var rm models.RoleModule
	result := database.DB.Where("role_id = ? AND module_key = ?", req.RoleID, req.ModuleKey).First(&rm)

	before := map[string]interface{}{
		"role":      role.Name,
		"module":    req.ModuleKey,
		"can_read":  false,
		"can_write": false,
	}
	if result.Error == nil {
		before["can_read"] = rm.CanRead
		before["can_write"] = rm.CanWrite
	}

	// Apply changes
	changed := false
	if result.Error == nil {
		// Update existing
		if req.CanRead != nil && rm.CanRead != *req.CanRead {
			rm.CanRead = *req.CanRead
			changed = true
		}
		if req.CanWrite != nil && rm.CanWrite != *req.CanWrite {
			rm.CanWrite = *req.CanWrite
			changed = true
		}
		if changed {
			if err := database.DB.Save(&rm).Error; err != nil {
				middleware.JSONError(w, "erreur maj permission: "+err.Error(), http.StatusInternalServerError)
				return
			}
		}
	} else {
		// Create new (record was missing — defaults to false)
		rm = models.RoleModule{
			RoleID:    req.RoleID,
			ModuleKey: req.ModuleKey,
			CanRead:   req.CanRead != nil && *req.CanRead,
			CanWrite:  req.CanWrite != nil && *req.CanWrite,
		}
		if err := database.DB.Create(&rm).Error; err != nil {
			middleware.JSONError(w, "erreur création permission: "+err.Error(), http.StatusInternalServerError)
			return
		}
		changed = true
	}

	// Invalidate cache
	rbac.InvalidatePermissionCache()

	// Audit log
	after := map[string]interface{}{
		"role":      role.Name,
		"module":    req.ModuleKey,
		"can_read":  rm.CanRead,
		"can_write": rm.CanWrite,
	}
	if changed {
		LogAction(r, "permission.update", "permission", &req.RoleID, map[string]interface{}{
			"before": before,
			"after":  after,
		})
	}

	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"ok":         true,
		"role_id":    req.RoleID,
		"module_key": req.ModuleKey,
		"can_read":   rm.CanRead,
		"can_write":  rm.CanWrite,
	})
}

// === GET /api/me/modules ===
// Renvoie la liste des clés de modules accessibles au user connecté
// (can_read OU can_write = true). Utilisé par le frontend pour construire
// dynamiquement la navigation.
//
// Format :
//   { "modules": ["dashboard", "schools", "students", ...], "user": {...} }
//
// Note : "user" est inclus pour éviter un round-trip supplémentaire. Le
// frontend l'utilise déjà via GET /api/me.

func ListUserModules(w http.ResponseWriter, r *http.Request) {
	role := ctxRole(r)
	mods := rbac.GetAccessibleModules(role)
	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"modules": mods,
		"role":    role,
	})
}
