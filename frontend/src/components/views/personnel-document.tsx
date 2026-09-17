"use client";

// === Document officiel « ÉTAT NOMINATIF DU PERSONNEL » ===
// Reproduction FIDÈLE de l'architecture du document reçu de l'IEPP
// (A4 paysage) :
//   - En-tête institutionnel (bloc ministériel + République +
//     Union-Discipline-Travail + armoiries) — même gabarit que les
//     autres documents officiels validés ;
//   - Boîte à bord arrondi avec le titre « ETAT NOMINATIF DU
//     PERSONNEL » (police à empattements, comme le modèle) ;
//   - Ligne « Ecole : … » / « Année scolaire : 2025 2026 » ;
//   - Tableau 21 colonnes du modèle : N° | Nom et prénoms | Matricule |
//     Date et lieu de naissance | IO IA IS IAS | Classe | Échelon |
//     Date entrée F.P | Fonction | Dates (Entrée DREN | Entrée IEP |
//     Arrivée au poste) | Cours | Effectif (F|G|T) | Redoublants (F|G|T)
//     | Contact | Emargement — avec une ligne vide supplémentaire (le
//     modèle) ;
//   - N° ordre ; noms des femmes EN ROUGE (N.B du modèle) ;
//   - Ligne TOTAL CALCULÉE : somme des effectifs et des redoublants
//     saisis (colonne sans aucune donnée → case vide, comme les « # »
//     du modèle) ;
//   - Signature « Le Directeur », N.B (RPL / MAC / MSC) et mention
//     « (A RETOURNER EN 03 EXEMPLAIRES) ».
//
// v3 — EMBELLISSEMENT DRAPEAU CI (inspiré des bulletins individuels) :
//   - Rubans tricolores orange-blanc-vert haut/bas du document ;
//   - ARMOIRIES DE LA RÉPUBLIQUE en filigrane dans le fond (chaque page) ;
//   - Bandeau/bandeaux d'entête du tableau en VERT DRAPEAU (texte blanc) ;
//   - Bordures du tableau en vert drapeau ; boîte du titre sur fond
//     pastel orange bordé de vert ; ligne TOTAL sur fond pastel vert.
//
// v4 — ARIAL 12 (demande utilisateur, module Utilisateurs) :
//   - Tout le document passe en police ARIAL (fallback Helvetica /
//     Liberation Sans — métriques identiques sous Linux) ;
//   - Contenu du tableau porté à 12px (comme la LISTE DES CANDIDATS) ;
//   - NOMS ET PRÉNOMS du personnel sur UNE SEULE LIGNE : cellule
//     insécable (nowrap) + colonne élargie et largeurs des 21 colonnes
//     rééquilibrées en conséquence.
//
// v5 — LECTURE VERTICALE + ARIAL 10 CADRES + CONTACTS SANS +225
//   (demande utilisateur) :
//   - Entêtes CLASSE, ÉCHELON et COURS écrits VERTICALEMENT (bas → haut,
//     writing-mode vertical-rl + rotation 180°) comme sur les tableaux
//     administratifs — colonnes étroites préservées ;
//   - Lignes du DIRECTEUR / de la DIRECTRICE et de l'ADJOINT(E) (fonction
//     déclarée dans le dossier) en ARIAL 10 ;
//   - Colonne CONTACT en ARIAL 10, préfixe « +225 » retiré à l'affichage
//     (+2250101263515 → 0101263515) ; les numéros saisis sans indicatif
//     passent inchangés.
//
// v6 — NOM DU DIRECTEUR + 3 MODÈLES D'IMPRESSION (demande utilisateur :
// « étendre les 3 modèles PDF / Word / Excel à tous les documents ») :
//   - Le nom du DIRECTEUR (agent dont role === "director", dérivé de la
//     liste du personnel) s'affiche SOUS « Le Directeur » en caractère
//     d'imprimerie (majuscules, gras) — même style que les autres
//     documents officiels ;
//   - Le bouton unique « Imprimer / PDF » devient la barre uniforme
//     PDF / Word / Excel (lib partagée doc-export.tsx, état exporting) :
//       · Word (.doc) : HTML MSO A4 PAYSAGE fidèle au PDF (en-tête
//         institutionnel, tableau 21 colonnes — entêtes CLASSE /
//         ÉCHELON / COURS remis à l'horizontale —, TOTAL, signature +
//         NOM, N.B et mention « A RETOURNER EN 03 EXEMPLAIRES ») ;
//       · Excel (.xlsx) : classeur exceljs PAYSAGE ajusté à 1 page de
//         large (en-tête institutionnel fusionné, tableau bordé vert,
//         femmes en rouge, TOTAL en gras, signature + NOM).
//
// v7 — ORDRE DES COURS (demande utilisateur) : les lignes suivent la
//   séquence CP1 → CP2 → CE1 → CE2 → CM1 → CM2 (tri serveur — tout
//   agent tenant un cours, DIRECTEUR COMPRIS, occupe la position de son
//   cours ; le directeur sans cours reste en tête ; agents sans cours à
//   la suite). Les 3 modèles (PDF / Word / Excel) partagent la même
//   liste triée par l'API.
//
// v8 — RUBRIQUE FONCTION (demande utilisateur) : première lettre en
//   MAJUSCULE et le reste en minuscules — « DIRECTEUR » → « Directeur »,
//   « ADJOINT(E) » → « Adjoint(e) » — dans les 3 modèles (PDF / Word /
//   Excel) via le helper commun fmtFonction ; la valeur stockée reste
//   inchangée (validation backend DIRECTEUR / ADJOINT(E)).
//
// Données : /api/reports/personnel?school_id=… (source unique — le
// document ne recalcule rien de plus que les totaux affichés).
// Impression 100 % navigateur A4 paysage (route dédiée /personnel-doc,
// isolement #personnel-doc, lignes insécables).

import { useQuery } from "@tanstack/react-query";
import { Loader2, X } from "lucide-react";
import { useState, type CSSProperties } from "react";

import { reportsApi } from "@/lib/api";
import {
  DocExportButtons,
  XLSX_MIME,
  armoiriesBase64,
  buildWordShell,
  escHtml,
  saveBlob,
  saveWordDoc,
  slugFile,
} from "@/lib/doc-export";
import {
  canPrintDocument,
  PrintLockBadge,
  PrintLockDocumentMessage,
  usePrintRole,
} from "@/lib/print-guard";
import {
  CLASSE_GRADE_LABELS,
} from "@/components/personnel-dossier-fields";
import { formatDossierDate, type PersonnelStaffRow } from "@/lib/types";

import {
  INK,
  OfficialDocHeader,
} from "./official-doc";
import {
  CIArmoiriesWatermark,
  CI_GREEN,
  CI_GREEN_BG,
  CI_GREEN_TEXT,
  CI_ORANGE_BG,
  PRINT_COLOR_STYLE,
} from "@/components/ci-decor";

// POLICE ARIAL taille 12 (demande utilisateur) — Helvetica/Liberation Sans
// en secours (métriques identiques, Linux). Même choix que la LISTE DES
// CANDIDATS AU CEPE.
const DOC_FONT = '"Arial", "Helvetica", "Liberation Sans", sans-serif';

/** Effectif/redoublant au format du document reçu : 07, 11, 147 —
 *  « 00 » pour un zéro SAISI, case vide si non renseigné (les « # »). */
function fmtNum(n: number | null | undefined): string {
  if (n == null) return "";
  return n < 10 ? `0${n}` : `${n}`;
}

/** Somme d'une colonne F/G/T : null seulement si AUCUNE valeur saisie. */
function sumCol(values: Array<number | null | undefined>): number | null {
  const vals = values.filter((v): v is number => v != null);
  if (vals.length === 0) return null;
  return vals.reduce((a, b) => a + b, 0);
}

/** CONTACT : préfixe « +225 » retiré à l'affichage (demande utilisateur)
 *  — « +2250101263515 » → « 0101263515 ». Un numéro saisi sans indicatif
 *  passe inchangé ; un numéro qui NE commence PAS par 225 aussi. */
function fmtContact(v: string | null | undefined): string {
  const s = (v ?? "").trim();
  if (!s) return "";
  return s.replace(/^\+?225/, "").trim();
}

/** FONCTION (v8 — demande utilisateur) : première lettre en MAJUSCULE
 *  et le reste en MINUSCULES — « DIRECTEUR » → « Directeur »,
 *  « ADJOINT(E) » → « Adjoint(e) ». La valeur STOCKÉE reste inchangée
 *  (la validation backend attend DIRECTEUR / ADJOINT(E)) ; seule la
 *  rubrique FONCTION des 3 modèles (PDF / Word / Excel) est retouchée
 *  à l'affichage. Vide si non renseignée. */
function fmtFonction(v: string | null | undefined): string {
  const s = (v ?? "").trim();
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

// Bordures du tableau en VERT DRAPEAU (inspiration bulletins individuels)
// et entêtes sur FOND VERT DRAPEAU (texte blanc, sortent à l'impression
// grâce à print-color-adjust: exact).
const th: CSSProperties = {
  border: `1px solid ${CI_GREEN}`,
  padding: "2px 3px",
  fontSize: "12px", // ARIAL 12 (demande utilisateur)
  lineHeight: 1.2,
  fontWeight: 700, // entêtes en gras comme le modèle reçu
  textAlign: "center",
  verticalAlign: "middle",
  color: "#ffffff",
  background: CI_GREEN,
  ...PRINT_COLOR_STYLE,
};

const td: CSSProperties = {
  border: `1px solid ${CI_GREEN}`,
  padding: "1px 3px",
  fontSize: "12px", // ARIAL 12 (demande utilisateur)
  lineHeight: 1.25,
  textAlign: "center",
  verticalAlign: "middle",
  color: INK,
  height: "18px",
};

/** Cellule NOM ET PRÉNOMS : session 40 — noms du personnel TOUJOURS
 *  COMPLETS (ancienne demande « une seule ligne » rapportée : les noms
 *  longs passent désormais à la ligne au lieu d'être coupés). */
const tdLeft: React.CSSProperties = { ...td, textAlign: "left" };

const tdNom: React.CSSProperties = {
  ...tdLeft,
  // Demande utilisateur (session 40) : noms complets — plus de
  // nowrap/overflow hidden ; les noms longs passent à la ligne.
  overflowWrap: "break-word",
};

/** Cellule CONTACT : ARIAL 10 (demande utilisateur) — la colonne entière
 *  est uniformisée (le « +225 » retiré par fmtContact allège aussi le
 *  contenu). */
const tdContact: React.CSSProperties = {
  ...tdLeft,
  fontSize: "10px",
  whiteSpace: "nowrap",
  overflow: "hidden",
};

/** Libellé d'entête écrit VERTICALEMENT (bas → haut) : CLASSE, ÉCHELON,
 *  COURS — demande utilisateur. writing-mode vertical + rotation 180°,
 *  lisible de bas en haut comme sur les tableaux administratifs. */
const thVerticalSpan: CSSProperties = {
  writingMode: "vertical-rl",
  transform: "rotate(180deg)",
  display: "inline-block",
  whiteSpace: "nowrap",
  letterSpacing: "0.5px",
};

/** Cellule d'entête verticale : padding réduit (la colonne est étroite). */
const thVertical: CSSProperties = { ...th, padding: "3px 2px" };

export function PersonnelDocument({
  schoolId,
  onClose,
}: {
  schoolId: string;
  onClose: () => void;
}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["personnel-sheet", schoolId],
    queryFn: () => reportsApi.personnelSheet(schoolId),
  });

  // Task 23 — verrou d'impression : consultation à l'écran ouverte aux
  // rôles autorisés par le backend, mais la zone « Imprimer / PDF » est
  // GRISÉE (l'impression reste réservée à l'Admin IEP et au Super Admin).
  const printRole = usePrintRole();
  const canPrint = canPrintDocument(printRole, false);

  // v6 — 3 modèles d'impression : état du modèle en cours de génération
  // (spinner sur le bouton Word ou Excel pendant le téléchargement).
  const [exporting, setExporting] = useState<"doc" | "xlsx" | null>(null);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-2">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">
            Chargement de l&apos;état nominatif…
          </p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-destructive mb-3">
            Impossible de charger l&apos;état nominatif
            {(error as Error)?.message ? ` — ${(error as Error).message}` : ""}
          </p>
          <button
            onClick={onClose}
            className="px-3 py-1.5 bg-gray-200 rounded-md text-sm"
          >
            Fermer
          </button>
        </div>
      </div>
    );
  }

  const staff = data.staff;
  // v6 — nom du directeur signataire : l'agent dont le rôle vaut
  // « director » (v7 : le serveur le place en tête uniquement s'il ne
  // tient pas de cours — sinon sa ligne prend la position de son cours,
  // le nom du signataire reste trouvé par le rôle, quelle que soit sa
  // position) — affiché SOUS « Le Directeur » et repris par les modèles
  // Word / Excel.
  const directeurName =
    data.staff.find((r) => r.role === "director")?.full_name ?? "";
  const totalEffF = sumCol(staff.map((s) => s.effectif_f));
  const totalEffG = sumCol(staff.map((s) => s.effectif_g));
  const totalEffT = sumCol(staff.map((s) => s.effectif_t));
  const totalRedF = sumCol(staff.map((s) => s.redoublant_f));
  const totalRedG = sumCol(staff.map((s) => s.redoublant_g));
  const totalRedT = sumCol(staff.map((s) => s.redoublant_t));

  // v6 — données partagées par les modèles Word / Excel (mêmes en-têtes
  // d'origine que le PDF : école, IEP, année scolaire, directeur).
  const exportData: ExportData = {
    staff,
    schoolName: data.school.name,
    anneeScolaire: data.annee_scolaire,
    iepRegion: data.iep?.region ?? "",
    iepName: data.iep?.name ?? "",
    iepBp: data.iep?.bp ?? "",
    iepPhone: data.iep?.inspector_phone ?? "",
    iepEmail: data.iep?.inspector_email ?? "",
    directeur: directeurName,
  };

  // Modèle WORD (.doc) — HTML MSO A4 paysage fidèle au document imprimé
  // (armoiries récupérées au passage — meilleur effort).
  async function handleWord() {
    setExporting("doc");
    try {
      saveWordDoc(
        await buildWordHtml(exportData),
        `etat-nominatif-personnel-${slugFile(exportData.schoolName)}-${slugFile(exportData.anneeScolaire)}.doc`,
      );
    } finally {
      setExporting(null);
    }
  }

  // Modèle EXCEL (.xlsx) — classeur mis en page (exceljs importé à la demande).
  async function handleExcel() {
    setExporting("xlsx");
    try {
      await exportExcelAsync(exportData);
    } finally {
      setExporting(null);
    }
  }

  return (
    <div className="min-h-screen bg-gray-100 print:bg-white">
      {/* Barre d'outils (masquée à l'impression) */}
      <div className="sticky top-0 z-10 flex items-center justify-between bg-white border-b px-4 py-2 print:hidden">
        <h3 className="font-semibold text-sm">
          État nominatif du personnel — {data.school.name} · {data.count}{" "}
          agent(s) · Année {data.annee_scolaire}
        </h3>
        <div className="flex items-center gap-2">
          {canPrint ? (
            // v6 — barre uniforme des 3 modèles (PDF = impression
            // navigateur, Word .doc, Excel .xlsx).
            <DocExportButtons
              canPrint
              exporting={exporting}
              onPdf={() => window.print()}
              onWord={handleWord}
              onExcel={handleExcel}
              formatHint="Format : A4 paysage"
            />
          ) : (
            <PrintLockBadge />
          )}
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-200 rounded-md text-sm"
          >
            <X className="w-4 h-4" />
            Fermer
          </button>
        </div>
      </div>

      {/* === DOCUMENT OFFICIEL (isolement impression #personnel-doc) === */}
      {!canPrint && <PrintLockDocumentMessage />}
      <div
        id="personnel-doc"
        className={`bg-white mx-auto shadow-lg print:shadow-none mt-3 ${canPrint ? "" : "print-locked"}`}
        style={{
          width: "100%",
          maxWidth: "297mm", // A4 paysage
          padding: "5mm 7mm",
          fontFamily: DOC_FONT, // ARIAL 12 (demande utilisateur)
          color: INK,
          overflowX: "auto",
          position: "relative", // filigrane armoiries DANS LE FOND
        }}
      >
        {/* (Ruban tricolore du haut RETIRÉ : aucune bordure drapeau sur
            les feuilles imprimables.) */}
        {/* --- ARMOIRIES DE LA CÔTE D'IVOIRE en filigrane (fond, répétées
            sur chaque page imprimée) --- */}
        <CIArmoiriesWatermark fixed />
        <div style={{ position: "relative", zIndex: 1 }}>
        {/* --- En-tête institutionnel (bloc ministériel + République + armoiries) --- */}
        <OfficialDocHeader iep={data.iep} variant="plan" size="sm" />

        {/* --- Boîte du titre (bord arrondi VERT DRAPEAU, fond pastel
            orange — inspiration bulletins individuels) --- */}
        <div style={{ textAlign: "center", margin: "2px 0 6px" }}>
          <span
            style={{
              display: "inline-block",
              border: `2.2px solid ${CI_GREEN}`,
              borderRadius: "14px",
              padding: "6px 30px 7px",
              // Police ARIAL (héritée du document — demande utilisateur).
              fontSize: "19px",
              fontWeight: 700,
              letterSpacing: "1.5px",
              lineHeight: 1.25,
              color: INK,
              background: CI_ORANGE_BG,
              boxShadow: `2.5px 2.5px 0 ${CI_GREEN_BG}`,
              textAlign: "center",
              ...PRINT_COLOR_STYLE,
            }}
          >
            ETAT NOMINATIF DU
            <br />
            PERSONNEL
          </span>
        </div>

        {/* --- Ligne École / Année scolaire --- */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            fontSize: "12px",
            margin: "0 2px 3px",
            color: INK,
          }}
        >
          <span>
            <span style={{ color: CI_GREEN_TEXT }}>Ecole</span>: {data.school.name}
          </span>
          <span>
            <span style={{ color: CI_GREEN_TEXT }}>Année scolaire</span>: {data.annee_scolaire.split(" ")[0]}&nbsp;&nbsp;
            {data.annee_scolaire.split(" ")[1] ?? ""}
          </span>
        </div>

        {/* --- Tableau du modèle (21 colonnes) --- */}
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            tableLayout: "fixed",
            color: INK,
          }}
        >
          <colgroup>
            {/* Rendu en tableau : PAS de nœuds texte entre les <col> (les
                espaces JSX dans <colgroup> provoquent une erreur
                d'hydratation React « whitespace text node »). */}
            {/* v4 — largeurs rééquilibrées pour l'ARIAL 12 : colonne NOM
                ET PRÉNOMS élargie (15.6 %, cellule insécable → noms et
                prénoms sur la même ligne), dates calibrées jj/mm/aaaa,
                colonnes numériques réduites. */}
            {/* v6 — colonne « Arrivée au poste » ajoutée dans le groupe
                DATES (demande utilisateur) — largeurs rééquilibrées,
                total toujours 100 %. */}
            {[
              "2.2%", // N°
              "15.2%", // Nom et prénoms (insécable)
              "5%", // Matricule
              "9%", // Date et lieu de naissance
              "2.5%", // IO IA IS IAS
              "2.2%", // Classe
              "2.2%", // Échelon
              "6.4%", // Date entrée F.P
              "5%", // Fonction
              "6.4%", // Entrée DREN
              "6.4%", // Entrée IEP
              "6.8%", // Arrivée au poste
              "2.7%", // Cours
              "2.8%", // Effectif F
              "2.8%", // Effectif G
              "2.8%", // Effectif T
              "2.8%", // Redoublants F
              "2.8%", // Redoublants G
              "2.8%", // Redoublants T
              "5.6%", // Contact
              "5.6%", // Emargement
            ].map((w, i) => (
              <col key={i} style={{ width: w }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th style={th} rowSpan={2}>
                N°
              </th>
              <th style={th} rowSpan={2}>
                Nom et prénoms
              </th>
              <th style={th} rowSpan={2}>
                Matricule
              </th>
              <th style={th} rowSpan={2}>
                Date et lieu de naissance
              </th>
              <th style={th} rowSpan={2}>
                IO IA
                <br />
                IS IAS
              </th>
              <th style={thVertical} rowSpan={2}>
                {/* v5 — libellé écrit VERTICALEMENT (demande utilisateur) */}
                <span style={thVerticalSpan}>Classe</span>
              </th>
              <th style={thVertical} rowSpan={2}>
                <span style={thVerticalSpan}>Échelon</span>
              </th>
              <th style={th} rowSpan={2}>
                Date entrée F.P
              </th>
              <th style={th} rowSpan={2}>
                Fonction
              </th>
              <th style={th} colSpan={3}>
                Dates
              </th>
              <th style={thVertical} rowSpan={2}>
                {/* v5 — libellé écrit VERTICALEMENT (demande utilisateur) */}
                <span style={thVerticalSpan}>Cours</span>
              </th>
              <th style={th} colSpan={3}>
                Effectif
              </th>
              <th style={th} colSpan={3}>
                Redoublants
              </th>
              <th style={th} rowSpan={2}>
                Contact
              </th>
              <th style={th} rowSpan={2}>
                Emargement
              </th>
            </tr>
            <tr>
              <th style={th}>Entrée DREN</th>
              <th style={th}>Entrée IEP</th>
              <th style={th}>Arrivée au poste</th>
              <th style={th}>F</th>
              <th style={th}>G</th>
              <th style={th}>T</th>
              <th style={th}>F</th>
              <th style={th}>G</th>
              <th style={th}>T</th>
            </tr>
          </thead>
          <tbody>
            {/* Une ligne par agent — v7 : ordre des cours CP1→CM2 (tri
                serveur : la position du cours prime, directeur compris) :
                CP1 · CP2 · CE1 · CE2 · CM1 · CM2. Noms des femmes EN
                ROUGE (N.B du modèle). */}
            {staff.map((s, i) => (
              <StaffRow key={s.id} s={s} n={i + 1} />
            ))}
            {/* Ligne supplémentaire vierge (le modèle garde une ligne libre) */}
            <tr>
              <td style={td}>{staff.length + 1}</td>
              <td style={tdLeft}>&nbsp;</td>
              {Array.from({ length: 19 }, (_, k) => (
                <td key={k} style={td}>
                  &nbsp;
                </td>
              ))}
            </tr>
            {/* --- Ligne TOTAL (calculée, fond gris, gras — modèle) --- */}
            <tr>
              <td colSpan={9} style={{ border: "none", padding: 0 }} />
              <td
                colSpan={3}
                style={{
                  ...th,
                  background: CI_GREEN_BG,
                  color: CI_GREEN_TEXT,
                }}
              >
                TOTAL
              </td>
              <td style={{ border: "none", padding: 0 }} />
              <td style={{ ...td, background: CI_GREEN_BG, color: CI_GREEN_TEXT, fontWeight: 700 }}>
                {fmtNum(totalEffF)}
              </td>
              <td style={{ ...td, background: CI_GREEN_BG, color: CI_GREEN_TEXT, fontWeight: 700 }}>
                {fmtNum(totalEffG)}
              </td>
              <td style={{ ...td, background: CI_GREEN_BG, color: CI_GREEN_TEXT, fontWeight: 700 }}>
                {fmtNum(totalEffT)}
              </td>
              <td style={{ ...td, background: CI_GREEN_BG, color: CI_GREEN_TEXT, fontWeight: 700 }}>
                {fmtNum(totalRedF)}
              </td>
              <td style={{ ...td, background: CI_GREEN_BG, color: CI_GREEN_TEXT, fontWeight: 700 }}>
                {fmtNum(totalRedG)}
              </td>
              <td style={{ ...td, background: CI_GREEN_BG, color: CI_GREEN_TEXT, fontWeight: 700 }}>
                {fmtNum(totalRedT)}
              </td>
            </tr>
          </tbody>
        </table>

        {/* --- Signature + N.B (modèle reçu) --- */}
        <div style={{ marginTop: "10px" }}>
          <div
            style={{
              fontSize: "12px",
              fontWeight: 700,
              textDecoration: "underline",
              margin: "0 0 6px 12px",
            }}
          >
            Le Directeur
          </div>
          {/* v6 — NOM du directeur en caractère d'imprimerie (majuscules,
              gras) SOUS « Le Directeur » — même style que les autres
              documents officiels ; masqué si le personnel est vide. */}
          {directeurName ? (
            <div
              style={{
                fontSize: "12px",
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.3px",
                margin: "0 0 6px 12px",
              }}
            >
              {directeurName}
            </div>
          ) : null}
          <div
            style={{
              fontSize: "12px",
              fontWeight: 700,
              margin: "0 0 0 18%",
              lineHeight: 1.45,
            }}
          >
            <div>
              N.B: Ecrire le nom des{" "}
              <span style={{ color: "#e00000" }}>femmes</span> en rouge.
            </div>
            <div>
              Préciser les RPL (Remplaçants) , MAC (Malade Avec Certificat),
            </div>
            <div>MSC (Malade Sans Certificat)</div>
          </div>
          <div
            style={{
              fontSize: "12px",
              fontWeight: 700,
              margin: "8px 0 0 18%",
              letterSpacing: "0.4px",
              color: CI_GREEN_TEXT,
            }}
          >
            (A RETOURNER EN <u>03 EXEMPLAIRES</u>&nbsp;)
          </div>
        </div>
        </div>
        {/* (Ruban tricolore du bas RETIRÉ : aucune bordure drapeau sur les
            feuilles imprimables.) */}
      </div>
    </div>
  );
}

/** Une ligne agent du tableau (20 cellules).
 *
 *  v5 — les lignes dont la FONCTION déclarée dans le dossier contient
 *  « Directeur / Directrice / Adjoint » (le directeur et l'adjoint au
 *  directeur) passent en ARIAL 10 (demande utilisateur) ; la colonne
 *  CONTACT est en ARIAL 10 pour toutes les lignes et le préfixe « +225 »
 *  est retiré à l'affichage. */
function StaffRow({ s, n }: { s: PersonnelStaffRow; n: number }) {
  const isWoman = s.sexe === "F";
  const isOfficial = /direct|adjoint/i.test(s.fonction ?? "");
  // Cellules de la ligne : ARIAL 10 pour le directeur et l'adjoint(e),
  // ARIAL 12 pour les autres agents.
  const tdc: React.CSSProperties = isOfficial
    ? { ...td, fontSize: "10px" }
    : td;
  const tdl: React.CSSProperties = isOfficial
    ? { ...tdLeft, fontSize: "10px" }
    : tdLeft;
  const birth = formatDossierDate(s.date_naissance);
  const birthCell = birth
    ? s.lieu_naissance
      ? `${birth} à ${s.lieu_naissance}`
      : birth
    : (s.lieu_naissance ?? "");
  return (
    <tr>
      <td style={tdc}>{n}</td>
      <td
        style={{
          ...tdNom,
          fontWeight: 600,
          // Task 37 — noms et prénoms EN CARACTÈRE D'IMPRIMERIE
          // (majuscules) ; v4 — police 12 + UNE SEULE LIGNE (nowrap) ;
          // v5 — ARIAL 10 sur les lignes directeur / adjoint(e).
          fontSize: isOfficial ? "10px" : "12px",
          textTransform: "uppercase",
          color: isWoman ? "#e00000" : INK, // « écrire le nom des femmes en rouge »
        }}
      >
        {s.full_name}
      </td>
      <td style={tdc}>{s.matricule ?? ""}</td>
      <td style={tdl}>{birthCell}</td>
      <td style={tdc}>{s.categorie ?? ""}</td>
      <td style={tdc}>
        {/* CLASSE : notation administrative courte — 1 · 2 · E
            (Exceptionnelle) · P (Principale) — mêmes items que la
            liste déroulante du dossier personnel. */}
        {s.classe_grade != null
          ? (CLASSE_GRADE_LABELS[s.classe_grade] ?? String(s.classe_grade))
          : ""}
      </td>
      <td style={tdc}>{s.echelon ?? ""}</td>
      <td style={tdc}>{formatDossierDate(s.date_entree_fp)}</td>
      {/* FONCTION (v8) : « Directeur » / « Adjoint(e) » — première
          lettre majuscule, reste en minuscules (demande utilisateur). */}
      <td style={tdc}>{fmtFonction(s.fonction)}</td>
      <td style={tdc}>{formatDossierDate(s.date_entree_dren)}</td>
      <td style={tdc}>{formatDossierDate(s.date_entree_iep)}</td>
      <td style={tdc}>{formatDossierDate(s.date_arrivee_poste)}</td>
      {/* COURS : le champ explicite du dossier personnel (bande déroulante
          CP1..CM2) prime sur la classe affectée (module Classes). */}
      <td style={tdc}>{s.cours ?? s.class_name ?? ""}</td>
      <td style={tdc}>{fmtNum(s.effectif_f)}</td>
      <td style={tdc}>{fmtNum(s.effectif_g)}</td>
      <td style={tdc}>{fmtNum(s.effectif_t)}</td>
      <td style={tdc}>{fmtNum(s.redoublant_f)}</td>
      <td style={tdc}>{fmtNum(s.redoublant_g)}</td>
      <td style={tdc}>{fmtNum(s.redoublant_t)}</td>
      {/* CONTACT : ARIAL 10 + « +225 » retiré (demande utilisateur). */}
      <td style={tdContact}>{fmtContact(s.phone)}</td>
      <td style={tdc}>&nbsp;</td>
    </tr>
  );
}

// ============================================================ 3 MODÈLES ===
// v6 — Word (.doc) + Excel (.xlsx) en plus de l'impression PDF navigateur
// (lib partagée doc-export.tsx) : mêmes en-têtes d'origine, même tableau
// (21 colonnes, femmes en rouge, TOTAL calculé) et même signature
// « Le Directeur » + NOM que le document PDF ci-dessus.

/** Données transmises aux modèles Word / Excel : personnel complet, école,
 *  IEP (en-tête institutionnel), directeur signataire et année scolaire. */
interface ExportData {
  staff: PersonnelStaffRow[];
  schoolName: string;
  anneeScolaire: string; // « 2025 2026 » (rentrée en cours)
  iepRegion: string;
  iepName: string;
  iepBp: string;
  iepPhone: string;
  iepEmail: string;
  directeur: string;
}

/** « 12/05/1980 à DABOU » — même logique que la cellule PDF (date seule,
 *  lieu seul, ou les deux). */
function birthCellText(s: PersonnelStaffRow): string {
  const birth = formatDossierDate(s.date_naissance);
  return birth
    ? s.lieu_naissance
      ? `${birth} à ${s.lieu_naissance}`
      : birth
    : (s.lieu_naissance ?? "");
}

/** CLASSE : notation administrative courte (1 · 2 · E · P) — mêmes items
 *  que la liste déroulante du dossier personnel (colonne du PDF). */
function classeCellText(s: PersonnelStaffRow): string {
  return s.classe_grade != null
    ? (CLASSE_GRADE_LABELS[s.classe_grade] ?? String(s.classe_grade))
    : "";
}

// Largeurs des 21 colonnes (mêmes proportions que le colgroup du PDF :
// NOM ET PRÉNOMS élargie, dates calibrées jj/mm/aaaa, colonne
// « Arrivée au poste » dans le groupe DATES).
const EXPORT_COL_WIDTHS = [
  "2.2%", // N°
  "15.2%", // Nom et prénoms
  "5%", // Matricule
  "9%", // Date et lieu de naissance
  "2.5%", // IO IA IS IAS
  "2.2%", // Classe
  "2.2%", // Échelon
  "6.4%", // Date entrée F.P
  "5%", // Fonction
  "6.4%", // Entrée DREN
  "6.4%", // Entrée IEP
  "6.8%", // Arrivée au poste
  "2.7%", // Cours
  "2.8%", // Effectif F
  "2.8%", // Effectif G
  "2.8%", // Effectif T
  "2.8%", // Redoublants F
  "2.8%", // Redoublants G
  "2.8%", // Redoublants T
  "5.6%", // Contact
  "5.6%", // Emargement
];

// === MODÈLE WORD (.doc) — HTML MSO A4 PAYSAGE fidèle au document PDF ===
// En-tête institutionnel (copie HTML du composant OfficialDocHeader,
// variante « plan » : République / Union-Discipline-Travail / armoiries),
// boîte du titre, tableau 21 colonnes (entêtes CLASSE / ÉCHELON / COURS
// remis à l'HORIZONTALE, texte court — Word ne rend pas l'écriture
// verticale ; thead répété à chaque page via display:table-header-group),
// ligne vierge du modèle, TOTAL calculé, signature « Le Directeur » + NOM,
// N.B (femmes en rouge) et mention « (A RETOURNER EN 03 EXEMPLAIRES) ».
async function buildWordHtml(o: ExportData): Promise<string> {
  const armoiries = await armoiriesBase64();
  const esc = escHtml;

  // Cellules du tableau (styles EN LIGNE — le convertisseur Word ignore
  // une partie des classes CSS) ; bordures vert drapeau comme le PDF.
  const th =
    "border:1px solid #009E60; padding:2px 3px; font-size:12px; font-weight:bold; text-align:center; vertical-align:middle; color:#ffffff; background:#009E60;";
  const td =
    "border:1px solid #009E60; padding:1px 3px; font-size:12px; line-height:1.25; text-align:center; vertical-align:middle; height:18px;";
  const tdL = td.replace("text-align:center", "text-align:left");

  // Entêtes sur 2 rangées (fusions identiques au PDF).
  const headTop =
    `<th style="${th}" rowspan=2>N&deg;</th>` +
    `<th style="${th}" rowspan=2>Nom et pr&eacute;noms</th>` +
    `<th style="${th}" rowspan=2>Matricule</th>` +
    `<th style="${th}" rowspan=2>Date et lieu de naissance</th>` +
    `<th style="${th}" rowspan=2>IO IA<br>IS IAS</th>` +
    // CLASSE / ÉCHELON écrits VERTICALEMENT dans le PDF passent à
    // l'horizontale en Word (libellés courts).
    `<th style="${th}" rowspan=2>CLASSE</th>` +
    `<th style="${th}" rowspan=2>&Eacute;CHELON</th>` +
    `<th style="${th}" rowspan=2>Date entr&eacute;e F.P</th>` +
    `<th style="${th}" rowspan=2>Fonction</th>` +
    `<th style="${th}" colspan=3>Dates</th>` +
    `<th style="${th}" rowspan=2>COURS</th>` +
    `<th style="${th}" colspan=3>Effectif</th>` +
    `<th style="${th}" colspan=3>Redoublants</th>` +
    `<th style="${th}" rowspan=2>Contact</th>` +
    `<th style="${th}" rowspan=2>Emargement</th>`;
  const headSub =
    `<tr>` +
    `<th style="${th}">Entr&eacute;e DREN</th><th style="${th}">Entr&eacute;e IEP</th><th style="${th}">Arriv&eacute;e au poste</th>` +
    `<th style="${th}">F</th><th style="${th}">G</th><th style="${th}">T</th>` +
    `<th style="${th}">F</th><th style="${th}">G</th><th style="${th}">T</th>` +
    `</tr>`;

  // Une ligne agent (21 cellules) — NOM en caractère d'imprimerie,
  // femmes EN ROUGE (N.B du modèle), lignes DIRECTEUR / ADJOINT(E) en
  // 10px et CONTACT en 10px sans « +225 » (mêmes règles que le PDF).
  const body = o.staff
    .map((s, i) => {
      const official = /direct|adjoint/i.test(s.fonction ?? "");
      const sz = official ? " font-size:10px;" : "";
      const nomColor = s.sexe === "F" ? "#e00000" : "#000000";
      return (
        `<tr>` +
        `<td style="${td}${sz}">${i + 1}</td>` +
        `<td style="${tdL}${sz}; font-weight:600; color:${nomColor};">${esc(s.full_name.toUpperCase())}</td>` +
        `<td style="${td}${sz}">${esc(s.matricule ?? "")}</td>` +
        `<td style="${tdL}${sz}">${esc(birthCellText(s))}</td>` +
        `<td style="${td}${sz}">${esc(s.categorie ?? "")}</td>` +
        `<td style="${td}${sz}">${esc(classeCellText(s))}</td>` +
        `<td style="${td}${sz}">${esc(s.echelon != null ? String(s.echelon) : "")}</td>` +
        `<td style="${td}${sz}">${esc(formatDossierDate(s.date_entree_fp))}</td>` +
        `<td style="${td}${sz}">${esc(fmtFonction(s.fonction))}</td>` +
        `<td style="${td}${sz}">${esc(formatDossierDate(s.date_entree_dren))}</td>` +
        `<td style="${td}${sz}">${esc(formatDossierDate(s.date_entree_iep))}</td>` +
        `<td style="${td}${sz}">${esc(formatDossierDate(s.date_arrivee_poste))}</td>` +
        `<td style="${td}${sz}">${esc(s.cours ?? s.class_name ?? "")}</td>` +
        `<td style="${td}${sz}">${esc(fmtNum(s.effectif_f))}</td>` +
        `<td style="${td}${sz}">${esc(fmtNum(s.effectif_g))}</td>` +
        `<td style="${td}${sz}">${esc(fmtNum(s.effectif_t))}</td>` +
        `<td style="${td}${sz}">${esc(fmtNum(s.redoublant_f))}</td>` +
        `<td style="${td}${sz}">${esc(fmtNum(s.redoublant_g))}</td>` +
        `<td style="${td}${sz}">${esc(fmtNum(s.redoublant_t))}</td>` +
        `<td style="${tdL}; font-size:10px; white-space:nowrap;">${esc(fmtContact(s.phone))}</td>` +
        `<td style="${td}${sz}">&nbsp;</td>` +
        `</tr>`
      );
    })
    .join("");

  // Ligne supplémentaire vierge (le modèle garde une ligne libre).
  const emptyRow =
    `<tr>` +
    `<td style="${td}">${o.staff.length + 1}</td>` +
    `<td style="${tdL}">&nbsp;</td>` +
    Array.from({ length: 19 }, () => `<td style="${td}">&nbsp;</td>`).join("") +
    `</tr>`;

  // Ligne TOTAL calculée — même structure que le PDF : libellé sous les
  // colonnes DATES, effectifs puis redoublants F/G/T, fond pastel vert.
  const totalCell = (v: number | null) =>
    `<td style="${td}; background:#E4F4ED; color:#00734A; font-weight:bold;">${esc(fmtNum(v))}</td>`;
  const totalRow =
    `<tr>` +
    `<td colspan=9 style="border:none;"></td>` +
    `<td colspan=2 style="${th}; background:#E4F4ED; color:#00734A;">TOTAL</td>` +
    `<td style="border:none;"></td>` +
    totalCell(sumCol(o.staff.map((s) => s.effectif_f))) +
    totalCell(sumCol(o.staff.map((s) => s.effectif_g))) +
    totalCell(sumCol(o.staff.map((s) => s.effectif_t))) +
    totalCell(sumCol(o.staff.map((s) => s.redoublant_f))) +
    totalCell(sumCol(o.staff.map((s) => s.redoublant_g))) +
    totalCell(sumCol(o.staff.map((s) => s.redoublant_t))) +
    `</tr>`;

  // En-tête institutionnel — copie HTML de OfficialDocHeader (variante
  // « plan » : devise au-dessus des armoiries ; taille « sm »).
  const region = (o.iepRegion || o.iepName || "…………").toUpperCase();
  const iepName = (o.iepName || "…………").toUpperCase();
  const annee = o.anneeScolaire.split(" ");
  const header = `
<table class=hdr><tr>
<td style="width:64%">
<p>MINISTERE DE L'EDUCATION NATIONALE ET</p>
<p style="padding-left:6px;">DE L'ALPHABETISATION</p>
<p>DIRECTION REGIONALE DE ${esc(region)}</p>
<p style="letter-spacing:2px; margin-left:56px;">........................</p>
<p>INSPECTION DE L'ENSEIGNEMENT</p>
<p>PRESCOLAIRE ET PRIMAIRE DE ${esc(iepName)}</p>
<p>BP ${esc(o.iepBp || "……")}&nbsp;&nbsp;&nbsp;T&eacute;l ${esc(o.iepPhone || "…………")}</p>
<p>Courriel : <span style="color:#0563C1; text-decoration:underline;">${esc(o.iepEmail || "…………")}</span></p>
</td>
<td style="width:36%; text-align:center;">
<p style="font-size:12px;">REPUBLIQUE DE C&Ocirc;TE D'IVOIRE</p>
<p style="padding:1px 0;">Union-Discipline-Travail</p>
${armoiries ? `<img src="${armoiries}" width="50" height="50" alt="">` : ""}
</td>
</tr></table>`;

  return buildWordShell({
    title: `Etat nominatif du personnel ${o.anneeScolaire} — ${o.schoolName}`,
    orientation: "landscape", // A4 PAYSAGE (modèle reçu)
    marginMm: 8,
    styles: `
table.hdr { border-collapse:collapse; width:100%; }
table.hdr td { border:none; vertical-align:top; font-size:11px; line-height:1.32; }
.titre { display:inline-block; border:2.2px solid #009E60; background:#FDEBDA; border-radius:14px; padding:6px 30px 7px; font-size:19px; font-weight:bold; letter-spacing:1.5px; line-height:1.25; text-align:center; }
table.doc { border-collapse:collapse; width:100%; table-layout:fixed; }
table.doc td, table.doc th { overflow-wrap:break-word; }
thead.rep { display:table-header-group; }
`,
    bodyHtml: `
${header}
<p style="text-align:center; margin:2px 0 6px;"><span class=titre>ETAT NOMINATIF DU<br>PERSONNEL</span></p>
<table class=hdr><tr>
<td style="font-size:12px;"><span style="color:#00734A;">Ecole</span>: ${esc(o.schoolName)}</td>
<td style="font-size:12px; text-align:right; white-space:nowrap;"><span style="color:#00734A;">Ann&eacute;e scolaire</span>: ${esc(annee[0] ?? "")}&nbsp;&nbsp;${esc(annee[1] ?? "")}</td>
</tr></table>
<table class=doc>
<colgroup>${EXPORT_COL_WIDTHS.map((w) => `<col style="width:${w}">`).join("")}</colgroup>
<thead class=rep><tr>${headTop}</tr>${headSub}</thead>
<tbody>
${body}
${emptyRow}
${totalRow}
</tbody>
</table>
<div style="margin-top:10px;">
<p style="font-size:12px; font-weight:bold; text-decoration:underline; margin-left:12px;">Le Directeur</p>
${o.directeur.trim() ? `<p style="font-size:12px; font-weight:bold; text-transform:uppercase; letter-spacing:0.3px; margin-left:12px;">${esc(o.directeur.trim().toUpperCase())}</p>` : ""}
<div style="font-size:12px; font-weight:bold; margin-left:18%; line-height:1.45;">
<p>N.B: Ecrire le nom des <span style="color:#e00000;">femmes</span> en rouge.</p>
<p>Pr&eacute;ciser les RPL (Rempla&ccedil;ants) , MAC (Malade Avec Certificat),</p>
<p>MSC (Malade Sans Certificat)</p>
</div>
<p style="font-size:12px; font-weight:bold; margin:8px 0 0 18%; letter-spacing:0.4px; color:#00734A;">(A RETOURNER EN <u>03 EXEMPLAIRES</u>&nbsp;)</p>
</div>
`,
  });
}

// === MODÈLE EXCEL (.xlsx) — classeur mis en page (exceljs, import
// dynamique) : en-tête institutionnel fusionné, tableau 21 colonnes bordé
// vert (femmes en rouge), TOTAL en gras, signature « Le Directeur » + NOM ;
// impression PAYSAGE ajustée à 1 page de large, entêtes répétés.
async function exportExcelAsync(o: ExportData): Promise<void> {
  const { Workbook } = await import("exceljs");
  const wb = new Workbook();
  wb.creator = "SYGREN";

  // Rangées d'entêtes du tableau (répétées à l'impression sur chaque page).
  const HEAD_START = 8;
  const HEAD_END = 9;

  const ws = wb.addWorksheet("Personnel", {
    views: [{ state: "frozen", ySplit: HEAD_END, showGridLines: false }],
    pageSetup: {
      paperSize: 9, // A4
      orientation: "landscape", // PAYSAGE (modèle reçu)
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.3, right: 0.3, top: 0.45, bottom: 0.45, header: 0.2, footer: 0.2 },
      printTitlesRow: `${HEAD_START}:${HEAD_END}`,
    },
  });
  // Largeurs raisonnables des 21 colonnes.
  ws.columns = [
    4.5, // N°
    28, // Nom et prénoms
    10, // Matricule
    20, // Date et lieu de naissance
    6, // IO IA IS IAS
    6.5, // Classe
    7, // Échelon
    10.5, // Date entrée F.P
    11, // Fonction
    10.5, // Entrée DREN
    10.5, // Entrée IEP
    10.5, // Arrivée au poste
    7, // Cours
    5.5, 5.5, 5.5, // Effectif F G T
    5.5, 5.5, 5.5, // Redoublants F G T
    13, // Contact
    12, // Emargement
  ].map((width) => ({ width }));

  const font = (size: number, bold = false, argb?: string) => ({
    name: "Arial",
    size,
    bold,
    ...(argb ? { color: { argb } } : {}),
  });
  const GREEN = { argb: "FF009E60" };
  const GREEN_TXT = { argb: "FF00734A" };
  const GREEN_BG = { argb: "FFE4F4ED" };
  const RED = { argb: "FFE00000" };
  const border = { style: "thin" as const, color: GREEN };
  const BOX = { top: border, left: border, bottom: border, right: border };

  // Ligne fusionnée sur les 21 colonnes (en-tête institutionnel).
  const merged = (
    row: number,
    text: string,
    size: number,
    bold = false,
    italic = false,
  ) => {
    ws.mergeCells(row, 1, row, 21);
    const c = ws.getCell(row, 1);
    c.value = text;
    c.font = { name: "Arial", size, bold, italic };
    c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  };

  // --- En-tête institutionnel (fidèle au modèle PDF) ---
  merged(1, "Ministère de l'Education Nationale et de l'Alphabétisation", 12, true);
  merged(
    2,
    `Direction Régionale de ${(o.iepRegion || o.iepName || "…………").toUpperCase()} — Inspection de l'Enseignement Préscolaire et Primaire de ${(o.iepName || "…………").toUpperCase()}`,
    11,
    true,
    true,
  );
  merged(
    3,
    `BP : ${o.iepBp || "……"} / Tél : ${o.iepPhone || "…………"} — Courriel : ${o.iepEmail || "…………"}`,
    11,
  );
  merged(4, "République de Côte d'Ivoire — Union-Discipline-Travail", 11, true);
  merged(5, "ETAT NOMINATIF DU PERSONNEL", 14, true);
  for (let col = 1; col <= 21; col++) ws.getCell(5, col).border = BOX;

  // Ligne Ecole (gauche) / Année scolaire (droite).
  ws.mergeCells(6, 1, 6, 9);
  const ecole = ws.getCell(6, 1);
  ecole.value = `Ecole : ${o.schoolName}`;
  ecole.font = font(11, true, GREEN_TXT.argb);
  ecole.alignment = { horizontal: "left", vertical: "middle" };
  ws.mergeCells(6, 10, 6, 21);
  const annee = ws.getCell(6, 10);
  annee.value = `Année scolaire : ${(o.anneeScolaire || "").split(" ").join("  ")}`;
  annee.font = font(11, true, GREEN_TXT.argb);
  annee.alignment = { horizontal: "right", vertical: "middle" };
  ws.getRow(7).height = 4;

  // --- Entêtes du tableau (2 rangées, fusions comme le PDF) ---
  // Entêtes fusionnés verticalement (N° → Fonction, Cours, Contact,
  // Emargement) ; CLASSE / ÉCHELON / COURS remis à l'horizontale.
  const headTopLabels: Array<[number, string]> = [
    [1, "N°"],
    [2, "Nom et prénoms"],
    [3, "Matricule"],
    [4, "Date et lieu de naissance"],
    [5, "IO IA IS IAS"],
    [6, "CLASSE"],
    [7, "ÉCHELON"],
    [8, "Date entrée F.P"],
    [9, "Fonction"],
    [12, "COURS"],
    [20, "Contact"],
    [21, "Emargement"],
  ];
  for (const [col, label] of headTopLabels) {
    ws.mergeCells(HEAD_START, col, HEAD_END, col);
    ws.getCell(HEAD_START, col).value = label;
  }
  ws.mergeCells(HEAD_START, 10, HEAD_START, 12);
  ws.getCell(HEAD_START, 10).value = "Dates";
  ws.mergeCells(HEAD_START, 14, HEAD_START, 16);
  ws.getCell(HEAD_START, 14).value = "Effectif";
  ws.mergeCells(HEAD_START, 17, HEAD_START, 19);
  ws.getCell(HEAD_START, 17).value = "Redoublants";
  ["Entrée DREN", "Entrée IEP", "Arrivée au poste"].forEach((label, k) => {
    ws.getCell(HEAD_END, 10 + k).value = label;
  });
  ["F", "G", "T", "F", "G", "T"].forEach((label, k) => {
    ws.getCell(HEAD_END, 14 + k).value = label;
  });
  for (let r = HEAD_START; r <= HEAD_END; r++) {
    const row = ws.getRow(r);
    row.height = r === HEAD_START ? 26 : 16;
    row.eachCell({ includeEmpty: true }, (c) => {
      c.font = font(9, true, "FFFFFFFF");
      c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      c.border = BOX;
      c.fill = { type: "pattern", pattern: "solid", fgColor: GREEN };
    });
  }

  // --- Lignes agents (une ligne par agent, femmes en rouge) ---
  o.staff.forEach((s, i) => {
    const r = HEAD_END + 1 + i;
    const row = ws.getRow(r);
    row.values = [
      i + 1,
      s.full_name.toUpperCase(), // caractère d'imprimerie (comme le PDF)
      s.matricule ?? "",
      birthCellText(s),
      s.categorie ?? "",
      classeCellText(s),
      s.echelon != null ? String(s.echelon) : "",
      formatDossierDate(s.date_entree_fp),
      fmtFonction(s.fonction), // v8 — « Directeur » / « Adjoint(e) »
      formatDossierDate(s.date_entree_dren),
      formatDossierDate(s.date_entree_iep),
      formatDossierDate(s.date_arrivee_poste),
      s.cours ?? s.class_name ?? "",
      fmtNum(s.effectif_f),
      fmtNum(s.effectif_g),
      fmtNum(s.effectif_t),
      fmtNum(s.redoublant_f),
      fmtNum(s.redoublant_g),
      fmtNum(s.redoublant_t),
      fmtContact(s.phone),
      "",
    ];
    row.height = 16;
    row.eachCell({ includeEmpty: true }, (c, col) => {
      c.border = BOX;
      // Femmes EN ROUGE sur la colonne NOM (N.B du modèle).
      c.font = font(10, col === 2, s.sexe === "F" && col === 2 ? RED.argb : undefined);
      c.alignment = {
        horizontal: col === 2 || col === 4 || col === 20 ? "left" : "center",
        vertical: "middle",
        wrapText: true,
      };
    });
  });

  // --- Ligne vierge du modèle (une ligne libre numérotée) ---
  const rEmpty = HEAD_END + 1 + o.staff.length;
  const emptyRow = ws.getRow(rEmpty);
  emptyRow.values = [o.staff.length + 1, ...Array<string>(20).fill("")];
  emptyRow.height = 16;
  emptyRow.eachCell({ includeEmpty: true }, (c) => {
    c.border = BOX;
    c.font = font(10);
    c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  });

  // --- TOTAL calculé (fond pastel vert, gras — comme le PDF) ---
  const rTotal = rEmpty + 1;
  const totals: Array<number | null> = [
    sumCol(o.staff.map((s) => s.effectif_f)),
    sumCol(o.staff.map((s) => s.effectif_g)),
    sumCol(o.staff.map((s) => s.effectif_t)),
    sumCol(o.staff.map((s) => s.redoublant_f)),
    sumCol(o.staff.map((s) => s.redoublant_g)),
    sumCol(o.staff.map((s) => s.redoublant_t)),
  ];
  // Libellé TOTAL sous les colonnes DATES (10-12), valeurs F→T (14-19) ;
  // les cellules N°→Fonction et Cours restent vides SANS bordure.
  ws.mergeCells(rTotal, 1, rTotal, 9);
  ws.mergeCells(rTotal, 10, rTotal, 12);
  const totalLabel = ws.getCell(rTotal, 10);
  totalLabel.value = "TOTAL";
  totals.forEach((v, k) => {
    ws.getCell(rTotal, 14 + k).value = v == null ? "" : fmtNum(v);
  });
  for (let col = 10; col <= 19; col++) {
    const c = ws.getCell(rTotal, col);
    c.border = BOX;
    c.font = font(10, true, GREEN_TXT.argb);
    c.alignment = { horizontal: "center", vertical: "middle" };
    c.fill = { type: "pattern", pattern: "solid", fgColor: GREEN_BG };
  }

  // --- Signature « Le Directeur » + NOM (caractère d'imprimerie) ---
  const rSig = rTotal + 2;
  const sigLabel = ws.getCell(rSig, 3);
  sigLabel.value = "Le Directeur";
  sigLabel.font = { ...font(11, true), underline: true };
  sigLabel.alignment = { horizontal: "left", vertical: "middle" };
  if (o.directeur.trim()) {
    const sigName = ws.getCell(rSig + 2, 3);
    sigName.value = o.directeur.trim().toUpperCase();
    sigName.font = font(10, true);
    sigName.alignment = { horizontal: "left", vertical: "middle" };
  }

  // --- Armoiries (meilleur effort — omises si indisponibles) ---
  try {
    const res = await fetch("/ci-coat-of-arms.png");
    if (res.ok) {
      const u8 = new Uint8Array(await res.arrayBuffer());
      const imgId = wb.addImage({
        buffer: u8 as unknown as Parameters<typeof wb.addImage>[0]["buffer"],
        extension: "png",
      });
      ws.addImage(imgId, { tl: { col: 20, row: 0.2 }, ext: { width: 46, height: 46 } });
    }
  } catch {
    // armoiries omises — l'en-tête reste lisible
  }

  const buf = await wb.xlsx.writeBuffer();
  saveBlob(
    new Blob([buf], { type: XLSX_MIME }),
    `etat-nominatif-personnel-${slugFile(o.schoolName)}-${slugFile(o.anneeScolaire)}.xlsx`,
  );
}
