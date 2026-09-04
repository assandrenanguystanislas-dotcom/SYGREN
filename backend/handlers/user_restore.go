package handlers

// === Restauration des comptes supprimés (soft-delete GORM) — correctif accès ===
//
// Les suppressions de comptes sont des soft-deletes (deleted_at) pour
// préserver l'intégrité référentielle (audits, résultats, sessions).
// Or les index UNIQUE sur users.phone / users.email couvrent TOUTES les
// lignes : un compte supprimé bloquait donc les deux accès :
//   - la CONNEXION (compte invisible pour l'ORM → « identifiants
//     invalides » / « aucun utilisateur rattaché à cette école ») ;
//   - la RÉINSCRIPTION (INSERT refusé par la contrainte unique → 500).
//
// Stratégie (correctif « accès directeurs / enseignants / parents ») :
// à toute création de compte, si un compte SUPPRIMÉ de même rôle porte
// déjà le téléphone ou l'email demandé, on le RESTAURE (mise à jour des
// champs + deleted_at = NULL). L'accès redevient immédiatement
// fonctionnel ; les comptes vivants restent protégés par les règles
// d'unicité existantes (409).

import (
	"strings"

	"sygren-api/database"
	"sygren-api/models"
	"sygren-api/utils"

	"gorm.io/gorm"
)

// restoreSoftDeletedUser cherche un compte soft-deleted de même rôle
// portant le téléphone ou l'email demandé et le restaure avec les
// données de la nouvelle requête (mot de passe re-haché — standard :
// le numéro de téléphone). Retourne (user restauré, true) si une
// restauration a été effectuée, sinon (nil, false).
func restoreSoftDeletedUser(role, fullName string, phone, email, schoolID *string, password string, extra func(*models.User)) (*models.User, bool) {
	// Normalisation : email vide → nil (évite les conflits d'unicité)
	if email != nil && strings.TrimSpace(*email) == "" {
		email = nil
	}

	q := database.DB.Unscoped().
		Where("deleted_at IS NOT NULL AND role = ?", role)
	if phone != nil && *phone != "" {
		q = q.Where("phone = ?", *phone)
	}
	if email != nil && *email != "" {
		q = q.Where("email = ?", *email)
	}
	var deleted models.User
	if err := q.First(&deleted).Error; err != nil {
		return nil, false
	}

	hashed, err := utils.HashPassword(password)
	if err != nil {
		return nil, false
	}

	deleted.FullName = fullName
	deleted.Phone = phone
	deleted.Email = email
	if schoolID != nil && *schoolID != "" {
		deleted.SchoolID = schoolID
	}
	deleted.Password = hashed
	deleted.Active = true
	deleted.MustChangePassword = false
	if extra != nil {
		extra(&deleted)
	}
	// Annule le soft-delete (deleted_at = NULL) — Unscoped requis car
	// le modèle est exclu des requêtes par défaut tant que deleted_at
	// est renseigné.
	deleted.DeletedAt = gorm.DeletedAt{}
	if err := database.DB.Unscoped().Save(&deleted).Error; err != nil {
		return nil, false
	}
	return &deleted, true
}
