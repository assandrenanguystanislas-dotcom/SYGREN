"use client";

// === Décor officiel ivoirien — composants partagés des documents imprimables ===
//
// Utilisé par TOUS les documents imprimables des modules « Résultats » et
// « Bulletins » (et le Portail Parent) :
//   - CIFlagRibbon : ruban tricolore (bandes verticales orange-blanc-vert,
//     comme le drapeau de la Côte d'Ivoire) — filet décoratif des documents ;
//   - CIArmoiriesWatermark : ARMOIRIES DE LA RÉPUBLIQUE DE CÔTE D'IVOIRE en
//     FILIGRANE DANS LE FOND du document (image centrée, très faible
//     opacité, derrière le contenu — print-color-adjust: exact pour que le
//     filigrane sorte à l'impression).
//
// Couleurs officielles du drapeau : Orange #F77F00 · Blanc #FFFFFF ·
// Vert #009E60. Variantes pastel pour les fonds et assombries pour le
// texte (contraste à l'impression sur papier blanc).

import type { CSSProperties } from "react";

/** Orange du drapeau ivoirien. */
export const CI_ORANGE = "#F77F00";
/** Vert du drapeau ivoirien. */
export const CI_GREEN = "#009E60";
/** Vert assombri pour le TEXTE (contraste impression sur fond blanc). */
export const CI_GREEN_TEXT = "#00734A";
/** Orange assombri pour le TEXTE (contraste impression sur fond blanc). */
export const CI_ORANGE_TEXT = "#B85C00";
/** Fond pastel orange (lignes/bandeaux clairs). */
export const CI_ORANGE_BG = "#FDEBDA";
/** Fond pastel vert (lignes/bandeaux clairs). */
export const CI_GREEN_BG = "#E4F4ED";
/** Rouge des noms de FILLES (convention des tableaux de classement). */
export const CI_FILLE_RED = "#c00000";

/** Style commun pour que les couleurs (bandes, filigrane) sortent à
 *  l'impression (Chromium/WebKit : print-color-adjust). */
export const PRINT_COLOR_STYLE: CSSProperties = {
  WebkitPrintColorAdjust: "exact",
  printColorAdjust: "exact",
};

/** Ruban tricolore ivoirien — trois bandes VERTICALES orange-blanc-vert
 *  (comme le drapeau). Filet décoratif haut/bas des documents imprimables.
 *
 *  @param height épaisseur du ruban (défaut 2.6mm)
 *  @param bordered fine bordure grise autour du ruban (défaut true) */
export function CIFlagRibbon({
  height = "2.6mm",
  bordered = true,
}: {
  height?: string;
  bordered?: boolean;
}) {
  return (
    <div
      aria-hidden="true"
      style={{
        display: "flex",
        height,
        boxSizing: "border-box",
        border: bordered ? "0.5px solid #d1d5db" : "none",
        ...PRINT_COLOR_STYLE,
      }}
    >
      <div style={{ flex: 1, background: CI_ORANGE }} />
      <div style={{ flex: 1, background: "#FFFFFF" }} />
      <div style={{ flex: 1, background: CI_GREEN }} />
    </div>
  );
}

/** ARMOIRIES DE LA CÔTE D'IVOIRE en filigrane DANS LE FOND du document :
 *  image centrée (armoiries locales /ci-coat-of-arms.png — fiable à
 *  l'impression, sans dépendance réseau), très faible opacité, POSÉE
 *  DERRIÈRE le contenu (z-index 0, pointer-events none).
 *
 *  Le PARENT direct doit être `position: relative` (et son contenu
 *  `position: relative; z-index: 1`) pour que le filigrane reste dans le
 *  fond. `overflow: hidden` évite tout débordement sur les pages voisines.
 *
 *  @param opacity opacité du filigrane (défaut 0.055 — lisible en fond,
 *                 sans gêner la lecture du document)
 *  @param width largeur relative des armoiries (défaut 58%) */
export function CIArmoiriesWatermark({
  opacity = 0.055,
  width = "58%",
  fixed = false,
}: {
  opacity?: number;
  width?: string;
  /** mode "fixed" : le filigrane se répète sur CHAQUE page imprimée
   *  (documents multi-pages — relevé, synthèse, tableau de fin d'année). */
  fixed?: boolean;
}) {
  return (
    <div
      aria-hidden="true"
      style={{
        position: fixed ? "fixed" : "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 0,
        pointerEvents: "none",
        overflow: "hidden",
        ...PRINT_COLOR_STYLE,
      }}
    >
      <img
        src="/ci-coat-of-arms.png"
        alt=""
        style={{
          width,
          maxWidth: "150mm",
          opacity,
          ...PRINT_COLOR_STYLE,
        }}
      />
    </div>
  );
}
