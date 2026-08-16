package handlers

import (
        "encoding/json"
        "net/http"

        "sygren-api/database"
        "sygren-api/middleware"
        "sygren-api/models"

        "github.com/go-chi/chi/v5"
)

// === IEP — Inspection de l'Enseignement Primaire ===
// Accès : Super-Admin uniquement (cahier des charges §2)

// ListIEP returns all IEPs.
func ListIEP(w http.ResponseWriter, r *http.Request) {
        var ieps []models.IEP
        if err := database.DB.Order("name ASC").Find(&ieps).Error; err != nil {
                middleware.JSONError(w, "erreur récupération IEP", http.StatusInternalServerError)
                return
        }
        // Compter les écoles par IEP
        type schoolCount struct {
                IEPID    string `json:"iep_id"`
                Count    int64  `json:"school_count"`
        }
        var counts []schoolCount
        database.DB.Model(&models.School{}).
                Select("iep_id, count(*) as count").
                Group("iep_id").
                Scan(&counts)
        countMap := map[string]int64{}
        for _, c := range counts {
                countMap[c.IEPID] = c.Count
        }
        type IEPWithStats struct {
                models.IEP
                SchoolCount int64 `json:"school_count"`
        }
        result := make([]IEPWithStats, 0, len(ieps))
        for _, i := range ieps {
                result = append(result, IEPWithStats{IEP: i, SchoolCount: countMap[i.ID]})
        }
        jsonResponse(w, http.StatusOK, map[string]interface{}{
                "ieps":  result,
                "count": len(result),
        })
}

// CreateIEPRequest — payload pour créer une IEP
type CreateIEPRequest struct {
        Name   string `json:"name"`
        Region string `json:"region"`
}

// CreateIEP creates a new IEP.
func CreateIEP(w http.ResponseWriter, r *http.Request) {
        var req CreateIEPRequest
        if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
                middleware.JSONError(w, "payload invalide", http.StatusBadRequest)
                return
        }
        if req.Name == "" {
                middleware.JSONError(w, "le nom est requis", http.StatusBadRequest)
                return
        }
        iep := models.IEP{Name: req.Name, Region: req.Region}
        if err := database.DB.Create(&iep).Error; err != nil {
                middleware.JSONError(w, "erreur création IEP", http.StatusInternalServerError)
                return
        }
        jsonResponse(w, http.StatusCreated, iep)
}

// UpdateIEP updates an existing IEP.
func UpdateIEP(w http.ResponseWriter, r *http.Request) {
        id := chi.URLParam(r, "id")
        var req CreateIEPRequest
        if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
                middleware.JSONError(w, "payload invalide", http.StatusBadRequest)
                return
        }
        var iep models.IEP
        if err := database.DB.First(&iep, "id = ?", id).Error; err != nil {
                middleware.JSONError(w, "IEP introuvable", http.StatusNotFound)
                return
        }
        if req.Name != "" {
                iep.Name = req.Name
        }
        if req.Region != "" {
                iep.Region = req.Region
        }
        if err := database.DB.Save(&iep).Error; err != nil {
                middleware.JSONError(w, "erreur mise à jour", http.StatusInternalServerError)
                return
        }
        jsonResponse(w, http.StatusOK, iep)
}

// DeleteIEP removes an IEP (cascade-check: must have no schools).
func DeleteIEP(w http.ResponseWriter, r *http.Request) {
        id := chi.URLParam(r, "id")
        var count int64
        database.DB.Model(&models.School{}).Where("iep_id = ?", id).Count(&count)
        if count > 0 {
                middleware.JSONError(w, "impossible de supprimer : des écoles sont rattachées à cette IEP", http.StatusConflict)
                return
        }
        if err := database.DB.Delete(&models.IEP{}, "id = ?", id).Error; err != nil {
                middleware.JSONError(w, "erreur suppression", http.StatusInternalServerError)
                return
        }
        jsonResponse(w, http.StatusOK, map[string]string{"status": "deleted"})
}
