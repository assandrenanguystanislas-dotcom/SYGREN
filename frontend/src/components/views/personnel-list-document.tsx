"use client";

// === Documents « LISTE NOMINATIVE DES DIRECTEURS D'ECOLE » et
// « LISTE NOMINATIVE DES MAITRES DE CM2 » (Task 74 + affinages
// Task 75/76) ===
//
// Demande : « dans le module fichier du personnel, créer 2 fichiers —
// 1 fichier nommé liste nominatif des directeurs d'école et 1 autre
// nommé liste nominatif des maitres de cm2. Pour le faire, se servir
// de l'entête de l'état nominatif. » — colonnes (Task 76) :
//   - DIRECTEURS : N° ; NOM ET PRENOMS ; MATRICULE ; DATE DE 1ERE
//     PRISE DE SERVICE ; ECOLE ; CODE ECOLE ; EFFECTIF ; NIVEAU ;
//     EMARGEMENT (9 colonnes) ;
//   - MAITRES DE CM2 : idem SANS la colonne NIVEAU (8 colonnes —
//     « la colonne NIVEAU doit être annulée pour les maîtres tenant
//     le CM2 »).
//
// Affinages Task 75 :
//   - SEULEMENT LES ENSEIGNANTS ISSUS DES EPP (filtre côté serveur :
//     écoles dont le nom commence par « EPP ») ;
//   - ORDRE ALPHABÉTIQUE des NOM ET PRENOMS (ordre serveur).
//
// Affinages Task 76 :
//   - colonne NIVEAU : ANNULÉE pour les maîtres de CM2 ; pour les
//     directeurs elle porte le NOMBRE DE CLASSES DE L'ÉCOLE (« en ce
//     qui concerne les directeurs, il s'agit du nombre de classe
//     dans l'école » — calcul serveur) ;
//   - « Fait à Dabou, le » : LA DATE DU JOUR est insérée (JJ/MM/AAAA)
//     à la place des pointillés ;
//   - signature : 15 MM entre « L'Inspecteur » et son nom (espace
//     de signature, Task 75).
//
// Entête REPRISE DE L'ÉTAT NOMINATIF (personnel-document.tsx) :
//   - en-tête institutionnel OfficialDocHeader (variante « plan »,
//     taille compacte « xs » — bloc ministériel + République +
//     Union-Discipline-Travail + armoiries) ;
//   - boîte du titre à bord arrondi VERT DRAPEAU sur fond pastel
//     orange (même gabarit que « ETAT NOMINATIF DU PERSONNEL ») ;
//   - ligne gauche / droite (ici IEP : … à gauche — les listes
//     couvrent TOUTES les écoles de la circonscription —, Année
//     scolaire + Date du jour à droite) ;
//   - armoiries en filigrane, tableau bordé vert, entêtes sur fond
//     vert drapeau (texte blanc), noms des femmes EN ROUGE (N.B du
//     modèle), ligne TOTAL calculée, police ARIAL.
//
// Données : /api/reports/personnel-list?kind=directeurs|cm2 — RBAC de
// périmètre dans le handler (inspector = son IEP, admin = tout) ;
// DATE DE 1ERE PRISE DE SERVICE = entrée à la Fonction Publique du
// dossier ; EFFECTIF d'après l'ÉTAT NOMINATIF DU PERSONNEL (école
// entière pour les directeurs, cours tenu pour les maîtres de CM2).
//
// Trois modèles (convention des documents officiels) : impression PDF
// navigateur (route dédiée /personnel-list-doc), Word (.doc) et Excel
// (.xlsx) — ces deux derniers réservés au Super Admin (Task 71,
// doc-export.tsx). Signature « L'Inspecteur » (les listes sont établies
// par la circonscription) avec le nom du titulaire de l'IEP.

import { useQuery } from "@tanstack/react-query";
import { Loader2, X } from "lucide-react";
import { useState, type CSSProperties } from "react";

import { reportsApi } from "@/lib/api";
import {
  DocExportButtons,
  canExportFiles,
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
import { formatDossierDate, type PersonnelListKind, type PersonnelListRow } from "@/lib/types";

import { INK, OfficialDocHeader } from "./official-doc";
import {
  CIArmoiriesWatermark,
  CI_GREEN,
  CI_GREEN_BG,
  CI_GREEN_TEXT,
  CI_ORANGE_BG,
  PRINT_COLOR_STYLE,
} from "@/components/ci-decor";

// POLICE ARIAL (même choix que l'état nominatif — Helvetica/Liberation
// Sans en secours, métriques identiques sous Linux).
const DOC_FONT = '"Arial", "Helvetica", "Liberation Sans", sans-serif';

/** Titre du document selon le kind (libellés EXACTS de la demande). */
export function personnelListTitle(kind: PersonnelListKind): string {
  return kind === "directeurs"
    ? "LISTE NOMINATIVE DES DIRECTEURS D'ECOLE"
    : "LISTE NOMINATIVE DES MAITRES DE CM2";
}

/** Effectif au format du document reçu : 07, 11, 147 — case vide si
 *  non renseigné (les « # » du modèle). */
function fmtNum(n: number | null | undefined): string {
  if (n == null) return "";
  return n < 10 ? `0${n}` : `${n}`;
}

/** DATE DU JOUR : JJ/MM/AAAA (même convention que l'état nominatif). */
function todayFr(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

// Bordures + entêtes du tableau IDENTIQUES à l'état nominatif : vert
// drapeau, texte blanc, sortent à l'impression (print-color-adjust).
const th: CSSProperties = {
  border: `1px solid ${CI_GREEN}`,
  padding: "1.5px 2px",
  fontSize: "11px",
  lineHeight: 1.2,
  fontWeight: 700,
  textAlign: "center",
  verticalAlign: "middle",
  color: "#ffffff",
  background: CI_GREEN,
  ...PRINT_COLOR_STYLE,
};

const td: CSSProperties = {
  border: `1px solid ${CI_GREEN}`,
  padding: "1px 3px",
  fontSize: "12px",
  lineHeight: 1.25,
  textAlign: "center",
  verticalAlign: "middle",
  color: INK,
  // Même hauteur de lignes que l'état nominatif (10 mm).
  height: "10mm",
};

const tdLeft: React.CSSProperties = { ...td, textAlign: "left" };

/** Cellule NOM ET PRENOMS : caractère d'imprimerie (majuscules), noms
 *  des femmes EN ROUGE (N.B du modèle), débordement sur la ligne. */
const tdNom: React.CSSProperties = {
  ...tdLeft,
  fontWeight: 600,
  textTransform: "uppercase",
  overflowWrap: "break-word",
};

// Largeurs des colonnes du modèle (total 100 %) — 9 colonnes pour les
// DIRECTEURS (avec NIVEAU), 8 colonnes pour les MAITRES DE CM2
// (colonne NIVEAU ANNULÉE — Task 76).
const COL_WIDTHS_9 = [
  "4%", // N°
  "20%", // NOM ET PRENOMS
  "9%", // MATRICULE
  "11%", // DATE DE 1ERE PRISE DE SERVICE
  "23%", // ECOLE
  "8%", // CODE ECOLE
  "7%", // EFFECTIF
  "6%", // NIVEAU (directeurs — nombre de classes, Task 76)
  "12%", // EMARGEMENT
];

const COL_WIDTHS_8 = [
  "4%", // N°
  "21%", // NOM ET PRENOMS
  "10%", // MATRICULE
  "12%", // DATE DE 1ERE PRISE DE SERVICE
  "25%", // ECOLE
  "8%", // CODE ECOLE
  "8%", // EFFECTIF
  "12%", // EMARGEMENT
];

// Largeurs Excel (même ordre).
const XLSX_COL_WIDTHS_9 = [4.5, 28, 11, 12.5, 30, 10, 8.5, 7, 12];
const XLSX_COL_WIDTHS_8 = [4.5, 30, 12, 13, 32, 10, 9, 12.5];

/** Mention « Fait à … » (Task 75) : la ville est dérivée de l'IEP —
 *  région en priorité, sinon le nom de l'IEP sans le préfixe « IEP »
 *  ni le numéro final (IEP DABOU 1 → « Dabou »), 1re lettre capitale.
 *  Task 76 : LA DATE DU JOUR remplace les pointillés (JJ/MM/AAAA —
 *  « Fait à Dabou, le 05/10/2026 »). */
function faitALigne(region?: string | null, name?: string | null): string {
  let raw = (region ?? "").trim();
  if (!raw) raw = (name ?? "").trim();
  raw = raw
    .replace(/^IEP\s+/i, "")
    .replace(/[\s\d.\-]+$/, "")
    .trim();
  const ville = raw
    ? raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase()
    : "…………";
  return `Fait à ${ville}, le ${todayFr()}`;
}

export function PersonnelListDocument({
  kind,
  onClose,
}: {
  kind: PersonnelListKind;
  onClose: () => void;
}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["personnel-list", kind],
    queryFn: () => reportsApi.personnelList(kind),
  });

  // Verrou d'impression (même politique que l'état nominatif :
  // Admin IEP + Super Admin) ; Word / Excel réservés au Super Admin
  // (Task 71).
  const printRole = usePrintRole();
  const canPrint = canPrintDocument(printRole, false);
  const canExport = canExportFiles(printRole);

  // Modèle en cours de génération (spinner sur Word ou Excel).
  const [exporting, setExporting] = useState<"doc" | "xlsx" | null>(null);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-2">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">
            Chargement de la liste nominative…
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
            Impossible de charger la liste nominative
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

  const rows = data.rows;
  const titre = personnelListTitle(kind);
  const [t1, t2] = splitTitre(titre);
  // Task 76 — colonne NIVEAU : DIRECTEURS uniquement (nombre de
  // classes de l'école) ; ANNULÉE pour les maîtres de CM2.
  const hasNiveau = kind === "directeurs";
  const cols = hasNiveau ? COL_WIDTHS_9 : COL_WIDTHS_8;

  // Données partagées des modèles Word / Excel.
  const exportData: ExportData = {
    kind,
    rows,
    anneeScolaire: data.annee_scolaire,
    iepName: data.iep?.name ?? "",
    iepRegion: data.iep?.region ?? "",
    iepBp: data.iep?.bp ?? "",
    iepPhone: data.iep?.inspector_phone ?? "",
    iepEmail: data.iep?.inspector_email ?? "",
    inspecteur: data.iep?.inspector_name ?? "",
    totalEffectif: data.total_effectif,
  };

  // Modèle WORD (.doc) — HTML MSO A4 paysage fidèle au document imprimé.
  async function handleWord() {
    setExporting("doc");
    try {
      saveWordDoc(
        await buildWordHtml(exportData),
        `${slugFile(titre)}-${slugFile(exportData.anneeScolaire)}.doc`,
      );
    } finally {
      setExporting(null);
    }
  }

  // Modèle EXCEL (.xlsx) — classeur mis en page (exceljs).
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
          {titre.toLowerCase().replace(/^\w/, (c) => c.toUpperCase())} ·{" "}
          {data.count} agent(s) · Année {data.annee_scolaire}
        </h3>
        <div className="flex items-center gap-2">
          {canPrint ? (
            <DocExportButtons
              canPrint
              canExport={canExport}
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

      {/* === DOCUMENT OFFICIEL (isolement impression #personnel-list-doc) === */}
      {!canPrint && <PrintLockDocumentMessage />}
      <div
        id="personnel-list-doc"
        className={`bg-white mx-auto shadow-lg print:shadow-none mt-3 ${canPrint ? "" : "print-locked"}`}
        style={{
          width: "100%",
          maxWidth: "297mm", // A4 paysage
          padding: "5mm 7mm",
          fontFamily: DOC_FONT,
          color: INK,
          overflowX: "auto",
          position: "relative", // filigrane armoiries DANS LE FOND
        }}
      >
        {/* --- ARMOIRIES DE LA CÔTE D'IVOIRE en filigrane (fond) --- */}
        <CIArmoiriesWatermark fixed />
        <div style={{ position: "relative", zIndex: 1 }}>
          {/* --- EN-TÊTE DE L'ÉTAT NOMINATIF (bloc ministériel +
              République + armoiries — variante compacte « xs ») --- */}
          <OfficialDocHeader iep={data.iep} variant="plan" size="xs" />

          {/* --- Boîte du titre (même gabarit que l'état nominatif :
              bord arrondi VERT DRAPEAU, fond pastel orange) --- */}
          <div style={{ textAlign: "center", margin: "2px 0 4px" }}>
            <span
              style={{
                display: "inline-block",
                border: `2.6px solid ${CI_GREEN}`,
                borderRadius: "12px",
                padding: "8px 40px 9px",
                fontSize: "22px",
                fontWeight: 700,
                letterSpacing: "1.5px",
                lineHeight: 1.25,
                color: INK,
                background: CI_ORANGE_BG,
                boxShadow: `2px 2px 0 ${CI_GREEN_BG}`,
                textAlign: "center",
                ...PRINT_COLOR_STYLE,
              }}
            >
              {t1}
              <br />
              {t2}
            </span>
          </div>

          {/* --- Ligne IEP / Année scolaire (+ Date du jour) --- */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              fontSize: "10.5px",
              margin: "0 2px 2px",
              color: INK,
            }}
          >
            <span>
              <span style={{ color: CI_GREEN_TEXT }}>IEP</span>:{" "}
              {data.iep?.name || "…………"}
            </span>
            <span style={{ textAlign: "right" }}>
              <span style={{ color: CI_GREEN_TEXT }}>Année scolaire</span>:{" "}
              {data.annee_scolaire.split(" ")[0]}
              &nbsp;&nbsp;
              {data.annee_scolaire.split(" ")[1] ?? ""}
              <br />
              <span style={{ color: CI_GREEN_TEXT }}>Date</span>: {todayFr()}
            </span>
          </div>

          {/* --- Tableau : colonnes du modèle (9 directeurs — Task 76
              : NIVEAU = nombre de classes ; 8 maîtres CM2 — NIVEAU
              annulé) --- */}
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              tableLayout: "fixed",
              color: INK,
            }}
          >
            <colgroup>
              {/* Rendu en tableau : PAS de nœuds texte entre les <col>
                  (erreur d'hydratation React « whitespace text node »). */}
              {cols.map((w, i) => (
                <col key={i} style={{ width: w }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th style={th}>N°</th>
                <th style={th}>NOM ET PRENOMS</th>
                <th style={th}>MATRICULE</th>
                <th style={th}>
                  DATE DE 1ERE
                  <br />
                  PRISE DE SERVICE
                </th>
                <th style={th}>ECOLE</th>
                <th style={th}>CODE ECOLE</th>
                <th style={th}>EFFECTIF</th>
                {hasNiveau && <th style={th}>NIVEAU</th>}
                <th style={th}>EMARGEMENT</th>
              </tr>
            </thead>
            <tbody>
              {/* Une ligne par agent — ORDRE ALPHABÉTIQUE (Task 75) ;
                  noms des femmes EN ROUGE (N.B du modèle). */}
              {rows.map((r, i) => (
                <tr key={r.id}>
                  <td style={td}>{i + 1}</td>
                  <td
                    style={{
                      ...tdNom,
                      color: r.sexe === "F" ? "#e00000" : INK,
                    }}
                  >
                    {r.full_name}
                  </td>
                  <td style={td}>{r.matricule ?? ""}</td>
                  <td style={td}>{formatDossierDate(r.date_entree_fp)}</td>
                  <td style={tdLeft}>{r.school_name}</td>
                  <td style={td}>{r.school_code}</td>
                  <td style={td}>{fmtNum(r.effectif)}</td>
                  {/* NIVEAU : directeurs uniquement (nombre de classes
                      de l'école — Task 76) ; annulé pour les CM2. */}
                  {hasNiveau && <td style={td}>{r.niveau ?? ""}</td>}
                  {/* EMARGEMENT : case vide destinée à la signature. */}
                  <td style={td}>&nbsp;</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={cols.length} style={{ ...td, height: "30mm" }}>
                    Aucun agent dans le périmètre de ce document.
                  </td>
                </tr>
              )}
              {/* --- Ligne TOTAL (somme des EFFECTIF — même style que
                  l'état nominatif : fond pastel vert, gras) --- */}
              <tr>
                <td colSpan={4} style={{ border: "none", padding: 0 }} />
                <td
                  colSpan={2}
                  style={{
                    ...th,
                    background: CI_GREEN_BG,
                    color: CI_GREEN_TEXT,
                  }}
                >
                  TOTAL
                </td>
                <td
                  style={{
                    ...td,
                    height: "18px",
                    background: CI_GREEN_BG,
                    color: CI_GREEN_TEXT,
                    fontWeight: 700,
                  }}
                >
                  {fmtNum(data.total_effectif)}
                </td>
                <td style={{ border: "none", padding: 0 }} />
                {hasNiveau && <td style={{ border: "none", padding: 0 }} />}
              </tr>
            </tbody>
          </table>

          {/* --- Mention « Fait à … » SOUS LA DERNIÈRE LIGNE, À DROITE
              (Task 75), puis signature « L'Inspecteur » — les listes
              sont établies par la circonscription — avec 15 MM entre
              le libellé et le NOM du titulaire (espace de signature,
              caractère d'imprimerie comme « Le Directeur »). --- */}
          <div
            style={{
              marginTop: "8px",
              fontSize: "12px",
              textAlign: "right",
              paddingRight: "2px",
              color: INK,
            }}
          >
            {faitALigne(data.iep?.region, data.iep?.name)}
          </div>
          <div
            style={{
              marginTop: "6px",
              display: "flex",
              justifyContent: "flex-end",
            }}
          >
            <div style={{ textAlign: "center", minWidth: "34%" }}>
              <div
                style={{
                  fontSize: "12px",
                  fontWeight: 700,
                  textDecoration: "underline",
                }}
              >
                L&apos;Inspecteur
              </div>
              {(exportData.inspecteur ?? "").trim() ? (
                <div
                  style={{
                    fontSize: "12px",
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.3px",
                    // 15 MM entre « L'Inspecteur » et son nom (Task 75).
                    marginTop: "15mm",
                  }}
                >
                  {exportData.inspecteur.trim()}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Découpe le titre sur 2 lignes pour la boîte (même rendu que
 *  « ETAT NOMINATIF DU <br> PERSONNEL »). */
function splitTitre(t: string): [string, string] {
  const words = t.split(" ");
  const cut = Math.ceil(words.length / 2);
  return [words.slice(0, cut).join(" "), words.slice(cut).join(" ")];
}

// ============================================================ 3 MODÈLES ===
// Word (.doc) + Excel (.xlsx) en plus de l'impression PDF navigateur
// (lib partagée doc-export.tsx) — mêmes entêtes et même tableau que le
// document PDF ci-dessus (convention des documents officiels SYGREN).

/** Données transmises aux modèles Word / Excel. */
interface ExportData {
  kind: PersonnelListKind;
  rows: PersonnelListRow[];
  anneeScolaire: string; // « 2025 2026 » (rentrée en cours)
  iepName: string;
  iepRegion: string;
  iepBp: string;
  iepPhone: string;
  iepEmail: string;
  inspecteur: string;
  totalEffectif: number;
}

// === MODÈLE WORD (.doc) — HTML MSO A4 PAYSAGE fidèle au document PDF ===
async function buildWordHtml(o: ExportData): Promise<string> {
  const armoiries = await armoiriesBase64();
  const esc = escHtml;
  const titre = personnelListTitle(o.kind);
  const [t1, t2] = splitTitre(titre);
  // Task 76 — NIVEAU : directeurs uniquement (nombre de classes),
  // colonne annulée pour les maîtres de CM2.
  const hasNiveau = o.kind === "directeurs";
  const colW = hasNiveau ? COL_WIDTHS_9 : COL_WIDTHS_8;

  // Cellules du tableau (styles EN LIGNE — le convertisseur Word ignore
  // une partie des classes CSS) ; bordures vert drapeau comme le PDF.
  const th =
    "border:1px solid #009E60; padding:1.5px 2px; font-size:11px; font-weight:bold; text-align:center; vertical-align:middle; color:#ffffff; background:#009E60;";
  // Lignes numérotées à 10 mm = 28.3pt (comme l'état nominatif).
  const tdBase =
    "border:1px solid #009E60; padding:1px 3px; font-size:12px; line-height:1.25; text-align:center; vertical-align:middle;";
  const td = `${tdBase} height:28.3pt;`;
  const tdL = td.replace("text-align:center", "text-align:left");
  const tdNom = `${tdL}; font-weight:600; text-transform:uppercase;`;

  const head =
    `<tr>` +
    `<th style="${th}">N&deg;</th>` +
    `<th style="${th}">NOM ET PRENOMS</th>` +
    `<th style="${th}">MATRICULE</th>` +
    `<th style="${th}">DATE DE 1ERE<br>PRISE DE SERVICE</th>` +
    `<th style="${th}">ECOLE</th>` +
    `<th style="${th}">CODE ECOLE</th>` +
    `<th style="${th}">EFFECTIF</th>` +
    (hasNiveau ? `<th style="${th}">NIVEAU</th>` : "") +
    `<th style="${th}">EMARGEMENT</th>` +
    `</tr>`;

  const body = o.rows
    .map((r, i) => {
      const nomColor = r.sexe === "F" ? "#e00000" : "#000000";
      return (
        `<tr>` +
        `<td style="${td}">${i + 1}</td>` +
        `<td style="${tdNom}; color:${nomColor};">${esc(r.full_name.toUpperCase())}</td>` +
        `<td style="${td}">${esc(r.matricule ?? "")}</td>` +
        `<td style="${td}">${esc(formatDossierDate(r.date_entree_fp))}</td>` +
        `<td style="${tdL}">${esc(r.school_name)}</td>` +
        `<td style="${td}">${esc(r.school_code)}</td>` +
        `<td style="${td}">${esc(fmtNum(r.effectif))}</td>` +
        (hasNiveau ? `<td style="${td}">${esc(r.niveau ?? "")}</td>` : "") +
        `<td style="${td}">&nbsp;</td>` +
        `</tr>`
      );
    })
    .join("");

  const emptyRow =
    o.rows.length === 0
      ? `<tr><td colspan=${colW.length} style="${tdBase}">Aucun agent dans le p&eacute;rim&egrave;tre de ce document.</td></tr>`
      : "";

  // Ligne TOTAL (libellé sous ECOLE + CODE ECOLE, valeur sous EFFECTIF).
  const totalRow =
    `<tr>` +
    `<td colspan=4 style="border:none;"></td>` +
    `<td colspan=2 style="${th}; background:#E4F4ED; color:#00734A;">TOTAL</td>` +
    `<td style="${tdBase}; height:18px; background:#E4F4ED; color:#00734A; font-weight:bold;">${esc(fmtNum(o.totalEffectif))}</td>` +
    `<td style="border:none;"></td>` +
    (hasNiveau ? `<td style="border:none;"></td>` : "") +
    `</tr>`;

  // En-tête institutionnel — copie HTML de OfficialDocHeader (variante
  // « plan », taille compacte « xs » — identique à l'état nominatif).
  const region = (o.iepRegion || o.iepName || "…………").toUpperCase();
  const iepName = (o.iepName || "…………").toUpperCase();
  const annee = o.anneeScolaire.split(" ");
  const header = `
<table class=hdr><tr>
<td style="width:64%; font-size:9.5px;">
<p style="margin:0;">MINISTERE DE L'EDUCATION NATIONALE ET</p>
<p style="margin:0; padding-left:6px;">DE L'ALPHABETISATION</p>
<p style="margin:0;">DIRECTION REGIONALE DE ${esc(region)}</p>
<p style="margin:0; letter-spacing:2px; margin-left:56px;">........................</p>
<p style="margin:0;">INSPECTION DE L'ENSEIGNEMENT</p>
<p style="margin:0;">PRESCOLAIRE ET PRIMAIRE DE ${esc(iepName)}</p>
<p style="margin:0;">BP ${esc(o.iepBp || "……")}&nbsp;&nbsp;&nbsp;T&eacute;l ${esc(o.iepPhone || "…………")}</p>
<p style="margin:0;">Courriel : <span style="color:#0563C1; text-decoration:underline;">${esc(o.iepEmail || "…………")}</span></p>
</td>
<td style="width:36%; text-align:center; font-size:9.5px;">
<p style="margin:0;">REPUBLIQUE DE C&Ocirc;TE D'IVOIRE</p>
<p style="margin:0; padding:1px 0;">Union-Discipline-Travail</p>
${armoiries ? `<img src="${armoiries}" width="38" height="38" alt="">` : ""}
</td>
</tr></table>`;

  const inspecteur = (o.inspecteur || "").trim().toUpperCase();
  const fait = faitALigne(o.iepRegion, o.iepName);

  return buildWordShell({
    title: `${titre} ${o.anneeScolaire}`,
    orientation: "landscape", // A4 PAYSAGE (entête de l'état nominatif)
    marginMm: 8,
    styles: `
table.hdr { border-collapse:collapse; width:100%; }
table.hdr td { border:none; vertical-align:top; font-size:9.5px; line-height:1.25; }
.titre { display:inline-block; border:2.6px solid #009E60; background:#FDEBDA; border-radius:12px; padding:8px 40px 9px; font-size:22px; font-weight:bold; letter-spacing:1.5px; line-height:1.25; text-align:center; }
table.doc { border-collapse:collapse; width:100%; table-layout:fixed; }
table.doc td, table.doc th { overflow-wrap:break-word; }
thead.rep { display:table-header-group; }
table.sig { border-collapse:collapse; width:100%; }
table.sig td { border:none; vertical-align:top; }
`,
    bodyHtml: `
${header}
<p style="text-align:center; margin:2px 0 4px;"><span class=titre>${esc(t1)}<br>${esc(t2)}</span></p>
<table class=hdr><tr>
<td style="font-size:10.5px;"><span style="color:#00734A;">IEP</span>: ${esc(o.iepName || "…………")}</td>
<td style="font-size:10.5px; text-align:right; white-space:nowrap;"><span style="color:#00734A;">Ann&eacute;e scolaire</span>: ${esc(annee[0] ?? "")}&nbsp;&nbsp;${esc(annee[1] ?? "")}<br><span style="color:#00734A;">Date</span> : ${esc(todayFr())}</td>
</tr></table>
<table class=doc>
<colgroup>${colW.map((w) => `<col style="width:${w}">`).join("")}</colgroup>
<thead class=rep>${head}</thead>
<tbody>
${body}
${emptyRow}
${totalRow}
</tbody>
</table>
<table class=sig><tr>
<td style="width:66%;"></td>
<td style="width:34%; text-align:center; padding-top:12px; vertical-align:top;">
<p style="margin:0; font-size:12px;">${esc(fait)}</p>
<p style="margin:8px 0 0; font-size:12px; font-weight:bold; text-decoration:underline;">L'Inspecteur</p>
${inspecteur ? `<p style="margin:42.5pt 0 0; font-size:12px; font-weight:bold; text-transform:uppercase; letter-spacing:0.3px;">${esc(inspecteur)}</p>` : ""}
</td>
</tr></table>
`,
  });
}

// === MODÈLE EXCEL (.xlsx) — classeur mis en page (exceljs, import
// dynamique) : en-tête institutionnel fusionné, tableau bordé vert
// (9 colonnes directeurs / 8 colonnes maîtres CM2 — Task 76, femmes
// en rouge), TOTAL en gras, signature « L'Inspecteur » ; impression
// PAYSAGE ajustée à 1 page de large, entêtes répétés.
async function exportExcelAsync(o: ExportData): Promise<void> {
  const { Workbook } = await import("exceljs");
  const wb = new Workbook();
  wb.creator = "SYGREN";
  const titre = personnelListTitle(o.kind);
  // Task 76 — NIVEAU : directeurs uniquement (nombre de classes),
  // colonne annulée pour les maîtres de CM2.
  const hasNiveau = o.kind === "directeurs";
  const ncols = hasNiveau ? 9 : 8; // nombre de colonnes du tableau
  const colWidths = hasNiveau ? XLSX_COL_WIDTHS_9 : XLSX_COL_WIDTHS_8;

  // Rangées d'entêtes du tableau (répétées à l'impression).
  const HEAD_ROW = 8;
  const HEAD_END = 8;

  const ws = wb.addWorksheet("Liste", {
    views: [{ state: "frozen", ySplit: HEAD_END, showGridLines: false }],
    pageSetup: {
      paperSize: 9, // A4
      orientation: "landscape", // PAYSAGE (entête de l'état nominatif)
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.3, right: 0.3, top: 0.45, bottom: 0.45, header: 0.2, footer: 0.2 },
      printTitlesRow: `${HEAD_ROW}:${HEAD_END}`,
    },
  });
  ws.columns = colWidths.map((width) => ({ width }));

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

  // Ligne fusionnée sur les colonnes d'entête (toutes sauf la dernière
  // — EMARGEMENT pour les deux modèles).
  const merged = (
    row: number,
    text: string,
    size: number,
    bold = false,
    italic = false,
  ) => {
    ws.mergeCells(row, 1, row, ncols - 1);
    const c = ws.getCell(row, 1);
    c.value = text;
    c.font = { name: "Arial", size, bold, italic };
    c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  };

  // --- En-tête institutionnel (identique à l'état nominatif Excel) ---
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
  // Boîte du titre (bordée — même gabarit que l'état nominatif).
  merged(5, titre, 18, true);
  for (let col = 1; col <= ncols - 1; col++) ws.getCell(5, col).border = BOX;
  ws.getRow(1).height = 16;
  ws.getRow(2).height = 14;
  ws.getRow(3).height = 13;
  ws.getRow(4).height = 13;
  ws.getRow(5).height = 30;

  // Ligne IEP (gauche) / Année scolaire (droite) + Date du jour.
  ws.mergeCells(6, 1, 6, 4);
  const iepCell = ws.getCell(6, 1);
  iepCell.value = `IEP : ${o.iepName || "…………"}`;
  iepCell.font = font(11, true, GREEN_TXT.argb);
  iepCell.alignment = { horizontal: "left", vertical: "middle" };
  ws.mergeCells(6, 5, 6, 8);
  const annee = ws.getCell(6, 5);
  annee.value = `Année scolaire : ${(o.anneeScolaire || "").split(" ").join("  ")}`;
  annee.font = font(11, true, GREEN_TXT.argb);
  annee.alignment = { horizontal: "right", vertical: "middle" };
  ws.getRow(6).height = 13;
  ws.mergeCells(7, 5, 7, 8);
  const dateCell = ws.getCell(7, 5);
  dateCell.value = `Date : ${todayFr()}`;
  dateCell.font = font(11, true, GREEN_TXT.argb);
  dateCell.alignment = { horizontal: "right", vertical: "middle" };
  ws.getRow(7).height = 12;

  // --- Entête du tableau (rangée unique — 9 colonnes directeurs /
  // 8 colonnes maîtres CM2, Task 76) ---
  const headLabels = [
    "N°",
    "NOM ET PRENOMS",
    "MATRICULE",
    "DATE DE 1ERE PRISE DE SERVICE",
    "ECOLE",
    "CODE ECOLE",
    "EFFECTIF",
    ...(hasNiveau ? ["NIVEAU"] : []),
    "EMARGEMENT",
  ];
  headLabels.forEach((label, k) => {
    ws.getCell(HEAD_ROW, k + 1).value = label;
  });
  for (let r = HEAD_ROW; r <= HEAD_END; r++) {
    const row = ws.getRow(r);
    row.height = 26;
    row.eachCell({ includeEmpty: true }, (c) => {
      c.font = font(9, true, "FFFFFFFF");
      c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      c.border = BOX;
      c.fill = { type: "pattern", pattern: "solid", fgColor: GREEN };
    });
  }

  // --- Lignes agents (femmes EN ROUGE, noms en majuscules) ---
  o.rows.forEach((r, i) => {
    const row = ws.getRow(HEAD_END + 1 + i);
    row.values = [
      i + 1,
      r.full_name.toUpperCase(), // caractère d'imprimerie
      r.matricule ?? "",
      formatDossierDate(r.date_entree_fp),
      r.school_name,
      r.school_code,
      fmtNum(r.effectif),
      // NIVEAU : directeurs uniquement — nombre de classes de
      // l'école (Task 76) ; annulé pour les maîtres de CM2.
      ...(hasNiveau ? [r.niveau ?? ""] : []),
      "", // EMARGEMENT — case vide de signature
    ];
    row.height = 28.3; // 10 mm (comme l'état nominatif)
    row.eachCell({ includeEmpty: true }, (c, col) => {
      c.border = BOX;
      // Femmes EN ROUGE sur la colonne NOM (N.B du modèle).
      c.font = font(10, col === 2, r.sexe === "F" && col === 2 ? RED.argb : undefined);
      c.alignment = {
        horizontal: col === 2 || col === 5 ? "left" : "center",
        vertical: "middle",
        wrapText: true,
      };
    });
  });

  // --- TOTAL calculé (fond pastel vert, gras — comme l'état nominatif) ---
  const rTotal = HEAD_END + 1 + o.rows.length;
  ws.mergeCells(rTotal, 1, rTotal, 4);
  ws.mergeCells(rTotal, 5, rTotal, 6);
  const totalLabel = ws.getCell(rTotal, 5);
  totalLabel.value = "TOTAL";
  ws.getCell(rTotal, 7).value = o.totalEffectif == null ? "" : fmtNum(o.totalEffectif);
  for (let col = 5; col <= 7; col++) {
    const c = ws.getCell(rTotal, col);
    c.border = BOX;
    c.font = font(10, true, GREEN_TXT.argb);
    c.alignment = { horizontal: "center", vertical: "middle" };
    c.fill = { type: "pattern", pattern: "solid", fgColor: GREEN_BG };
  }

  // --- Mention « Fait à … » SOUS LA DERNIÈRE LIGNE, À DROITE (Task 75,
  //     date du jour Task 76) puis signature « L'Inspecteur » + NOM
  //     (colonnes 5… dernière, à droite) avec 15 MM (≈ 42,5 pt) entre
  //     le libellé et le NOM — espace de signature (Task 75).
  const rFait = rTotal + 2;
  ws.mergeCells(rFait, 5, rFait, ncols);
  const faitCell = ws.getCell(rFait, 5);
  faitCell.value = faitALigne(o.iepRegion, o.iepName);
  faitCell.font = font(10);
  faitCell.alignment = { horizontal: "right", vertical: "middle" };
  ws.getRow(rFait).height = 15;

  const rSig = rFait + 1;
  ws.mergeCells(rSig, 5, rSig, ncols);
  const sigLabel = ws.getCell(rSig, 5);
  sigLabel.value = "L'Inspecteur";
  sigLabel.font = { ...font(11, true), underline: true };
  sigLabel.alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(rSig).height = 15;
  const inspecteur = (o.inspecteur || "").trim().toUpperCase();
  if (inspecteur) {
    ws.mergeCells(rSig + 2, 5, rSig + 2, ncols);
    const sigName = ws.getCell(rSig + 2, 5);
    sigName.value = inspecteur;
    sigName.font = font(10, true);
    sigName.alignment = { horizontal: "center", vertical: "middle" };
    // Rangée d'espacement = 15 MM entre « L'Inspecteur » et son nom.
    ws.getRow(rSig + 1).height = 42.5; // 15 mm ≈ 42,5 pt
    ws.getRow(rSig + 2).height = 13;
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
      ws.addImage(imgId, { tl: { col: 7, row: 0.2 }, ext: { width: 38, height: 38 } });
    }
  } catch {
    // armoiries omises — l'en-tête reste lisible
  }

  const buf = await wb.xlsx.writeBuffer();
  saveBlob(
    new Blob([buf], { type: XLSX_MIME }),
    `${slugFile(titre)}-${slugFile(o.anneeScolaire)}.xlsx`,
  );
}
