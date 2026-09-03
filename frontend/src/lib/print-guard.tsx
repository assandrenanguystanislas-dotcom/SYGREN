"use client";

// === Verrou d'impression des documents officiels (v2) ===
//
// POLITIQUE D'ACCÈS (demande utilisateur) :
//   - Les documents imprimables des modules « Résultats » et « Bulletins »
//     sont VERROUILLÉS À L'IMPRESSION pour les enseignants et les
//     directeurs (le directeur peut les CONSULTER à l'écran, l'enseignant
//     n'y accède pas du tout) ;
//   - Seuls l'ADMIN IEP (inspector) et le SUPER ADMIN (admin) impriment ;
//   - Le PARENT imprime UNIQUEMENT le bulletin individuel de son enfant
//     depuis le Portail Parent (pages ouvertes en mode parent — les URLs
//     portent &matricule=… et le rôle parent est explicitement autorisé
//     sur CE document uniquement).
//
// Double barrière :
//   1. UI : le bouton « Imprimer » est remplacé par un badge de verrou ;
//   2. CSS : en @media print, le document est masqué et remplacé par un
//      message « impression verrouillée » (même Ctrl+P n'extrait rien).

import { useEffect, useState } from "react";

import { authApi, getStoredToken } from "./api";
import { useAuthStore } from "./auth-store";

/** Rôles autorisés à imprimer les documents internes. */
export function canPrintInternal(role: string | null | undefined): boolean {
  return role === "admin" || role === "inspector";
}

/** Le rôle parent peut-il imprimer CE document ? Uniquement en mode parent
 *  (bulletin individuel de son enfant — matricule présent dans l'URL). */
export function canPrintDocument(
  role: string | null | undefined,
  parentMode: boolean,
): boolean {
  if (canPrintInternal(role)) return true;
  if (role === "parent") return parentMode;
  return false;
}

/** Hook : résout le rôle du user courant sur les pages d'impression.
 *  Les pages sont ouvertes dans un nouvel onglet avec le token dans l'URL
 *  (stocké dans localStorage) — si le profil n'est pas encore dans le
 *  store (nouvelle session navigateur), on le recharge via /api/me. */
export function usePrintRole(): string | null | undefined {
  const user = useAuthStore((s) => s.user);
  // Token : le store Zustand peut être VIDE dans un nouvel onglet ouvert
  // via ?t=… (seul localStorage l'a — cf. storeUrlTokenIfPresent) — on lit
  // donc le token localStorage en priorité.
  const [lsToken] = useState<string | null>(() => getStoredToken());
  const [fetchedRole, setFetchedRole] = useState<string | null>(null);

  useEffect(() => {
    // Rien à résoudre : rôle déjà connu, ou pas de token du tout.
    if (user?.role || !lsToken) return;
    let cancelled = false;
    authApi
      .me()
      .then((u) => {
        if (cancelled) return;
        useAuthStore.setState({ user: u });
        setFetchedRole(u.role);
      })
      .catch(() => {
        // Token invalide/expiré → rôle null (impression verrouillée).
        if (!cancelled) setFetchedRole(null);
      });
    return () => {
      cancelled = true;
    };
  }, [user, lsToken]);

  // Valeur DÉRIVÉE au rendu (pas de setState synchrone dans l'effet) :
  //   - profil présent → son rôle ;
  //   - pas de token → null (verrou) ;
  //   - token sans profil → rôle fetché (null tant que /api/me est en
  //     cours — le verrou s'affiche puis se lève, défense par défaut).
  if (user?.role) return user.role;
  if (!lsToken) return null;
  return fetchedRole;
}

/** Stocke le token passé dans l'URL (?t=…) dans localStorage — même
 *  mécanique que /bulletins. À appeler au DÉBUT du corps des pages de
 *  documents (rendu synchrone, AVANT les requêtes des composants enfants)
 *  pour que l'ouverture directe d'un lien (nouvel onglet sans état
 *  préexistant) fonctionne. Idempotent, sans effet si pas de paramètre. */
export function storeUrlTokenIfPresent() {
  if (typeof window === "undefined") return;
  try {
    const t = new URLSearchParams(window.location.search).get("t");
    if (!t) return;
    const raw = localStorage.getItem("sygren-auth");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.state) {
        parsed.state.token = t;
        localStorage.setItem("sygren-auth", JSON.stringify(parsed));
        return;
      }
    }
    localStorage.setItem(
      "sygren-auth",
      JSON.stringify({ state: { token: t }, version: 0 }),
    );
  } catch {
    /* localStorage indisponible — la requête affichera l'erreur */
  }
}

/** Bannière de verrou affichée à la place du bouton d'impression. */
export function PrintLockBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md bg-amber-100 px-3 py-1.5 text-xs font-semibold text-amber-800 border border-amber-300">
      🔒 Impression verrouillée — réservée à l&apos;Admin IEP
    </span>
  );
}

/** Message imprimé à la place du document quand l'impression est
 *  verrouillée (blocage CSS @media print). */
export function PrintLockDocumentMessage() {
  return (
    <div className="print-lock-message min-h-screen hidden flex-col items-center justify-center gap-3 p-10 text-center">
      <div className="text-5xl">🔒</div>
      <h1 className="text-xl font-bold">
        IMPRESSION VERROUILLÉE
      </h1>
      <p className="text-sm max-w-md">
        Les documents officiels SYGREN ne peuvent être imprimés que par
        l&apos;Admin IEP. Votre rôle ne dispose pas de l&apos;autorisation
        d&apos;impression — contactez l&apos;inspection de votre
        circonscription pour obtenir le bulletin ou le document officiel.
      </p>
    </div>
  );
}
