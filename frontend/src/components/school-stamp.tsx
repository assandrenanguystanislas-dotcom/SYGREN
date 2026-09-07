"use client";

// === Tampon rond de l'école (encre bleue) — documents officiels ===
//
// Demande utilisateur : reproduire le tampon scanné (« COLLÈGE MARCEL
// PAGNOL / ASSOCIATION SPORTIVE / 72230 ARNAGE ») en l'adaptant :
//   - texte du HAUT (courbé) : NOM DE L'ÉCOLE — adapté selon l'école ;
//   - texte du MILIEU : « DIRECTEUR » (remplace « Association Sportive ») ;
//   - texte du BAS (courbé, hauts des lettres vers le centre — comme un
//     vrai tampon rond) : « IEPP DABOU - 1 » — dérivé du nom d'IEP en base
//     (« IEP DABOU 1 » → « IEPP DABOU - 1 », voir ieppStampLabel).
//
// Placement (demande) : JUSTE AU-DESSUS du nom du directeur, précisément
// vers la droite — dans chaque document, le tampon est ancré (absolute,
// bottom:100%) à l'élément portant le nom, aligné à droite : AUCUN impact
// sur le flux de la page (aucun risque de débordement à l'impression).
//
// Technique : SVG inline (impression navigateur — zéro PDF serveur,
// discipline du projet). Le trait et le texte portent print-color-adjust:
// exact pour que l'encre bleue sorte à l'impression. Le SVG en attributs
// (width/height + viewBox) s'imprime net à toutes les tailles.

import type { CSSProperties } from "react";

/** Encre du tampon (bleu classique de cachet d'école). */
export const STAMP_INK = "#1c46c8";

/** « IEP DABOU 1 » → « IEPP DABOU - 1 » (libellé du bas du tampon,
 *  demande utilisateur). Un nom déjà en « IEPP … » est conservé tel quel ;
 *  sans numéro, la partie « - N » est omise ; vide → chaîne vide (le texte
 *  du bas n'est pas rendu). */
export function ieppStampLabel(iepName?: string | null): string {
  const n = (iepName ?? "").trim().toUpperCase();
  if (!n) return "";
  if (n.startsWith("IEPP")) return n;
  const m = n.match(/^IEP\s+(.+?)(?:\s+(\d+|[IVX]+))?$/);
  if (m) return m[2] ? `IEPP ${m[1]} - ${m[2]}` : `IEPP ${m[1]}`;
  return n;
}

/** Taille de police (unités du viewBox 200) du nom d'école courbé,
 *  adaptée à la longueur (les noms ivoiriens vont de « EC EDEN » à
 *  « EPC NOTRE DAME DE LA PAIX 1 »). */
function schoolFontSize(name: string): number {
  const len = name.length;
  if (len <= 12) return 15;
  if (len <= 18) return 13;
  if (len <= 24) return 11.5;
  return 10;
}

export function SchoolStamp({
  school,
  iep,
  size = 104,
  tilt = -6,
  className,
  style,
}: {
  /** Nom de l'école (texte courbé du haut — majuscules forcées). */
  school: string;
  /** Nom d'IEP brut (« IEP DABOU 1 ») — restitué « IEPP DABOU - 1 » en bas. */
  iep?: string | null;
  /** Taille rendue en pixels (≈ 27 mm à 96 dpi par défaut). */
  size?: number;
  /** Légère inclinaison (degrés) — comme un tampon posé à la main ;
   *  0 = parfaitement droit. */
  tilt?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const name = (school ?? "").trim().toUpperCase() || "ECOLE";
  const bottom = ieppStampLabel(iep);

  return (
    <svg
      viewBox="0 0 200 200"
      width={size}
      height={size}
      aria-hidden="true"
      className={className}
      style={{
        transform: tilt ? `rotate(${tilt}deg)` : undefined,
        WebkitPrintColorAdjust: "exact",
        printColorAdjust: "exact",
        ...style,
      }}
    >
      {/* Double cercle du cachet */}
      <circle cx="100" cy="100" r="96" fill="none" stroke={STAMP_INK} strokeWidth="4.6" />
      <circle cx="100" cy="100" r="89" fill="none" stroke={STAMP_INK} strokeWidth="1.4" />

      {/* Texte du HAUT — nom de l'école, courbé le long de l'arc supérieur
          (baseline r=76, corps des lettres vers l'extérieur, sous le
          cercle intérieur r=89). */}
      <path id="stamp-arc-top" d="M 24,100 A 76,76 0 0 1 176,100" fill="none" />
      <text
        fill={STAMP_INK}
        fontSize={schoolFontSize(name)}
        fontWeight="700"
        letterSpacing="0.6"
        fontFamily="'Carlito','Calibri','Segoe UI',Arial,sans-serif"
      >
        <textPath href="#stamp-arc-top" startOffset="50%" textAnchor="middle">
          {name}
        </textPath>
      </text>

      {/* Étoiles séparatrices gauche/droite (sur le cercle intérieur) */}
      <text
        x="11"
        y="100"
        fill={STAMP_INK}
        fontSize="10"
        textAnchor="middle"
        dominantBaseline="central"
        fontFamily="Arial,sans-serif"
      >
        ★
      </text>
      <text
        x="189"
        y="100"
        fill={STAMP_INK}
        fontSize="10"
        textAnchor="middle"
        dominantBaseline="central"
        fontFamily="Arial,sans-serif"
      >
        ★
      </text>

      {/* Texte du MILIEU — « DIRECTEUR » (droit, espacé) */}
      <text
        x="100"
        y="97"
        fill={STAMP_INK}
        fontSize="17"
        fontWeight="700"
        letterSpacing="2.6"
        textAnchor="middle"
        fontFamily="'Carlito','Calibri','Segoe UI',Arial,sans-serif"
      >
        DIRECTEUR
      </text>

      {/* Texte du BAS — IEPP, courbé le long de l'arc inférieur
          (baseline r=85, hauts des lettres vers le CENTRE — sens de
          lecture normal, comme un vrai tampon rond ; masqué si l'IEP
          n'est pas connue). */}
      {bottom ? (
        <>
          <path id="stamp-arc-bottom" d="M 15,100 A 85,85 0 0 0 185,100" fill="none" />
          <text
            fill={STAMP_INK}
            fontSize="10.5"
            fontWeight="600"
            letterSpacing="1.1"
            fontFamily="'Carlito','Calibri','Segoe UI',Arial,sans-serif"
          >
            <textPath href="#stamp-arc-bottom" startOffset="50%" textAnchor="middle">
              {bottom}
            </textPath>
          </text>
        </>
      ) : null}
    </svg>
  );
}

/** Enveloppe d'ancrage du tampon : à poser AUTOUR de l'élément portant le
 *  nom du directeur (ou du libellé « Le Directeur » quand le nom n'est pas
 *  imprimé). Le tampon se place ABSOLU, juste au-dessus, aligné à droite —
 *  le flux du document est inchangé. */
export function StampAnchor({
  children,
  size,
  school,
  iep,
  offsetX = 0,
  stampStyle,
}: {
  children: React.ReactNode;
  /** Taille du tampon (px) — voir SchoolStamp. */
  size?: number;
  school: string;
  iep?: string | null;
  /** Décalage horizontal supplémentaire (px) — « précisément vers la
   *  droite » : positif = décale le tampon à droite du bord du nom. */
  offsetX?: number;
  stampStyle?: CSSProperties;
}) {
  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      <div
        style={{
          position: "absolute",
          right: offsetX,
          bottom: "calc(100% - 4px)",
          pointerEvents: "none",
        }}
      >
        <SchoolStamp school={school} iep={iep} size={size} style={stampStyle} />
      </div>
      {children}
    </div>
  );
}
