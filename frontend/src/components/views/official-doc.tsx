"use client";

// === En-tête institutionnel officiel des documents PDA IEPP ===
// Reproduction fidèle de l'en-tête des documents officiels reçus de
// l'IEPP de Dabou (SUIVI PLURIANNUEL_1..4, PLAN D'ACTION IEPP_1) :
//   - bloc gauche : MINISTERE DE L'EDUCATION NATIONALE ET DE
//     L'ALPHABETISATION / DIRECTION REGIONALE DE … / ligne pointillée de
//     séparation / INSPECTION DE L'ENSEIGNEMENT PRESCOLAIRE ET PRIMAIRE
//     DE … / BP … Tél … / Courriel (lien bleu, style Word)
//   - bloc droit CENTRÉ : REPUBLIQUE DE CÔTE D'IVOIRE + armoiries
//     nationales + Union-Discipline-Travail (ordre variable selon le
//     document reçu : « plan » = devise au-dessus des armoiries ;
//     « fiche » = armoiries au-dessus de la devise en italique gras).
//
// POLICE OFFICIELLE : les documents reçus sont composés en Calibri
// (police Office). Carlito, clone métrique exact, est auto-hébergé
// (public/fonts + @font-face dans globals.css) : rendu identique partout
// (Windows utilise Calibri, les autres plateformes reçoivent Carlito).

import type { CSSProperties } from "react";

/** Police des documents officiels (Calibri reçue, Carlito métrique). */
export const OFFICIAL_FONT = `"Calibri", "Carlito", Arial, sans-serif`;

/** Encre noire pure (documents officiels). */
export const INK = "#000000";

/** Bordures « Excel » du modèle reçu : cadre épais, intérieur fin. */
export const THICK = "2px solid #000000";
export const THIN = "1px solid #000000";

/** Fond gris de la ligne TOTAL (modèle reçu). */
export const TOTAL_BG = "#d9d9d9";

/** Effectifs au format du document reçu : 07, 17, 1238 — case vide si
 *  aucune donnée (les « 00 » du modèle sont des saisies manuelles). */
export function fmtDocNum(n: number | undefined | null): string {
  if (n == null || n <= 0) return "";
  return n < 10 ? `0${n}` : `${n}`;
}

/** Pourcentages à 2 décimales, virgule française : 89,26% / 100,00% —
 *  case vide si l'évaluation n'a pas eu lieu (le #DIV/0! du modèle). */
export function fmtDocPct(n: number | undefined | null): string {
  if (n == null || n <= 0) return "";
  return `${n.toFixed(2).replace(".", ",")}%`;
}

export interface OfficialDocIep {
  name?: string;
  region?: string;
  bp?: string;
  inspector_phone?: string;
  inspector_email?: string;
}

const leftLine: CSSProperties = { lineHeight: 1.32 };

/** En-tête institutionnel complet (bloc ministériel + bloc République).
 *  size « lg » = A4 portrait (fiche résultat par école) ;
 *  size « sm » = A4 paysage (suivi pluriannuel) ;
 *  size « xs » = A4 paysage compact (plan réseau : tient sur 4 pages,
 *  l'en-tête du modèle consommait presque la moitié de la page 1). */
export function OfficialDocHeader({
  iep,
  variant,
  size,
}: {
  iep?: OfficialDocIep | null;
  variant: "plan" | "fiche";
  size: "sm" | "lg" | "xs";
}) {
  const name = (iep?.name || "…………").toUpperCase();
  const region = (iep?.region || iep?.name || "…………").toUpperCase();
  const base = size === "lg" ? 14 : size === "sm" ? 11 : 9.5;
  const arms = size === "lg" ? 64 : size === "sm" ? 50 : 38;
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        marginBottom: size === "lg" ? "10px" : size === "sm" ? "8px" : "4px",
      }}
    >
      {/* --- Bloc gauche : administration --- */}
      <div style={{ fontSize: `${base}px`, color: INK }}>
        <div style={leftLine}>MINISTERE DE L&apos;EDUCATION NATIONALE ET</div>
        <div style={{ ...leftLine, paddingLeft: "6px" }}>DE L&apos;ALPHABETISATION</div>
        <div style={leftLine}>DIRECTION REGIONALE DE {region}</div>
        <div
          style={{
            ...leftLine,
            letterSpacing: "2px",
            margin: "2px 0 2px 56px",
          }}
          aria-hidden="true"
        >
          ........................
        </div>
        <div style={leftLine}>INSPECTION DE L&apos;ENSEIGNEMENT</div>
        <div style={leftLine}>PRESCOLAIRE ET PRIMAIRE DE {name}</div>
        <div style={leftLine}>
          BP {iep?.bp || "……"}
          {"   "}
          Tél {iep?.inspector_phone || "…………"}
        </div>
        <div style={leftLine}>
          Courriel :{" "}
          <span style={{ color: "#0563C1", textDecoration: "underline" }}>
            {iep?.inspector_email || "…………"}
          </span>
        </div>
      </div>

      {/* --- Bloc droit : République + armoiries (centré) --- */}
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: `${base + 1}px`, color: INK }}>
          REPUBLIQUE DE CÔTE D&apos;IVOIRE
        </div>
        {variant === "plan" ? (
          <>
            <div style={{ fontSize: `${base}px`, color: INK, padding: "1px 0" }}>
              Union-Discipline-Travail
            </div>
            <img
              src="/ci-coat-of-arms.png"
              alt="Armoiries de la République de Côte d'Ivoire"
              style={{ height: `${arms}px`, margin: "2px auto 0", display: "block" }}
            />
          </>
        ) : (
          <>
            <img
              src="/ci-coat-of-arms.png"
              alt="Armoiries de la République de Côte d'Ivoire"
              style={{ height: `${arms}px`, margin: "3px auto", display: "block" }}
            />
            <div
              style={{
                fontSize: `${base}px`,
                fontStyle: "italic",
                fontWeight: 700,
                color: INK,
              }}
            >
              Union-Discipline-Travail
            </div>
          </>
        )}
      </div>
    </div>
  );
}
