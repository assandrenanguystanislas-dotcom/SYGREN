"use client";

// === Infrastructure partagée des 3 MODÈLES D'IMPRESSION (demande
// utilisateur : « étendre les 3 modèles PDF / Word / Excel à tous les
// documents à imprimer, en respectant les en-têtes d'origine ») ===
//
// PDF   : impression navigateur (window.print) — chaque document garde
//         son `@media print` + route dédiée (innacngé).
// WORD  : fichier .doc HTML MSO (Word ouvre le HTML et le pagine
//         naturellement) — @page WordSection1 A4 portrait ou paysage,
//         thead répété via display:table-header-group.
// EXCEL : classeur .xlsx généré par exceljs (import dynamique — déjà une
//         dépendance de la LISTE DES CANDIDATS) avec en-tête institutionnel
//         fusionné, mise en page d'impression et signature.
//
// Chaque document reste MAÎTRE de sa mise en forme : il fournit le corps
// HTML (en-tête institutionnel fidèle au modèle PDF + tableau + signatures)
// ; cette lib fournit l'enveloppe .doc, les utilitaires de téléchargement
// et la barre de boutons uniforme (PDF / Word / Excel).

import { FileSpreadsheet, FileText, Loader2, Printer } from "lucide-react";

/** Échappe le texte pour un fragment HTML (fichiers .doc). */
export function escHtml(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Nom de fichier sûr : « État nominatif 2026 » → « etat-nominatif-2026 ». */
export function slugFile(s: string): string {
  return s
    .trim()
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

/** Déclenche le téléchargement d'un Blob côté navigateur. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** MIME du classeur .xlsx. */
export const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Armoiries en base64 (meilleur effort — omises si indisponibles). */
export async function armoiriesBase64(): Promise<string> {
  try {
    const res = await fetch("/ci-coat-of-arms.png");
    if (!res.ok) return "";
    const bytes = new Uint8Array(await res.arrayBuffer());
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return `data:image/png;base64,${btoa(bin)}`;
  } catch {
    return "";
  }
}

/** Enveloppe WORD (.doc) — HTML MSO A4 (portrait ou paysage) : @page
 *  WordSection1 + police + styles du document. Le corps fourni contient
 *  l'en-tête institutionnel (fidèle au modèle PDF), le contenu et les
 *  signatures ; Word pagine naturellement (thead répété si le document
 *  pose display:table-header-group sur son thead). */
export function buildWordShell(o: {
  title: string;
  orientation: "portrait" | "landscape";
  /** Marge de page en mm (8 par défaut, comme les routes d'impression). */
  marginMm?: number;
  /** Styles CSS additionnels du document (mêmes classes que le PDF). */
  styles?: string;
  /** Corps HTML complet (en-tête + contenu + signatures). */
  bodyHtml: string;
}): string {
  const size =
    o.orientation === "landscape" ? "297mm 210mm" : "210mm 297mm";
  const orientProp =
    o.orientation === "landscape" ? "mso-page-orientation:landscape;" : "";
  return `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=utf-8">
<title>${escHtml(o.title)}</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->
<style>
@page WordSection1 { size:${size}; margin:${o.marginMm ?? 8}mm; ${orientProp} }
div.WordSection1 { page:WordSection1; }
body { font-family:Arial,Helvetica,sans-serif; font-size:12px; color:#000; }
p { margin:0; }
${o.styles ?? ""}
</style>
</head>
<body>
<div class=WordSection1>
${o.bodyHtml}
</div>
</body>
</html>`;
}

/** Enregistre un document Word (.doc HTML MSO) — BOM utf-8 requis pour
 *  que Word reconnaisse les accents. */
export function saveWordDoc(html: string, filename: string): void {
  saveBlob(
    new Blob(["\ufeff", html], { type: "application/msword;charset=utf-8" }),
    filename,
  );
}

/** Barre de boutons d'impression uniforme des documents officiels :
 *  PDF (impression navigateur), Word (.doc), Excel (.xlsx). */
export function DocExportButtons({
  canPrint,
  exporting,
  onPdf,
  onWord,
  onExcel,
  formatHint,
}: {
  canPrint: boolean;
  exporting: "doc" | "xlsx" | null;
  onPdf: () => void;
  onWord: () => void;
  onExcel: () => void;
  formatHint?: string;
}) {
  if (!canPrint) return null;
  return (
    <>
      {formatHint ? (
        <span className="hidden sm:inline text-xs text-muted-foreground mr-1">
          {formatHint}
        </span>
      ) : null}
      <button
        onClick={onPdf}
        title="Imprimer ou enregistrer en PDF (boîte d'impression du navigateur)"
        className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-sm hover:opacity-90"
      >
        <Printer className="w-4 h-4" />
        PDF
      </button>
      <button
        onClick={onWord}
        disabled={exporting !== null}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-md text-sm hover:opacity-90 disabled:opacity-50"
      >
        {exporting === "doc" ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <FileText className="w-4 h-4" />
        )}
        Word
      </button>
      <button
        onClick={onExcel}
        disabled={exporting !== null}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white rounded-md text-sm hover:opacity-90 disabled:opacity-50"
      >
        {exporting === "xlsx" ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <FileSpreadsheet className="w-4 h-4" />
        )}
        Excel
      </button>
    </>
  );
}
