"use client";

// === PDA IEPP — Document officiel imprimable (fiche par école) ===
// Reproduction FIDÈLE de la fiche reçue de l'IEPP (PLAN D'ACTION IEPP_1) :
// « SUIVI DU PLAN D'ACTION PLURIANNUEL DE L'IEPP — RESULTAT DE L'EXAMEN
// BLANC N°X » pour chaque évaluation suivie (examen blanc saisie manuelle
// ou composition mensuelle dérivée du module Notes).
//   - En-tête institutionnel : bloc ministériel + République + armoiries
//     + devise en italique (modèle reçu) — police Calibri (Carlito).
//   - Titre encadré fin + titre de l'évaluation souligné en gras.
//   - ECOLE : / CLASSE : en gras à gauche (modèle reçu).
//   - Tableau 1 : Présents / Admis / % Admis × (Total | Filles | Garçons)
//   - Tableau 2 : maîtrise par matière (Exploitation de texte,
//     Mathématiques, Dictée) × (Total | Garçons | Filles)
//   - Tableau 3 : difficultés (calculé) + remédiation (saisissable ici)
//   - Signatures Le Directeur / L'Inspecteur + nom de l'inspecteur en bas
//     à droite (comme « DOSSO LACINE » sur le modèle reçu).
// Tous les agrégats sont calculés côté serveur (/summary) — le document ne
// recalcule rien. Impression 100 % navigateur (isolement #pda-doc).
//
// v3 — EMBELLISSEMENT DRAPEAU CI (inspiré des bulletins individuels) :
// bandeau du titre en VERT DRAPEAU (texte blanc), entêtes de tableaux
// sur fond vert drapeau, bordures vertes, rubans tricolores haut/bas
// et ARMOIRIES en filigrane dans le fond du document.
//
// v4 — 3 MODÈLES D'IMPRESSION (demande utilisateur : « étendre les 3
// modèles PDF / Word / Excel à tous les documents, en respectant les
// en-têtes d'origine ») : modèle WORD (.doc HTML MSO A4 portrait) et
// modèle EXCEL (.xlsx exceljs) reproduisant l'en-tête institutionnel, les
// 3 tableaux et les signatures avec noms (le nom du directeur signataire
// était déjà affiché sous « Le Directeur » — Task 37).

import { Fragment, useState, type CSSProperties } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, X } from "lucide-react";
import { toast } from "sonner";

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
import { monthLabel } from "@/lib/session-utils";
import type { PdaCountRow, PdaSummary } from "@/lib/types";

import { INK, OFFICIAL_FONT, OfficialDocHeader, fmtDocNum } from "./official-doc";
import {
  CIArmoiriesWatermark,
  CI_GREEN,
  CI_GREEN_TEXT,
  PRINT_COLOR_STYLE,
} from "@/components/ci-decor";

/** Pourcentages à 2 décimales, virgule française (modèle reçu). */
function fmtPct(n: number): string {
  return `${n.toFixed(2).replace(".", ",")}%`;
}

/** Ordinal français du modèle reçu : 1er, 2e, 3e… */
function ordinal(n: number): string {
  return n === 1 ? "1er" : `${n}e`;
}

// Bordures et entêtes aux COULEURS DU DRAPEAU ivoirien (inspiration
// bulletins individuels) — entêtes sur FOND VERT DRAPEAU, texte blanc.
const thStyle: CSSProperties = {
  border: `1px solid ${CI_GREEN}`,
  padding: "4px 6px",
  fontSize: "12px",
  fontWeight: 400, // entêtes réguliers sur le modèle reçu
  textAlign: "center",
  color: "#ffffff",
  background: CI_GREEN,
  ...PRINT_COLOR_STYLE,
};

const tdStyle: CSSProperties = {
  border: `1px solid ${CI_GREEN}`,
  padding: "3px 6px",
  fontSize: "12px",
  textAlign: "center",
  color: INK,
};

const labelTdStyle: CSSProperties = {
  ...tdStyle,
  textAlign: "left",
  fontWeight: 600,
  color: CI_GREEN_TEXT,
};

/** Cellules d'effectifs dans l'ordre demandé (Total/Filles/Garçons etc.). */
function CountCells({
  row,
  order,
}: {
  row: PdaCountRow;
  order: Array<"total" | "filles" | "garcons">;
}) {
  return (
    <>
      {order.map((k) => (
        <td key={k} style={tdStyle}>
          {fmtDocNum(row[k])}
        </td>
      ))}
    </>
  );
}

// ============================================================ 3 MODÈLES ===

interface PdaExportData {
  examNumber: number;
  evalTitle: string;
  evalColHeader: string;
  schoolName: string;
  className: string;
  iepRegion: string;
  iepName: string;
  iepBp: string;
  iepPhone: string;
  iepEmail: string;
  inspectorName: string;
  directeur: string;
  table1: PdaSummary["table1"];
  table2: PdaSummary["table2"];
  table3: PdaSummary["table3"];
  rem: {
    mise_a_niveau_total: number;
    mise_a_niveau_garcons: number;
    mise_a_niveau_filles: number;
    remediation_total: number;
    remediation_garcons: number;
    remediation_filles: number;
  };
}

/** Ligne de comptes (Word) : label + cellules dans l'ordre demandé. */
function pdaCountCellsHtml(
  row: PdaCountRow,
  order: Array<"total" | "filles" | "garcons">,
  td: string,
): string {
  return order.map((k) => `<td style="${td}">${fmtDocNum(row[k])}</td>`).join("");
}

/** Modèle WORD (.doc) — HTML MSO A4 PORTRAIT fidèle au document PDF :
 *  en-tête institutionnel, bandeau titre, 3 tableaux bordés vert,
 *  signatures Le Directeur (nom) / L'Inspecteur (nom). */
function buildPdaWordHtml(o: PdaExportData): string {
  const esc = escHtml;
  const th =
    "border:1px solid #009E60; padding:4px 6px; font-size:12px; text-align:center; color:#fff; background:#009E60;";
  const td =
    "border:1px solid #009E60; padding:3px 6px; font-size:12px; text-align:center;";
  const tdl =
    "border:1px solid #009E60; padding:3px 6px; font-size:12px; text-align:left; font-weight:bold; color:#00734A;";

  const t2keys = ["exploitation", "math", "dictee"] as const;
  const t1 = `
<table style="border-collapse:collapse; width:70%; margin-bottom:6px;">
<tr><td style="border:none; width:26%;"></td><th style="${th}" colspan=3>${esc(o.evalColHeader)}</th></tr>
<tr><td style="border:none;"></td><th style="${th}">TOTAL</th><th style="${th}">FILLES</th><th style="${th}">GAR&Ccedil;ONS</th></tr>
<tr><td style="border:none; font-size:12px;">PRESENTS</td>${pdaCountCellsHtml(o.table1.presents, ["total", "filles", "garcons"], td)}</tr>
<tr><td style="border:none; font-size:12px;">ADMIS</td>${pdaCountCellsHtml(o.table1.admis, ["total", "filles", "garcons"], td)}</tr>
<tr><td style="border:none; font-size:12px;">% ADMIS</td><td style="${td}" colspan=3>${esc(fmtPct(o.table1.pct_admis))}</td></tr>
</table>`;

  const t2 = `
<table style="border-collapse:collapse; width:100%; margin-bottom:6px;">
<tr><td style="border:none; width:17%;"></td>${t2keys.map((k) => `<th style="${th}" colspan=3>${k === "exploitation" ? "EXPLOITATION DE TEXTE" : k === "math" ? "MATH&Eacute;MATIQUES" : "DICT&Eacute;E"}</th>`).join("")}</tr>
<tr><td style="border:none;"></td>${t2keys.map(() => `<th style="${th}">TOTAL</th><th style="${th}">GAR&Ccedil;ONS</th><th style="${th}">FILLES</th>`).join("")}</tr>
<tr><td style="${tdl}">Pr&eacute;sents</td>${t2keys.map((k) => pdaCountCellsHtml(o.table2[k].presents, ["total", "garcons", "filles"], td)).join("")}</tr>
<tr><td style="${tdl}">Admis</td>${t2keys.map((k) => pdaCountCellsHtml(o.table2[k].admis, ["total", "garcons", "filles"], td)).join("")}</tr>
<tr><td style="${tdl}">% Admis</td>${t2keys.map((k) => `<td style="${td}" colspan=3>${o.table2[k].presents.total > 0 ? esc(fmtPct(o.table2[k].pct_admis)) : ""}</td>`).join("")}</tr>
<tr><td style="${tdl}">Non Admis</td>${t2keys.map((k) => pdaCountCellsHtml(o.table2[k].non_admis, ["total", "garcons", "filles"], td)).join("")}</tr>
<tr><td style="${tdl}">% non admis</td>${t2keys.map((k) => `<td style="${td}" colspan=3>${o.table2[k].presents.total > 0 ? esc(fmtPct(o.table2[k].pct_non_admis)) : ""}</td>`).join("")}</tr>
</table>`;

  const t3 = `
<table style="border-collapse:collapse; width:100%; margin-bottom:14px;">
<tr><td style="border:none; width:55%;"></td><th style="${th}">TOTAL</th><th style="${th}">GAR&Ccedil;ONS</th><th style="${th}">FILLES</th></tr>
<tr><td style="${tdl}">Le nombre d'&eacute;l&egrave;ves en difficult&eacute;s d'apprentissage</td>${pdaCountCellsHtml(o.table3.difficultes, ["total", "garcons", "filles"], td)}</tr>
<tr><td style="${tdl}; font-size:11px;">Le nombre d'&eacute;l&egrave;ves ayant b&eacute;n&eacute;fici&eacute; des cours de mise &agrave; niveau (voir liste des &eacute;l&egrave;ves et les notes avant et apr&egrave;s)</td><td style="${td}">${fmtDocNum(o.rem.mise_a_niveau_total)}</td><td style="${td}">${fmtDocNum(o.rem.mise_a_niveau_garcons)}</td><td style="${td}">${fmtDocNum(o.rem.mise_a_niveau_filles)}</td></tr>
<tr><td style="${tdl}; font-size:11px;">Le nombre d'&eacute;l&egrave;ves ayant b&eacute;n&eacute;fici&eacute; des m&eacute;canismes de rem&eacute;diation par niveau et par mati&egrave;re.</td><td style="${td}">${fmtDocNum(o.rem.remediation_total)}</td><td style="${td}">${fmtDocNum(o.rem.remediation_garcons)}</td><td style="${td}">${fmtDocNum(o.rem.remediation_filles)}</td></tr>
</table>`;

  return buildWordShell({
    title: o.evalTitle,
    orientation: "portrait",
    marginMm: 8,
    styles: `
table.sig { border-collapse:collapse; width:100%; margin-top:24px; font-size:13px; }
.titre { display:inline-block; background:#009E60; color:#fff; padding:8px 26px; font-size:15px; font-weight:bold; }
p.intro { font-size:12px; margin:6px 0; line-height:1.5; }
`,
    bodyHtml: `
<table style="border-collapse:collapse; width:100%;"><tr>
<td style="border:none; vertical-align:top; font-size:14px; line-height:1.32;">
<p>MINISTERE DE L'EDUCATION NATIONALE ET</p>
<p style="padding-left:6px;">DE L'ALPHABETISATION</p>
<p>DIRECTION REGIONALE DE ${esc((o.iepRegion || "…………").toUpperCase())}</p>
<p>INSPECTION DE L'ENSEIGNEMENT</p>
<p>PRESCOLAIRE ET PRIMAIRE DE ${esc((o.iepName || "…………").toUpperCase())}</p>
<p>BP ${esc(o.iepBp || "……")}&nbsp;&nbsp;&nbsp;T&eacute;l ${esc(o.iepPhone || "…………")}</p>
<p>Courriel : ${esc(o.iepEmail || "…………")}</p>
</td>
<td style="border:none; text-align:center; vertical-align:top; font-size:14px;">
<p>REPUBLIQUE DE C&Ocirc;TE D'IVOIRE</p>
<p>Union-Discipline-Travail</p>
</td>
</tr></table>
<p style="text-align:center; margin:4px 0 10px;"><span class=titre>SUIVI DU PLAN D'ACTION PLURIANNUEL DE L'IEPP</span></p>
<p style="text-align:center; font-size:14.5px; font-weight:bold; text-decoration:underline; margin-bottom:10px;">${esc(o.evalTitle)}</p>
<p style="font-size:14px; font-weight:bold; margin-bottom:8px; line-height:1.7;">ECOLE : ${esc(o.schoolName)}<br>CLASSE : ${esc(o.className)}</p>
${t1}
<p class=intro>Le nombre d'&eacute;l&egrave;ves du ${esc(o.className)} ayant atteint le seuil suffisant de ma&icirc;trise en lecture (Exploitation de texte, Math&eacute;matiques, Dict&eacute;e ).</p>
${t2}
<p class=intro>Accro&icirc;tre les acquis scolaires et la performance aux examens des &eacute;l&egrave;ves de tous les niveaux :</p>
${t3}
<table class=sig><tr>
<td style="border:none; text-align:left;"><span style="text-decoration:underline;">Le Directeur</span>${o.directeur.trim() ? `<p style="margin-top:28px; font-weight:bold; text-transform:uppercase; letter-spacing:0.3px; font-size:12px;">${esc(o.directeur.trim().toUpperCase())}</p>` : ""}</td>
<td style="border:none; text-align:center;"><span style="text-decoration:underline;">L'Inspecteur</span>${o.inspectorName.trim() ? `<p style="margin-top:28px; font-weight:bold; font-size:12px;">${esc(o.inspectorName.trim().toUpperCase())}</p>` : ""}</td>
</tr></table>
`,
  });
}

/** Modèle EXCEL (.xlsx) — classeur portrait (exceljs) : en-tête
 *  institutionnel fusionné puis les 3 tableaux empilés, signatures. */
async function exportPdaExcelAsync(o: PdaExportData): Promise<void> {
  const { Workbook } = await import("exceljs");
  const wb = new Workbook();
  wb.creator = "SYGREN";
  const ws = wb.addWorksheet("Fiche PDA", {
    views: [{ showGridLines: false }],
    pageSetup: {
      paperSize: 9,
      orientation: "portrait",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.35, right: 0.35, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
    },
  });
  ws.columns = [46, 9, 10, 9, 9, 10, 9, 9, 10, 9].map((width) => ({ width }));
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
    ws.mergeCells(row, 1, row, 10);
    const c = ws.getCell(row, 1);
    c.value = text;
    c.font = { name: "Arial", size, bold, italic };
    c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  };
  const bandCell = (r: number, c1: number, c2: number, text: string) => {
    ws.mergeCells(r, c1, r, c2);
    const cell = ws.getCell(r, c1);
    cell.value = text;
    cell.font = font(10, false, "FFFFFFFF");
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.border = BOX;
    cell.fill = { type: "pattern", pattern: "solid", fgColor: GREEN };
  };
  const dataCell = (r: number, c: number, v: string | number, bold = false) => {
    const cell = ws.getCell(r, c);
    cell.value = v;
    cell.font = font(10, bold);
    cell.alignment = { horizontal: c === 1 ? "left" : "center", vertical: "middle", wrapText: c === 1 };
    cell.border = BOX;
  };

  merged(1, "MINISTERE DE L'EDUCATION NATIONALE ET DE L'ALPHABETISATION", 12, true);
  merged(2, `DIRECTION REGIONALE DE ${(o.iepRegion || "…………").toUpperCase()} — INSPECTION DE L'ENSEIGNEMENT PRESCOLAIRE ET PRIMAIRE DE ${(o.iepName || "…………").toUpperCase()}`, 11, true, true);
  merged(3, `BP ${o.iepBp || "……"}   Tél ${o.iepPhone || "…………"}   Courriel : ${o.iepEmail || "…………"}`, 11);
  merged(4, "REPUBLIQUE DE CÔTE D'IVOIRE — Union-Discipline-Travail", 11, true);
  merged(5, "SUIVI DU PLAN D'ACTION PLURIANNUEL DE L'IEPP", 14, true);
  merged(6, o.evalTitle, 12, true);
  merged(7, `ECOLE : ${o.schoolName}    CLASSE : ${o.className}`, 11, true);
  ws.getRow(8).height = 4;

  // Tableau 1 : vue d'ensemble (TOTAL | FILLES | GARÇONS)
  bandCell(9, 2, 4, o.evalColHeader);
  ["TOTAL", "FILLES", "GARÇONS"].forEach((label, k) => bandCell(10, 2 + k, 2 + k, label));
  dataCell(11, 1, "PRESENTS");
  dataCell(11, 2, fmtDocNum(o.table1.presents.total));
  dataCell(11, 3, fmtDocNum(o.table1.presents.filles));
  dataCell(11, 4, fmtDocNum(o.table1.presents.garcons));
  dataCell(12, 1, "ADMIS");
  dataCell(12, 2, fmtDocNum(o.table1.admis.total));
  dataCell(12, 3, fmtDocNum(o.table1.admis.filles));
  dataCell(12, 4, fmtDocNum(o.table1.admis.garcons));
  dataCell(13, 1, "% ADMIS");
  ws.mergeCells(13, 2, 13, 4);
  dataCell(13, 2, fmtPct(o.table1.pct_admis));

  merged(15, `Le nombre d'élèves du ${o.className} ayant atteint le seuil suffisant de maîtrise en lecture (Exploitation de texte, Mathématiques, Dictée).`, 10);

  // Tableau 2 : maîtrise par matière (TOTAL | GARÇONS | FILLES ×3)
  const t2bands: Array<[string, keyof PdaSummary["table2"]]> = [
    ["EXPLOITATION DE TEXTE", "exploitation"],
    ["MATHÉMATIQUES", "math"],
    ["DICTÉE", "dictee"],
  ];
  t2bands.forEach(([label], b) => bandCell(16, 2 + b * 3, 4 + b * 3, label));
  for (let b = 0; b < 3; b++) {
    ["TOTAL", "GARÇONS", "FILLES"].forEach((label, k) =>
      bandCell(17, 2 + b * 3 + k, 2 + b * 3 + k, label),
    );
  }
  const t2Rows: Array<
    [string, (st: PdaSummary["table2"][keyof PdaSummary["table2"]]) => Array<string | number>]
  > = [
    ["Présents", (st) => [fmtDocNum(st.presents.total), fmtDocNum(st.presents.garcons), fmtDocNum(st.presents.filles)]],
    ["Admis", (st) => [fmtDocNum(st.admis.total), fmtDocNum(st.admis.garcons), fmtDocNum(st.admis.filles)]],
    ["% Admis", (st) => [st.presents.total > 0 ? fmtPct(st.pct_admis) : "", "", ""]],
    ["Non Admis", (st) => [fmtDocNum(st.non_admis.total), fmtDocNum(st.non_admis.garcons), fmtDocNum(st.non_admis.filles)]],
    ["% non admis", (st) => [st.presents.total > 0 ? fmtPct(st.pct_non_admis) : "", "", ""]],
  ];
  t2Rows.forEach(([label, vals], i) => {
    const r = 18 + i;
    dataCell(r, 1, label, true);
    t2bands.forEach(([, k], b) => {
      const st = o.table2[k];
      const vs = vals(st);
      // Les % fusionnent leurs 3 colonnes
      if (String(vs[0]).includes("%")) {
        ws.mergeCells(r, 2 + b * 3, r, 4 + b * 3);
        dataCell(r, 2 + b * 3, vs[0]);
      } else {
        dataCell(r, 2 + b * 3, vs[0]);
        dataCell(r, 3 + b * 3, vs[1]);
        dataCell(r, 4 + b * 3, vs[2]);
      }
    });
  });

  merged(24, "Accroître les acquis scolaires et la performance aux examens des élèves de tous les niveaux :", 10);

  // Tableau 3 : difficultés + remédiation (TOTAL | GARÇONS | FILLES)
  ["TOTAL", "GARÇONS", "FILLES"].forEach((label, k) => bandCell(25, 2 + k, 2 + k, label));
  dataCell(26, 1, "Le nombre d'élèves en difficultés d'apprentissage", true);
  dataCell(26, 2, fmtDocNum(o.table3.difficultes.total));
  dataCell(26, 3, fmtDocNum(o.table3.difficultes.garcons));
  dataCell(26, 4, fmtDocNum(o.table3.difficultes.filles));
  dataCell(27, 1, "Le nombre d'élèves ayant bénéficié des cours de mise à niveau", true);
  dataCell(27, 2, fmtDocNum(o.rem.mise_a_niveau_total));
  dataCell(27, 3, fmtDocNum(o.rem.mise_a_niveau_garcons));
  dataCell(27, 4, fmtDocNum(o.rem.mise_a_niveau_filles));
  dataCell(28, 1, "Le nombre d'élèves ayant bénéficié des mécanismes de remédiation par niveau et par matière", true);
  dataCell(28, 2, fmtDocNum(o.rem.remediation_total));
  dataCell(28, 3, fmtDocNum(o.rem.remediation_garcons));
  dataCell(28, 4, fmtDocNum(o.rem.remediation_filles));

  // Signatures
  const dir = ws.getCell(31, 1);
  dir.value = "Le Directeur";
  dir.font = font(12, true);
  if (o.directeur.trim()) {
    const dirName = ws.getCell(33, 1);
    dirName.value = o.directeur.trim().toUpperCase();
    dirName.font = font(11, true);
  }
  const insp = ws.getCell(31, 8);
  insp.value = "L'Inspecteur";
  insp.font = font(12, true, "FF00734A");
  if (o.inspectorName.trim()) {
    const inspName = ws.getCell(33, 8);
    inspName.value = o.inspectorName.trim().toUpperCase();
    inspName.font = font(11, true);
  }

  const buf = await wb.xlsx.writeBuffer();
  saveBlob(
    new Blob([buf], { type: XLSX_MIME }),
    `fiche-pda-${slugFile(o.className)}-eval${o.examNumber}.xlsx`,
  );
}

export function PdaDocument({
  examId,
  classId,
  onClose,
}: {
  examId: string;
  classId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["pda-summary", examId, classId],
    queryFn: () => pdaApi.getSummary(examId, classId),
  });

  // Task 23 — verrou d'impression : consultation à l'écran ouverte aux
  // rôles autorisés par le backend, mais la zone « Imprimer / PDF » est
  // GRISÉE (l'impression reste réservée à l'Admin IEP et au Super Admin).
  const printRole = usePrintRole();
  const canPrint = canPrintDocument(printRole, false);

  // === Remédiation (lignes 2-3 du tableau 3) — dérivation + override ===
  // Valeurs serveur dérivées de la synthèse ; override = saisie locale en
  // cours (remis à null après sauvegarde — le serveur redevient la source).
  interface RemState {
    mise_a_niveau_total: number;
    mise_a_niveau_garcons: number;
    mise_a_niveau_filles: number;
    remediation_total: number;
    remediation_garcons: number;
    remediation_filles: number;
  }
  const serverRem: RemState = {
    mise_a_niveau_total: data?.table3.mise_a_niveau.total ?? 0,
    mise_a_niveau_garcons: data?.table3.mise_a_niveau.garcons ?? 0,
    mise_a_niveau_filles: data?.table3.mise_a_niveau.filles ?? 0,
    remediation_total: data?.table3.remediation.total ?? 0,
    remediation_garcons: data?.table3.remediation.garcons ?? 0,
    remediation_filles: data?.table3.remediation.filles ?? 0,
  };
  const [remOverride, setRemOverride] = useState<RemState | null>(null);
  const rem = remOverride ?? serverRem;
  const remDirty = remOverride !== null;
  // État des exports Word/Excel (DOIT rester avant les retours conditionnels
  // — règles des Hooks React).
  const [exporting, setExporting] = useState<"doc" | "xlsx" | null>(null);

  const remMutation = useMutation({
    mutationFn: () => pdaApi.saveRemediation(examId, { class_id: classId, ...rem }),
    onSuccess: () => {
      setRemOverride(null); // le serveur redevient la source de vérité
      queryClient.invalidateQueries({ queryKey: ["pda-summary", examId, classId] });
      toast.success("Remédiation enregistrée");
    },
    onError: (e) =>
      toast.error("Erreur", {
        description: e instanceof Error ? e.message : "Erreur inconnue",
      }),
  });

  const updateRem = (key: keyof RemState, value: string) => {
    const n = value.replace(/[^0-9]/g, "").slice(0, 3);
    setRemOverride({ ...rem, [key]: n === "" ? 0 : Number(n) });
  };

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

  const s: PdaSummary = data;
  const t2 = s.table2;
  const isComposition = s.exam.kind === "composition";
  // Libellés officiels selon le type d'évaluation suivie par le plan
  // (modèle reçu : « RESULTAT DE L'EXAMEN BLANC N° 2 »).
  const evalTitle = isComposition
    ? `RESULTAT DE LA COMPOSITION N° ${s.exam.number} — ${
        s.exam.session_month && s.exam.session_month >= 1 && s.exam.session_month <= 12
          ? `${monthLabel(s.exam.session_month).toUpperCase()} `
          : ""
      }${s.exam.year}`
    : `RESULTAT DE L'EXAMEN BLANC N° ${s.exam.number}`;
  const evalColHeader = isComposition
    ? `${ordinal(s.exam.number)} COMPOSITION`
    : `${ordinal(s.exam.number)} EXAMEN BLANC`;
  const toolbarTitle = isComposition
    ? `Composition N°${s.exam.number}${
        s.exam.session_month ? ` — ${monthLabel(s.exam.session_month)} ${s.exam.year}` : ""
      }`
    : `Examen Blanc N°${s.exam.number}`;

  // === 3 MODÈLES : données partagées Word/Excel (l'état local de
  //     remédiation est exporté tel qu'affiché) ===
  const exportData: PdaExportData = {
    examNumber: s.exam.number,
    evalTitle,
    evalColHeader,
    schoolName: s.school.name,
    className: s.class.name,
    iepRegion: s.iep?.region ?? "",
    iepName: s.iep?.name ?? "",
    iepBp: s.iep?.bp ?? "",
    iepPhone: s.iep?.inspector_phone ?? "",
    iepEmail: s.iep?.inspector_email ?? "",
    inspectorName: s.iep?.inspector_name ?? "",
    directeur: s.directeur ?? "",
    table1: s.table1,
    table2: s.table2,
    table3: s.table3,
    rem,
  };

  function handleWord() {
    setExporting("doc");
    try {
      saveWordDoc(
        buildPdaWordHtml(exportData),
        `fiche-pda-${slugFile(exportData.className)}-eval${exportData.examNumber}.doc`,
      );
    } finally {
      setExporting(null);
    }
  }

  async function handleExcel() {
    setExporting("xlsx");
    try {
      await exportPdaExcelAsync(exportData);
    } finally {
      setExporting(null);
    }
  }

  return (
    <div className="min-h-screen bg-gray-100 print:bg-white">
      {/* Barre d'outils (masquée à l'impression) */}
      <div className="sticky top-0 z-10 flex items-center justify-between bg-white border-b px-4 py-2 print:hidden">
        <h3 className="font-semibold text-sm">
          Plan d&apos;Action IEPP — {toolbarTitle} · {s.class.name}
        </h3>
        <div className="flex items-center gap-2">
          {remDirty && (
            <button
              onClick={() => remMutation.mutate()}
              disabled={remMutation.isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-700 text-white rounded-md text-sm hover:bg-emerald-600 disabled:opacity-60"
            >
              {remMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : null}
              Enregistrer la remédiation
            </button>
          )}
          {canPrint ? (
            <DocExportButtons
              canPrint
              exporting={exporting}
              onPdf={() => window.print()}
              onWord={handleWord}
              onExcel={handleExcel}
              formatHint="Format : A4 portrait"
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

      {/* === DOCUMENT OFFICIEL (isolement impression #pda-doc) === */}
      {!canPrint && <PrintLockDocumentMessage />}
      <div
        id="pda-doc"
        className={`bg-white mx-auto shadow-lg print:shadow-none ${canPrint ? "" : "print-locked"}`}
        style={{
          width: "100%",
          maxWidth: "210mm",
          minHeight: "275mm", // zone imprimable A4 (marges 8mm) — jamais 297 (2e page blanche)
          padding: "12mm 14mm",
          fontFamily: OFFICIAL_FONT,
          color: INK,
          overflowX: "auto",
          position: "relative", // filigrane armoiries DANS LE FOND
        }}
      >
        {/* (Ruban tricolore du haut RETIRÉ : aucune bordure drapeau sur
            les feuilles imprimables.) */}
        {/* --- ARMOIRIES DE LA CÔTE D'IVOIRE en filigrane (fond) --- */}
        <CIArmoiriesWatermark />
        <div style={{ position: "relative", zIndex: 1 }}>
        {/* --- En-tête institutionnel (modèle reçu : armoiries + devise) --- */}
        <OfficialDocHeader iep={s.iep} variant="fiche" size="lg" />

        {/* --- Bandeau du titre VERT DRAPEAU (texte blanc — inspiration
            bulletins individuels) + titre de l'évaluation souligné --- */}
        <div style={{ textAlign: "center", margin: "4px 0 10px" }}>
          <div
            style={{
              display: "inline-block",
              background: CI_GREEN,
              color: "#ffffff",
              padding: "8px 26px",
              fontSize: "15px",
              fontWeight: 700,
              lineHeight: 1.45,
              maxWidth: "150mm",
              ...PRINT_COLOR_STYLE,
            }}
          >
            SUIVI DU PLAN D&apos;ACTION PLURIANNUEL DE L&apos;IEPP
          </div>
          <div
            style={{
              fontSize: "14.5px",
              fontWeight: 700,
              textDecoration: "underline",
              marginTop: "10px",
              color: CI_GREEN_TEXT,
            }}
          >
            {evalTitle}
          </div>
        </div>

        {/* --- ECOLE / CLASSE en gras à gauche (modèle reçu) --- */}
        <div style={{ fontSize: "14px", fontWeight: 700, marginBottom: "8px", lineHeight: 1.7 }}>
          <div>ECOLE : {s.school.name}</div>
          <div>CLASSE : {s.class.name}</div>
        </div>

        {/* --- TABLEAU 1 : vue d'ensemble de l'évaluation --- */}
        <table style={{ width: "70%", borderCollapse: "collapse", marginBottom: "6px" }}>
          <thead>
            <tr>
              <th style={{ ...thStyle, border: "none", width: "26%" }} />
              <th style={{ ...thStyle, border: "none" }} colSpan={3}>
                {evalColHeader}
              </th>
            </tr>
            <tr>
              <th style={{ ...thStyle, border: "none", width: "26%" }} />
              <th style={thStyle}>TOTAL</th>
              <th style={thStyle}>FILLES</th>
              <th style={thStyle}>GARÇONS</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ ...tdStyle, border: "none" }}>PRESENTS</td>
              <CountCells row={s.table1.presents} order={["total", "filles", "garcons"]} />
            </tr>
            <tr>
              <td style={{ ...tdStyle, border: "none" }}>ADMIS</td>
              <CountCells row={s.table1.admis} order={["total", "filles", "garcons"]} />
            </tr>
            <tr>
              <td style={{ ...tdStyle, border: "none" }}>% ADMIS</td>
              <td style={tdStyle} colSpan={3}>
                {fmtPct(s.table1.pct_admis)}
              </td>
            </tr>
          </tbody>
        </table>

        <p style={{ fontSize: "12px", margin: "6px 0", lineHeight: 1.5 }}>
          Le nombre d&apos;élèves du {s.class.name} ayant atteint le seuil suffisant de
          maîtrise en lecture (Exploitation de texte, Mathématiques, Dictée ).
        </p>

        {/* --- TABLEAU 2 : maîtrise par matière --- */}
        <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "6px" }}>
          <thead>
            <tr>
              <th style={{ ...thStyle, border: "none", width: "17%" }} />
              {(["exploitation", "math", "dictee"] as const).map((k) => (
                <th key={k} style={{ ...thStyle, border: "none" }} colSpan={3}>
                  {k === "exploitation" ? "EXPLOITATION DE TEXTE" : k === "math" ? "MATHÉMATIQUES" : "DICTÉE"}
                </th>
              ))}
            </tr>
            <tr>
              <th style={{ ...thStyle, border: "none", width: "17%" }} />
              {(["exploitation", "math", "dictee"] as const).map((k) => (
                <Fragment key={k}>
                  <th style={thStyle}>TOTAL</th>
                  <th style={thStyle}>GARÇONS</th>
                  <th style={thStyle}>FILLES</th>
                </Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={labelTdStyle}>Présents</td>
              {(["exploitation", "math", "dictee"] as const).map((k) => (
                <CountCells key={`p-${k}`} row={t2[k].presents} order={["total", "garcons", "filles"]} />
              ))}
            </tr>
            <tr>
              <td style={labelTdStyle}>Admis</td>
              {(["exploitation", "math", "dictee"] as const).map((k) => (
                <CountCells key={`a-${k}`} row={t2[k].admis} order={["total", "garcons", "filles"]} />
              ))}
            </tr>
            <tr>
              <td style={labelTdStyle}>% Admis</td>
              {(["exploitation", "math", "dictee"] as const).map((k) => (
                <td key={`pa-${k}`} style={tdStyle} colSpan={3}>
                  {t2[k].presents.total > 0 ? fmtPct(t2[k].pct_admis) : ""}
                </td>
              ))}
            </tr>
            <tr>
              <td style={labelTdStyle}>Non Admis</td>
              {(["exploitation", "math", "dictee"] as const).map((k) => (
                <CountCells key={`na-${k}`} row={t2[k].non_admis} order={["total", "garcons", "filles"]} />
              ))}
            </tr>
            <tr>
              <td style={labelTdStyle}>% non admis</td>
              {(["exploitation", "math", "dictee"] as const).map((k) => (
                <td key={`pna-${k}`} style={tdStyle} colSpan={3}>
                  {t2[k].presents.total > 0 ? fmtPct(t2[k].pct_non_admis) : ""}
                </td>
              ))}
            </tr>
          </tbody>
        </table>

        <p style={{ fontSize: "12px", margin: "6px 0" }}>
          Accroître les acquis scolaires et la performance aux examens des élèves de
          tous les niveaux :
        </p>

        {/* --- TABLEAU 3 : difficultés + remédiation --- */}
        <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "14px" }}>
          <thead>
            <tr>
              <th style={{ ...thStyle, border: "none", width: "55%" }} />
              <th style={thStyle}>TOTAL</th>
              <th style={thStyle}>GARÇONS</th>
              <th style={thStyle}>FILLES</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={labelTdStyle}>
                Le nombre d&apos;élèves en difficultés d&apos;apprentissage
              </td>
              <CountCells row={s.table3.difficultes} order={["total", "garcons", "filles"]} />
            </tr>
            <tr>
              <td style={{ ...labelTdStyle, fontSize: "11px" }}>
                Le nombre d&apos;élèves ayant bénéficié des cours de mise à niveau
                (voir liste des élèves et les notes avant et après)
              </td>
              {(
                [
                  "mise_a_niveau_total",
                  "mise_a_niveau_garcons",
                  "mise_a_niveau_filles",
                ] as const
              ).map((k) => (
                <td key={k} style={{ ...tdStyle, padding: 0 }}>
                  <input
                    value={rem[k] ? fmtDocNum(rem[k]) : ""}
                    onChange={(e) => updateRem(k, e.target.value)}
                    inputMode="numeric"
                    aria-label={k}
                    className="w-full h-7 text-center text-[12px] bg-transparent outline-none focus:bg-amber-50 print:bg-white"
                  />
                </td>
              ))}
            </tr>
            <tr>
              <td style={{ ...labelTdStyle, fontSize: "11px" }}>
                Le nombre d&apos;élèves ayant bénéficié des mécanismes de remédiation
                par niveau et par matière.
              </td>
              {(
                [
                  "remediation_total",
                  "remediation_garcons",
                  "remediation_filles",
                ] as const
              ).map((k) => (
                <td key={k} style={{ ...tdStyle, padding: 0 }}>
                  <input
                    value={rem[k] ? fmtDocNum(rem[k]) : ""}
                    onChange={(e) => updateRem(k, e.target.value)}
                    inputMode="numeric"
                    aria-label={k}
                    className="w-full h-7 text-center text-[12px] bg-transparent outline-none focus:bg-amber-50 print:bg-white"
                  />
                </td>
              ))}
            </tr>
          </tbody>
        </table>

        {/* --- Signatures + nom de l'inspecteur (modèle reçu) — Task 37 :
                le NOM du directeur est inséré sous « Le Directeur », AU
                MÊME NIVEAU que le nom de l'inspecteur, en caractère
                d'imprimerie (majuscules). --- */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            fontSize: "13px",
            marginTop: "24px",
          }}
        >
          <div style={{ textAlign: "left" }}>
            <span style={{ textDecoration: "underline" }}>Le Directeur</span>
            {s.directeur ? (
              <div
                style={{
                  fontSize: "12px",
                  fontWeight: 700,
                  marginTop: "28px",
                  textTransform: "uppercase",
                  letterSpacing: "0.3px",
                }}
              >
                {s.directeur}
              </div>
            ) : null}
          </div>
          <div style={{ textAlign: "center" }}>
            <span style={{ textDecoration: "underline", color: CI_GREEN_TEXT }}>L&apos;Inspecteur</span>
            {s.iep?.inspector_name ? (
              <div
                style={{
                  fontSize: "12px",
                  fontWeight: 700,
                  marginTop: "28px",
                  textTransform: "uppercase",
                  letterSpacing: "0.3px",
                }}
              >
                {s.iep.inspector_name.toUpperCase()}
              </div>
            ) : null}
          </div>
        </div>
        </div>
        {/* (Ruban tricolore du bas RETIRÉ : aucune bordure drapeau sur les
            feuilles imprimables.) */}
      </div>

      <p className="text-center text-[11px] text-muted-foreground py-4 print:hidden">
        Architecture, en-tête et police (Calibri) du document officiel de
        l&apos;IEPP. Les lignes « mise à niveau » et « remédiation » sont
        saisissables directement dans le document — pensez à enregistrer avant
        impression.
        {!isComposition && s.exam.exam_date
          ? ` Passage : ${new Date(s.exam.exam_date).toLocaleDateString("fr-FR")}.`
          : ""}
        {isComposition
          ? ` Seuils de maîtrise (${s.exam.threshold} %) : ${s.subjects
              .map((sub) => `${sub.label} ${sub.seuil}/${sub.max_score || "—"}`)
              .join(" · ")}.`
          : ` Seuil de maîtrise : ${s.class.seuil}/${s.class.max_score} (${s.exam.threshold} %).`}
      </p>
    </div>
  );
}
