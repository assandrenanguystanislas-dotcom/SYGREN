package main

// KEEP-ALIVE — maintien en éveil de l'API sur le plan gratuit Render.
//
// STATUT : NEUTRALISÉ PAR DÉFAUT depuis le 28/11/2026 (demande utilisateur
// « il faut neutraliser le keep alive »). Cause : le maintien en éveil
// permanent de l'instance Render (auto-ping 07:00–22:00, ~15 h/jour) garde le
// pool de connexions Neon actif jour et nuit → heures de calcul du forfait
// gratuit Neon épuisées avant la fin du mois → « Your account or project has
// exceeded the quota » → log.Fatalf au boot → boucle de crash, connexion
// impossible sur sygren.vercel.app.
//
// RÉACTIVATION (volontaire) : variable d'environnement KEEPALIVE_ENABLED=true
// sur Render — uniquement APRÈS un passage au plan Neon Launch, sinon le
// quota saute à nouveau. main.go n'appelle startKeepAlive() que si cette
// variable vaut « true » (insensible à la casse).
//
// Fonctionnement (inchangé quand activé) : toutes les 10 minutes (marge de
// sécurité sous les 15 min de suspension), l'API s'appelle ELLE-MÊME sur son
// URL publique Render (RENDER_EXTERNAL_URL, fournie automatiquement par la
// plateforme) + /api/health. La requête transite par le proxy Render : elle
// compte comme du trafic entrant et remet le compteur d'inactivité à zéro.
//
// Fenêtre : TOUS LES JOURS 07:00–22:00, heure Côte d'Ivoire (GMT+0 toute
// l'année — FixedZone, aucun changement d'heure). Hors fenêtre (la nuit) :
// aucune requête émise, le service peut dormir — les heures du forfait
// gratuit sont économisées (15 h/jour ≈ 455 h/mois, pour un plafond de
// 750 h).
//
// En local ou sans RENDER_EXTERNAL_URL : keep-alive désactivé — aucun appel.

import (
	"log"
	"net/http"
	"os"
	"time"
)

const (
	keepAliveInterval  = 10 * time.Minute // < 15 min (délai de suspension Render)
	keepAliveStartHour = 7                // fenêtre : 07:00 GMT+0 inclus
	keepAliveEndHour   = 22               // fenêtre : jusqu'à 22:00 GMT+0 exclue
)

// startKeepAlive lance la boucle d'auto-ping (à appeler en goroutine).
// Volontairement silencieux en cas de succès (1 ping / 10 min — ne pas
// polluer les logs) ; chaque échec est journalisé avec son erreur.
func startKeepAlive() {
	base := os.Getenv("RENDER_EXTERNAL_URL")
	if base == "" {
		log.Println("[KEEPALIVE] Désactivé — RENDER_EXTERNAL_URL absente (environnement local)")
		return
	}
	url := base + "/api/health"
	log.Printf("[KEEPALIVE] Actif — auto-ping %s toutes les 10 min (tous les jours 07:00–22:00 GMT+0)", url)

	client := &http.Client{Timeout: 30 * time.Second}
	gmt0 := time.FixedZone("GMT", 0) // Côte d'Ivoire : GMT+0, aucun DST
	ping := func() {
		now := time.Now().In(gmt0)
		if now.Hour() < keepAliveStartHour || now.Hour() >= keepAliveEndHour {
			return // hors fenêtre : le service peut s'endormir
		}
		resp, err := client.Get(url)
		if err != nil {
			log.Printf("[KEEPALIVE] ping échoué : %v", err)
			return
		}
		resp.Body.Close()
	}

	// 30 s de grâce : laisser le serveur HTTP s'attacher au port avant le
	// premier ping (éviter de se pinguer soi-même pendant le boot).
	time.Sleep(30 * time.Second)
	ping()

	ticker := time.NewTicker(keepAliveInterval)
	defer ticker.Stop()
	for range ticker.C {
		ping()
	}
}
