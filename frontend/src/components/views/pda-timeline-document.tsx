"use client";

// === PDA IEPP — Document officiel imprimable du SUIVI PLURIANNUEL ===
// Version « document officiel » de la matrice élève × évaluations :
// en-tête ministériel (bloc + République + armoiries, police Calibri/
// Carlito — même en-tête que les documents officiels reçus de l'IEPP) +
// titre normalisé « SUIVI DU PLAN D'ACTION PLURIANNUEL DE L'IEPP » +
// matrice des niveaux (E/M/D par évaluation) + TOTAUX DE COLONNE
// (ADMIS / NON ADMIS calculés — directive IEPP) + signatures. Toutes les
// données viennent de /api/pda/timeline (source unique de vérité — le
// document ne recalcule rien). Impression A4 paysage 100 % navigateur
// (isolement #pda-tl-doc, page nommée pda-timeline) : les lignes ne sont
// JAMAIS fractionnées entre deux pages (break-inside: avoid, globals.css).
//
// v3 — EMBELLISSEMENT DRAPEAU CI (inspiré des bulletins individuels) :
// bandeau du titre en VERT DRAPEAU (texte blanc), entêtes de la matrice
// sur fond vert drapeau, bordures vertes, totaux sur fond pastel vert,
// ARMOIRIES en filigrane (répétées à chaque page imprimée) + rubans
// tricolores haut/bas de chaque page.
//
// v4 — NOM DU DIRECTEUR + 3 MODÈLES D'IMPRESSION (demande utilisateur :
// « étendre les 3 modèles PDF / Word / Excel à tous les documents, en
// respectant les en-têtes d'origine » + « ajouter le nom du directeur
// signataire sous LE DIRECTEUR ») : nom affiché sous la signature (PDF),
// modèle WORD (.doc HTML MSO A4 paysage) et modèle EXCEL (.xlsx exceljs)
// reproduisant l'en-tête institutionnel et la matrice. Le champ
// `directeur` est fourni par le backend (GetPDATimeline — v4).

import { useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, X } from "lucide-react";

import { pdaApi } from "@/lib/api";
import {
  DocExportButtons,
  XLSX_MIME,
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
import type { PdaTimelineCell, PdaTimelineResponse } from "@/lib/types";

import {
  INK,
  OFFICIAL_FONT,
  OfficialDocHeader,
} from "./official-doc";
import {
  CIArmoiriesWatermark,
  CI_GREEN,
  CI_GREEN_BG,
  CI_GREEN_TEXT,
  PRINT_COLOR_STYLE,
} from "@/components/ci-decor";

// v3 — bordures de la matrice en VERT DRAPEAU ; ligne des TOTAUX sur
// fond pastel vert drapeau (texte vert foncé, gras).
const BORDER = `1px solid ${CI_GREEN}`;
/** Fond des lignes TOTAUX (ancien gris du modèle). */
const TOTAL_BG = CI_GREEN_BG;

/** Effectif CALCULÉ au format du modèle reçu : 07, 12 — « 00 » pour un
 *  zéro calculé (l'évaluation a eu lieu, aucun admis), case vide si
 *  l'évaluation n'a pas eu lieu (aucune note). */
function fmtTlNum(n: number | undefined | null): string {
  if (n == null) return "";
  return n <= 0 ? "00" : n < 10 ? `0${n}` : `${n}`;
}

const thStyle: CSSProperties = {
  border: BORDER,
  padding: "3px 4px",
  fontSize: "9px",
  fontWeight: 700,
  textAlign: "center",
  color: "#ffffff",
  background: CI_GREEN,
  ...PRINT_COLOR_STYLE,
};

const tdStyle: CSSProperties = {
  border: BORDER,
  padding: "2px 4px",
  fontSize: "9px",
  textAlign: "center",
  color: INK,
};

const labelTdStyle: CSSProperties = {
  ...tdStyle,
  textAlign: "left",
  fontWeight: 600,
};

/** Symbole de maîtrise en encre pour la version officielle imprimée. */
function DocCell({ present, marks }: { present: boolean; marks: [string, boolean][] }) {
  if (!present) return <span style={{ fontSize: "8px", color: "#6b7280" }}>abs</span>;
  return (
    <div className="flex items-center justify-center gap-1 tabular-nums">
      {marks.map(([sym, ok], i) =>
        sym === "–" ? (
          <span key={i} style={{ fontSize: "9px", color: "#6b7280" }}>
            –
          </span>
        ) : (
          <span key={i} style={{ fontSize: "9px", fontWeight: 700, color: INK }}>
            {ok ? "✓" : "✕"}
          </span>
        ),
      )}
    </div>
  );
}

// ============================================================ 3 MODÈLES ===

interface TlExportData {
  evaluations: PdaTimelineResponse["evaluations"];
  students: PdaTimelineResponse["students"];
  schoolName: string;
  className: string;
  year: number;
  iepRegion: string;
  iepName: string;
  iepBp: string;
  iepPhone: string;
  iepEmail: string;
  inspectorName: string;
  directeur: string;
  threshold: number;
}

/** Cellule matrice en TEXTE compact (Word/Excel) : « ✓ ✕ – » ou « abs ». */
function tlCellText(cell: PdaTimelineCell | undefined): string {
  if (!cell || !cell.present) return "abs";
  return [0, 1, 2]
    .map((i) => {
      if (cell.notes[i] == null) return "–";
      return cell.admis[i] ? "✓" : "✕";
    })
    .join(" ");
}

/** Modèle WORD (.doc) — HTML MSO A4 PAYSAGE fidèle au document PDF :
 *  en-tête institutionnel, bandeau titre, matrice (thead répété), totaux,
 *  légende et signatures avec noms. */
function buildTlWordHtml(o: TlExportData): string {
  const esc = escHtml;
  const th =
    "border:1px solid #009E60; padding:3px 4px; font-size:9px; font-weight:bold; text-align:center; color:#fff; background:#009E60;";
  const td =
    "border:1px solid #009E60; padding:2px 4px; font-size:9px; text-align:center;";
  const tdl = td.replace("text-align:center", "text-align:left; font-weight:bold;");
  const tsum =
    "border:1px solid #009E60; padding:2px 4px; font-size:9px; text-align:center; font-weight:bold; background:#E4F4ED; color:#00734A;";

  const head = [
    `<th style="${th}">N&deg;</th>`,
    `<th style="${th}; text-align:left;">&Eacute;L&Egrave;VE (E = Exploitation &middot; M = Math&eacute;matiques &middot; D = Dict&eacute;e)</th>`,
    ...o.evaluations.map((e) => `<th style="${th}">${esc(e.short_label)}<br>E M D</th>`),
    `<th style="${th}">% ADMIS</th>`,
  ].join("");

  const body = o.students
    .map((st, idx) => {
      const red = st.gender === "F" ? " color:#c00000;" : "";
      return (
        `<tr>` +
        `<td style="${td}">${idx + 1}</td>` +
        `<td style="${tdl}${red}">${esc(st.last_name.toUpperCase())} ${esc(st.first_name)} <span style="font-weight:normal;">(${esc(st.matricule)} &middot; ${st.gender === "F" ? "Fille" : "Garçon"})</span></td>` +
        o.evaluations
          .map((e) => `<td style="${td}">${esc(tlCellText(st.cells[e.id]))}</td>`)
          .join("") +
        `<td style="${td}">${st.pct_admis > 0 ? `${st.pct_admis} %` : "—"}</td>` +
        `</tr>`
      );
    })
    .join("");

  const totalAdmis = o.evaluations.reduce((acc, e) => acc + (e.admis ?? 0), 0);
  const totalNonAdmis = o.evaluations.reduce((acc, e) => acc + (e.non_admis ?? 0), 0);
  const totalPresents = o.evaluations.reduce((acc, e) => acc + (e.presents ?? 0), 0);
  const fmtTl = (n: number) => (n <= 0 ? "00" : n < 10 ? `0${n}` : `${n}`);
  const tsumCell = (v: string) => `<td style="${tsum}">${v}</td>`;
  const sumRow = (label: string, cellsHtml: string) =>
    `<tr><td style="${tsum}; text-align:left;" colspan=2>${label}</td>${cellsHtml}</tr>`;

  return buildWordShell({
    title: `Suivi pluriannuel ${o.className} ${o.year}`,
    orientation: "landscape",
    marginMm: 8,
    styles: `
table.doc { border-collapse:collapse; width:100%; }
table.doc thead { display:table-header-group; }
.titre { display:inline-block; background:#009E60; color:#fff; padding:6px 24px; font-size:13.5px; font-weight:bold; }
p.legende { font-size:8px; margin-top:8px; line-height:1.5; }
table.sig { border-collapse:collapse; width:100%; margin-top:20px; font-size:12px; }
`,
    bodyHtml: `
<table style="border-collapse:collapse; width:100%;"><tr>
<td style="border:none; vertical-align:top; font-size:11px; line-height:1.32;">
<p>MINISTERE DE L'EDUCATION NATIONALE ET</p>
<p style="padding-left:6px;">DE L'ALPHABETISATION</p>
<p>DIRECTION REGIONALE DE ${esc((o.iepRegion || "…………").toUpperCase())}</p>
<p>INSPECTION DE L'ENSEIGNEMENT</p>
<p>PRESCOLAIRE ET PRIMAIRE DE ${esc((o.iepName || "…………").toUpperCase())}</p>
<p>BP ${esc(o.iepBp || "……")}&nbsp;&nbsp;&nbsp;T&eacute;l ${esc(o.iepPhone || "…………")}</p>
<p>Courriel : ${esc(o.iepEmail || "…………")}</p>
</td>
<td style="border:none; text-align:center; vertical-align:top; font-size:12px;">
<p>REPUBLIQUE DE C&Ocirc;TE D'IVOIRE</p>
<p>Union-Discipline-Travail</p>
</td>
</tr></table>
<p style="text-align:center; margin:4px 0 10px;"><span class=titre>SUIVI DU PLAN D'ACTION PLURIANNUEL DE L'IEPP</span></p>
<p style="text-align:center; font-size:12.5px; font-weight:bold; text-decoration:underline; margin-bottom:8px;">SUIVI PLURIANNUEL DES NIVEAUX — CLASSE ${esc(o.className.toUpperCase())} — ANNEE ${o.year}</p>
<p style="font-size:11.5px; margin-bottom:8px;"><b>ECOLE : ${esc(o.schoolName)}</b>&nbsp;&nbsp;&nbsp;&nbsp;<b>CLASSE : ${esc(o.className)}</b>&nbsp;&nbsp;&nbsp;&nbsp;${o.students.length} &eacute;l&egrave;ve(s) &middot; ${o.evaluations.length} &eacute;valuation(s)</p>
<table class=doc>
<thead><tr>${head}</tr></thead>
<tbody>${body}</tbody>
<tbody>
${sumRow(
      "ADMIS",
      o.evaluations
        .map((e) => tsumCell((e.presents ?? 0) > 0 ? fmtTl(e.admis ?? 0) : ""))
        .join("") + tsumCell(totalPresents > 0 ? fmtTl(totalAdmis) : ""),
    )}
${sumRow(
      "NON ADMIS",
      o.evaluations
        .map((e) => tsumCell((e.presents ?? 0) > 0 ? fmtTl(e.non_admis ?? 0) : ""))
        .join("") + tsumCell(totalPresents > 0 ? fmtTl(totalNonAdmis) : ""),
    )}
</tbody>
</table>
<p class=legende>&#10003; Admis (note &ge; seuil ${o.threshold} %) &middot; &#10005; Non admis &middot; – note absente &middot; abs absent. ADMIS = &eacute;l&egrave;ves pr&eacute;sents atteignant le seuil dans les 3 mati&egrave;res.</p>
<table class=sig><tr>
<td style="border:none; text-align:left;"><span style="text-decoration:underline;">Le Directeur</span>${o.directeur.trim() ? `<p style="margin-top:24px; font-weight:bold; text-transform:uppercase; letter-spacing:0.3px;">${esc(o.directeur.trim().toUpperCase())}</p>` : ""}</td>
<td style="border:none; text-align:center;"><span style="text-decoration:underline;">L'Inspecteur</span>${o.inspectorName.trim() ? `<p style="margin-top:24px;">${esc(o.inspectorName.trim().toUpperCase())}</p>` : ""}</td>
</tr></table>
`,
  });
}

/** Modèle EXCEL (.xlsx) — classeur paysage (exceljs) fidèle au PDF. */
async function exportTlExcelAsync(o: TlExportData): Promise<void> {
  const { Workbook } = await import("exceljs");
  const wb = new Workbook();
  wb.creator = "SYGREN";
  const ws = wb.addWorksheet("Suivi pluriannuel", {
    views: [{ state: "frozen", ySplit: 8, showGridLines: false }],
    pageSetup: {
      paperSize: 9,
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.3, right: 0.3, top: 0.45, bottom: 0.45, header: 0.2, footer: 0.2 },
      printTitlesRow: "8:8",
    },
  });
  const nCols = 3 + o.evaluations.length;
  ws.columns = [4, 34, ...o.evaluations.map(() => 9), 10].map((width) => ({ width }));
  const font = (size: number, bold = false, argb?: string) => ({
    name: "Arial",
    size,
    bold,
    ...(argb ? { color: { argb } } : {}),
  });
  const GREEN = { argb: "FF009E60" };
  const border = { style: "thin" as const, color: { argb: "FF009E60" } };
  const BOX = { top: border, left: border, bottom: border, right: border };
  const merged = (row: number, text: string, size: number, bold = false, italic = false) => {
    ws.mergeCells(row, 1, row, nCols);
    const c = ws.getCell(row, 1);
    c.value = text;
    c.font = { name: "Arial", size, bold, italic };
    c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  };

  merged(1, "MINISTERE DE L'EDUCATION NATIONALE ET DE L'ALPHABETISATION", 11, true);
  merged(2, `DIRECTION REGIONALE DE ${(o.iepRegion || "…………").toUpperCase()} — INSPECTION DE L'ENSEIGNEMENT PRESCOLAIRE ET PRIMAIRE DE ${(o.iepName || "…………").toUpperCase()}`, 10, true, true);
  merged(3, `BP ${o.iepBp || "……"}   Tél ${o.iepPhone || "…………"}   Courriel : ${o.iepEmail || "…………"}`, 10);
  merged(4, "REPUBLIQUE DE CÔTE D'IVOIRE — Union-Discipline-Travail", 10, true);
  merged(5, "SUIVI DU PLAN D'ACTION PLURIANNUEL DE L'IEPP", 13, true);
  merged(6, `SUIVI PLURIANNUEL DES NIVEAUX — CLASSE ${o.className.toUpperCase()} — ANNEE ${o.year}`, 11, true);
  merged(7, `ECOLE : ${o.schoolName}    CLASSE : ${o.className}    ${o.students.length} élève(s) · ${o.evaluations.length} évaluation(s)`, 10, true);

  // Entêtes de la matrice (rangée 8, répétée à l'impression)
  const head = ws.getRow(8);
  head.height = 30;
  const headValues: Array<string> = ["N°", "ÉLÈVE (E M D)"];
  o.evaluations.forEach((e) => headValues.push(e.short_label));
  headValues.push("% ADMIS");
  head.values = headValues;
  head.eachCell({ includeEmpty: true }, (c) => {
    c.font = font(9, true, "FFFFFFFF");
    c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    c.border = BOX;
    c.fill = { type: "pattern", pattern: "solid", fgColor: GREEN };
  });

  o.students.forEach((st, idx) => {
    const r = 9 + idx;
    const row = ws.getRow(r);
    const values: Array<string | number> = [
      idx + 1,
      `${st.last_name.toUpperCase()} ${st.first_name} (${st.matricule} · ${st.gender === "F" ? "Fille" : "Garçon"})`,
    ];
    o.evaluations.forEach((e) => values.push(tlCellText(st.cells[e.id])));
    values.push(st.pct_admis > 0 ? `${st.pct_admis} %` : "—");
    row.values = values;
    row.height = 16;
    row.eachCell({ includeEmpty: true }, (c, col) => {
      c.border = BOX;
      c.font = font(9, false, st.gender === "F" && col === 2 ? "FFC00000" : undefined);
      c.alignment = { horizontal: col === 2 ? "left" : "center", vertical: "middle", wrapText: true };
    });
  });

  // Totaux ADMIS / NON ADMIS (fond pastel vert)
  const totalAdmis = o.evaluations.reduce((acc, e) => acc + (e.admis ?? 0), 0);
  const totalNonAdmis = o.evaluations.reduce((acc, e) => acc + (e.non_admis ?? 0), 0);
  const totalPresents = o.evaluations.reduce((acc, e) => acc + (e.presents ?? 0), 0);
  const fmtTl = (n: number) => (n <= 0 ? "00" : n < 10 ? `0${n}` : `${n}`);
  const sumRows: Array<[string, Array<string>, string]> = [
    [
      "ADMIS",
      o.evaluations.map((e) => ((e.presents ?? 0) > 0 ? fmtTl(e.admis ?? 0) : "")),
      totalPresents > 0 ? fmtTl(totalAdmis) : "",
    ],
    [
      "NON ADMIS",
      o.evaluations.map((e) => ((e.presents ?? 0) > 0 ? fmtTl(e.non_admis ?? 0) : "")),
      totalPresents > 0 ? fmtTl(totalNonAdmis) : "",
    ],
  ];
  sumRows.forEach(([label, vals, total], k) => {
    const r = 9 + o.students.length + k;
    const row = ws.getRow(r);
    row.values = [null, label, ...vals, total];
    row.height = 15;
    row.eachCell({ includeEmpty: true }, (c) => {
      c.border = BOX;
      c.font = font(9, true, "FF00734A");
      c.alignment = { horizontal: "center", vertical: "middle" };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE4F4ED" } };
    });
    ws.getCell(r, 2).alignment = { horizontal: "left", vertical: "middle" };
  });

  // Signatures
  const rSig = 9 + o.students.length + sumRows.length + 2;
  const dir = ws.getCell(rSig, 2);
  dir.value = "Le Directeur";
  dir.font = font(11, true);
  if (o.directeur.trim()) {
    const dirName = ws.getCell(rSig + 2, 2);
    dirName.value = o.directeur.trim().toUpperCase();
    dirName.font = font(10, true);
  }
  const sigCol = Math.max(4, nCols - 2);
  const insp = ws.getCell(rSig, sigCol);
  insp.value = "L'Inspecteur";
  insp.font = font(11, true, "FF00734A");
  if (o.inspectorName.trim()) {
    const inspName = ws.getCell(rSig + 2, sigCol);
    inspName.value = o.inspectorName.trim().toUpperCase();
    inspName.font = font(10, true);
  }

  const buf = await wb.xlsx.writeBuffer();
  saveBlob(
    new Blob([buf], { type: XLSX_MIME }),
    `suivi-pluriannuel-${slugFile(o.className)}-${o.year}.xlsx`,
  );
}

export function PdaTimelineDocument({
  classId,
  year,
  onClose,
}: {
  classId: string;
  year: number;
  onClose: () => void;
}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["pda-timeline", classId, year],
    queryFn: () => pdaApi.getTimeline(classId, year),
  });

  // Task 23 — verrou d'impression : consultation à l'écran ouverte aux
  // rôles autorisés par le backend, mais la zone « Imprimer / PDF » est
  // GRISÉE (l'impression reste réservée à l'Admin IEP et au Super Admin).
  const printRole = usePrintRole();
  const canPrint = canPrintDocument(printRole, false);
  // État des exports Word/Excel (DOIT rester avant les retours conditionnels
  // — règles des Hooks React).
  const [exporting, setExporting] = useState<"doc" | "xlsx" | null>(null);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          Préparation du document…
        </div>
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="text-center">
          <p className="text-sm text-destructive mb-3">
            {(error as Error)?.message ?? "Document indisponible"}
          </p>
          <button onClick={onClose} className="px-3 py-1.5 bg-gray-200 rounded-md text-sm">
            Retour
          </button>
        </div>
      </div>
    );
  }

  const tl: PdaTimelineResponse = data;
  const evaluations = tl.evaluations ?? [];
  const students = tl.students ?? [];
  const subjects = tl.subjects ?? [];
  const iep = tl.iep;
  const schoolName = tl.school?.name || "…………";
  // Nom du directeur signataire (fourni par le backend — GetPDATimeline v4).
  const directeur = tl.directeur ?? "";

  const exportData: TlExportData = {
    evaluations,
    students,
    schoolName,
    className: tl.class.name,
    year: tl.year,
    iepRegion: iep?.region ?? "",
    iepName: iep?.name ?? "",
    iepBp: iep?.bp ?? "",
    iepPhone: iep?.inspector_phone ?? "",
    iepEmail: iep?.inspector_email ?? "",
    inspectorName: iep?.inspector_name ?? "",
    directeur,
    threshold: evaluations[0]?.threshold ?? 50,
  };

  // Modèle WORD (.doc) — HTML MSO A4 paysage fidèle au document imprimé.
  function handleWord() {
    setExporting("doc");
    try {
      saveWordDoc(
        buildTlWordHtml(exportData),
        `suivi-pluriannuel-${slugFile(exportData.className)}-${exportData.year}.doc`,
      );
    } finally {
      setExporting(null);
    }
  }

  // Modèle EXCEL (.xlsx) — classeur paysage (exceljs importé à la demande).
  async function handleExcel() {
    setExporting("xlsx");
    try {
      await exportTlExcelAsync(exportData);
    } finally {
      setExporting(null);
    }
  }

  // Totaux de colonne (API) : lignes ADMIS / NON ADMIS de la matrice —
  // la dernière colonne porte les totaux sur toutes les évaluations.
  const totalAdmis = evaluations.reduce((acc, e) => acc + (e.admis ?? 0), 0);
  const totalNonAdmis = evaluations.reduce(
    (acc, e) => acc + (e.non_admis ?? 0),
    0,
  );
  const totalPresents = evaluations.reduce(
    (acc, e) => acc + (e.presents ?? 0),
    0,
  );
  const summaryRow: CSSProperties = {
    ...tdStyle,
    fontWeight: 700,
    background: TOTAL_BG,
    color: CI_GREEN_TEXT,
  };
  const summaryLabel: CSSProperties = {
    ...summaryRow,
    whiteSpace: "nowrap",
  };

  return (
    <div className="min-h-screen bg-gray-100 print:bg-white print:min-h-0">
      {/* Barre d'outils (masquée à l'impression) */}
      <div className="sticky top-0 z-10 flex items-center justify-between bg-white border-b px-4 py-2 print:hidden">
        <h3 className="font-semibold text-sm">
          Plan d&apos;Action IEPP — Suivi pluriannuel · {tl.class.name} · {tl.year}
        </h3>
        <div className="flex items-center gap-2">
          {canPrint ? (
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

      {/* === DOCUMENT OFFICIEL (isolement impression #pda-tl-doc) === */}
      {!canPrint && <PrintLockDocumentMessage />}
      <div
        id="pda-tl-doc"
        className={`bg-white mx-auto shadow-lg print:shadow-none ${canPrint ? "" : "print-locked"}`}
        style={{
          width: "100%",
          maxWidth: "297mm", // A4 paysage — la matrice est large
          padding: "10mm 8mm",
          fontFamily: OFFICIAL_FONT,
          color: INK,
          overflowX: "auto",
          position: "relative", // filigrane armoiries DANS LE FOND
        }}
      >
        {/* v3 — ARMOIRIES DE LA CÔTE D'IVOIRE en filigrane (répétées sur
            chaque page imprimée). Rubans tricolores haut/bas RETIRÉS :
            aucune bordure drapeau sur les feuilles imprimables. */}
        <CIArmoiriesWatermark fixed />
        <div style={{ position: "relative", zIndex: 1 }}>
        {/* --- En-tête institutionnel (identique aux documents officiels reçus) --- */}
        <OfficialDocHeader iep={iep} variant="plan" size="sm" />

        {/* --- Bandeau du titre VERT DRAPEAU (texte blanc — inspiration
            bulletins individuels) + sous-titre souligné --- */}
        <div style={{ textAlign: "center", margin: "4px 0 10px" }}>
          <div
            style={{
              display: "inline-block",
              background: CI_GREEN,
              color: "#ffffff",
              padding: "6px 24px",
              fontSize: "13.5px",
              fontWeight: 700,
              lineHeight: 1.45,
              ...PRINT_COLOR_STYLE,
            }}
          >
            SUIVI DU PLAN D&apos;ACTION PLURIANNUEL DE L&apos;IEPP
          </div>
          <div
            style={{
              fontSize: "12.5px",
              fontWeight: 700,
              textDecoration: "underline",
              marginTop: "8px",
              color: CI_GREEN_TEXT,
            }}
          >
            SUIVI PLURIANNUEL DES NIVEAUX — CLASSE {tl.class.name.toUpperCase()} —
            ANNEE {tl.year}
          </div>
        </div>

        {/* --- École / Classe / Effectif (labels gras, modèle reçu) --- */}
        <div style={{ fontSize: "11.5px", marginBottom: "8px" }}>
          <span style={{ fontWeight: 700 }}>ECOLE : {schoolName}</span>
          <span style={{ marginLeft: "32px", fontWeight: 700 }}>
            CLASSE : {tl.class.name}
          </span>
          <span style={{ marginLeft: "32px", fontWeight: 400 }}>
            {students.length} élève(s) · {evaluations.length} évaluation(s)
          </span>
        </div>

        {/* --- Matrice élève × évaluations --- */}
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ ...thStyle, border: "none", width: "24px" }}>#</th>
              <th style={{ ...thStyle, border: "none", textAlign: "left" }}>ÉLÈVE</th>
              {evaluations.map((e) => (
                <th
                  key={e.id}
                  style={{ ...thStyle, border: "none", width: "40px" }}
                  title={`${e.label} — seuil ${e.threshold} % du barème`}
                >
                  {e.short_label}
                </th>
              ))}
              <th style={{ ...thStyle, border: "none", width: "52px" }}>% ADMIS</th>
            </tr>
            <tr>
              <th style={{ ...thStyle, border: "none" }} />
              <th style={{ ...thStyle, border: "none", textAlign: "left" }}>
                (E = Exploitation · M = Mathématiques · D = Dictée)
              </th>
              {evaluations.map((e) => (
                <th key={`s-${e.id}`} style={{ ...thStyle, border: "none" }}>
                  E M D
                </th>
              ))}
              <th style={{ ...thStyle, border: "none" }} />
            </tr>
          </thead>
          <tbody>
            {students.map((st, idx) => (
              <tr key={st.student_id}>
                <td style={tdStyle}>{idx + 1}</td>
                <td style={labelTdStyle}>
                  {st.last_name} {st.first_name}{" "}
                  <span style={{ fontWeight: 400, fontSize: "8px" }}>
                    ({st.matricule} · {st.gender === "F" ? "Fille" : "Garçon"})
                  </span>
                </td>
                {evaluations.map((e) => {
                  const cell = st.cells[e.id];
                  const marks: [string, boolean][] = [0, 1, 2].map((i) => {
                    if (!cell || !cell.present) return ["abs", false] as [string, boolean];
                    if (cell.notes[i] == null) return ["–", false] as [string, boolean];
                    return [cell.admis[i] ? "✓" : "✕", cell.admis[i]] as [string, boolean];
                  });
                  return (
                    <td key={e.id} style={tdStyle}>
                      <DocCell present={!!cell?.present} marks={marks} />
                    </td>
                  );
                })}
                <td style={tdStyle}>
                  {st.pct_admis > 0 ? `${st.pct_admis} %` : "—"}
                </td>
              </tr>
            ))}
            {students.length === 0 && (
              <tr>
                <td style={tdStyle} colSpan={evaluations.length + 3}>
                  Aucun élève dans cette classe.
                </td>
              </tr>
            )}
          </tbody>
          {/* === Totaux de colonne (directive IEPP : les admis et les
              non admis de chaque colonne sont calculés) — tbody FRÈRE du
              tbody principal (un tbody ne peut pas s'y imbriquer) ; les
              DEUX lignes forment un groupe insécable : elles restent
              toujours ensemble sur la même page. === */}
          {evaluations.length > 0 && (
            <tbody
              style={{
                breakInside: "avoid",
                pageBreakInside: "avoid",
              }}
            >
              <tr>
                <td style={summaryLabel} colSpan={2}>
                  ADMIS
                </td>
                {evaluations.map((e) => (
                  <td key={`a-${e.id}`} style={summaryRow} title={`${e.label} — ${e.admis} admis / ${e.presents} présents`}>
                    {(e.presents ?? 0) > 0 ? fmtTlNum(e.admis) : ""}
                  </td>
                ))}
                <td style={summaryRow}>
                  {totalPresents > 0 ? fmtTlNum(totalAdmis) : ""}
                </td>
              </tr>
              <tr>
                <td style={summaryLabel} colSpan={2}>
                  NON ADMIS
                </td>
                {evaluations.map((e) => (
                  <td key={`na-${e.id}`} style={summaryRow} title={`${e.label} — ${e.non_admis} non admis / ${e.presents} présents`}>
                    {(e.presents ?? 0) > 0 ? fmtTlNum(e.non_admis) : ""}
                  </td>
                ))}
                <td style={summaryRow}>
                  {totalPresents > 0 ? fmtTlNum(totalNonAdmis) : ""}
                </td>
              </tr>
            </tbody>
          )}
        </table>

        {/* --- Légende compacte --- */}
        <p style={{ fontSize: "8px", marginTop: "8px", lineHeight: 1.5, color: INK }}>
          <span style={{ fontWeight: 700 }}>✓</span> Admis (note ≥ seuil) ·{" "}
          <span style={{ fontWeight: 700 }}>✕</span> Non admis · – note absente · abs
          absent. ADMIS = élèves présents atteignant le seuil dans les 3 matières
          ; NON ADMIS = présents n'y parvenant pas ; % Admis = admis / présents
          de la colonne. C = composition mensuelle (notes du module Notes) · EB =
          examen blanc. Seuil de maîtrise : {evaluations[0]?.threshold ?? 50} % du barème
          de chaque évaluation. Matières :{" "}
          {subjects.map((s, i) => (
            <span key={s.key}>
              {i > 0 ? " · " : ""}
              <span style={{ fontWeight: 700 }}>{s.label}</span>{" "}
              {s.matched
                ? `(compositions /${s.max_composition}, blancs /${s.max_blanc})`
                : "(non notée dans les compositions)"}
            </span>
          ))}
          .
        </p>

        {/* --- Signatures + nom de l'inspecteur (patron de la fiche reçue) --- */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            fontSize: "12px",
            marginTop: "20px",
          }}
        >
          <div style={{ textAlign: "left" }}>
            <span style={{ textDecoration: "underline" }}>Le Directeur</span>
            {/* v4 — NOM du directeur signataire SOUS « Le Directeur », au
                même niveau que le nom de l'inspecteur (demande utilisateur). */}
            {directeur ? (
              <div
                style={{
                  fontSize: "11px",
                  marginTop: "24px",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.3px",
                }}
              >
                {directeur.toUpperCase()}
              </div>
            ) : null}
          </div>
          <div style={{ textAlign: "center" }}>
            <span style={{ textDecoration: "underline", color: CI_GREEN_TEXT }}>L&apos;Inspecteur</span>
            {iep?.inspector_name ? (
              <div
                style={{
                  fontSize: "11px",
                  marginTop: "24px",
                }}
              >
                {iep.inspector_name.toUpperCase()}
              </div>
            ) : null}
          </div>
        </div>
        </div>
      </div>

      <p className="text-center text-[11px] text-muted-foreground py-4 print:hidden">
        Le suivi pluriannuel se lit colonne par colonne : le niveau d&apos;étude de
        chaque élève dans les 3 matières désignées, évaluation après évaluation.
        Les lignes ADMIS / NON ADMIS de chaque colonne sont calculées ; à
        l&apos;impression, les lignes ne sont jamais fractionnées entre deux pages.
      </p>
    </div>
  );
}
