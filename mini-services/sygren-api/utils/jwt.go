package utils

import (
	"errors"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// JWTClaims holds the authenticated user info embedded in the token.
type JWTClaims struct {
	UserID   string `json:"user_id"`
	Role     string `json:"role"`
	SchoolID string `json:"school_id,omitempty"`
	IEPID    string `json:"iep_id,omitempty"`
	jwt.RegisteredClaims
}

// GenerateToken creates a signed JWT for a user.
func GenerateToken(secret, userID, role string, schoolID, iepID string) (string, error) {
	claims := JWTClaims{
		UserID:   userID,
		Role:     role,
		SchoolID: schoolID,
		IEPID:    iepID,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(72 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			Issuer:    "sygren-api",
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(secret))
}

// ParseToken validates and parses a JWT string. Returns the claims.
func ParseToken(secret, tokenStr string) (*JWTClaims, error) {
	tokenStr = strings.TrimPrefix(tokenStr, "Bearer ")

	claims := &JWTClaims{}
	token, err := jwt.ParseWithClaims(tokenStr, claims, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, errors.New("méthode de signature invalide")
		}
		return []byte(secret), nil
	})
	if err != nil {
		return nil, err
	}
	if !token.Valid {
		return nil, errors.New("token invalide")
	}
	return claims, nil
}
