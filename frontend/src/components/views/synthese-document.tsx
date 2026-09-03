"use client";

// v3 — EMBELLISSEMENT DRAPEAU CI (inspiré des bulletins individuels) :
// l'ancien BLEU MARINE cède la place aux couleurs du drapeau ivoirien —
// entêtes du tableau sur FOND VERT DRAPEAU (texte blanc), bordures
// vertes, labels en vert foncé, boîte du titre sur fond pastel orange
// bordé de vert ; les armoiries (filigrane) et les rubans tricolores
// haut/bas sont conservés.
import { useQuery } from "@tanstack/react-query";
import { Printer, X, Loader2 } from "lucide-react";
import { reportsApi } from "@/lib/api";
import { monthLabel } from "@/lib/session-utils";
import { CIArmoiriesWatermark, CIFlagRibbon, CI_GREEN, CI_GREEN_BG, CI_GREEN_TEXT, CI_ORANGE_BG, PRINT_COLOR_STYLE } from "@/components/ci-decor";
import { canPrintDocument, PrintLockBadge, PrintLockDocumentMessage, usePrintRole } from "@/lib/print-guard";

interface LevelData {
  class_name: string;
  inscrits: [number, number, number];
  presents: [number, number, number];
  admis: [number, number, number];
  pct_admis: [number, number, number];
}
interface Totals {
  inscrits_g: number; inscrits_f: number; inscrits_t: number;
  presents_g: number; presents_f: number; presents_t: number;
  admis_g: number; admis_f: number; admis_t: number;
  pct_g: number; pct_f: number; pct_t: number;
}
interface SyntheseData {
  iep_name: string;
  iep_region: string;
  school_name: string;
  school_code: string;
  school_addr: string;
  eval_label: string;
  eval_number: number;
  month: number;
  year: number;
  levels: LevelData[];
  totals: Totals;
  // Transmis par le backend pour adapter le titre + le rendu.
  level_group: "primary" | "cm2" | "all";
  document_label: string;
  // === Infos pour les signatures et l'en-tête ===
  director_name: string;
  inspector_name: string;
  inspector_email: string;
  inspector_phone: string;
  iep_bp: string;
}

// FIX BUG #1 : CM2 était absent → le tableau ne montrait que 5 classes au lieu de 6.
// Les 6 niveaux de l'école primaire ivoirienne : CP1, CP2, CE1, CE2, CM1, CM2.
//
// === Séparation en 2 documents (cahier des charges) ===
// Le document de synthèse est désormais scindé en deux :
//   1. Document principal (level_group=primary) → CP1 au CM1 (5 classes)
//   2. Document CM2 dédié (level_group=cm2) → CM2 seul (fin de cycle primaire)
// CLASS_NAMES est maintenant DYNAMIQUE : il se base sur la réponse du backend
// (data.levels) plutôt que sur une constante codée en dur.
const ALL_CLASS_NAMES = ["CP1", "CP2", "CE1", "CE2", "CM1", "CM2"] as const;
/** Vert assombri pour les libellés (contraste à l'impression). */
const LABEL_GREEN = CI_GREEN_TEXT;
/** Encre des données (noir pur, lisible à l'impression). */
const INK_DOC = "#000000";

export function SyntheseDocument({
  sessionId,
  levelGroup = "primary",
  onClose,
}: {
  sessionId: string;
  levelGroup?: "primary" | "cm2" | "all";
  onClose: () => void;
}) {
  // v2 — VERROU D'IMPRESSION : Admin IEP + Super Admin uniquement
  // (le directeur consulte l'aperçu à l'écran, sans impression).
  const role = usePrintRole();
  const canPrint = canPrintDocument(role, false);
  const { data, isLoading, error } = useQuery({
    queryKey: ["synthese-data", sessionId, levelGroup],
    queryFn: () => reportsApi.getSyntheseData(sessionId, levelGroup),
  });

  if (isLoading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
        <Loader2 className="w-8 h-8 animate-spin text-white" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
        <div className="bg-white rounded-lg p-6 max-w-md">
          <p className="text-red-600">Erreur : {(error as Error)?.message}</p>
          <button onClick={onClose} className="mt-4 px-4 py-2 bg-gray-200 rounded">Fermer</button>
        </div>
      </div>
    );
  }

  const fmt = (v: number) => v > 0 ? String(v) : "—";
  const fmtPct = (v: number) => v > 0 ? (Math.round(v * 100) / 100).toString() : "—";

  // CLASS_NAMES dynamique : dérivé de la réponse du backend (data.levels).
  // On garde l'ordre canonique (CP1, CP2, CE1, CE2, CM1, CM2) même si le
  // backend renvoie un sous-ensemble (ex: CM2 seul pour le doc dédié).
  const CLASS_NAMES = ALL_CLASS_NAMES.filter((cn) =>
    data.levels.some((l) => l.class_name === cn),
  );
  // Nombre total de colonnes : 1 (label) + N classes × 3 (G/F/T).
  const TOTAL_COLS = 1 + CLASS_NAMES.length * 3;

  // Helper pour trouver un niveau par nom de classe
  const getLevel = (name: string): LevelData => {
    return data.levels.find((l) => l.class_name === name) || {
      class_name: name, inscrits: [0, 0, 0], presents: [0, 0, 0], admis: [0, 0, 0], pct_admis: [0, 0, 0],
    };
  };

  // Pré-calculer les données pour chaque classe (évite les lookups répétés)
  const classLevels = CLASS_NAMES.map(getLevel);

  // Styles communs — COULEURS DU DRAPEAU ivoirien (inspiration bulletins)
  const headerStyle: React.CSSProperties = {
    border: `1px solid ${CI_GREEN}`,
    background: CI_GREEN,
    color: "white",
    padding: "4px",
    textAlign: "center",
    fontSize: "10px",
    ...PRINT_COLOR_STYLE,
  };
  const labelCellStyle: React.CSSProperties = {
    border: `1px solid ${CI_GREEN}`,
    padding: "6px 8px",
    background: CI_ORANGE_BG,
    fontWeight: "bold",
    color: LABEL_GREEN,
    ...PRINT_COLOR_STYLE,
  };

  // FIX BUG #2 : les valeurs G/F/T étaient brouillées dans le rendu.
  // Cause : le composant RowCells utilisait un Fragment (<>...</>) pour rendre
  // 3 cellules <td>, ce qui causait un bug de réordonnancement dans le DOM —
  // les cellules étaient rendues colonne par colonne (tous les G, puis tous
  // les F, puis tous les T) au lieu d'être groupées par classe.
  // Solution : rendre les <td> directement via flatMap (pas de sous-composant,
  // pas de Fragment). Chaque cellule a une key unique et explicite.
  const renderDataRow = (
    rowType: "inscrits" | "presents" | "admis" | "pct_admis",
  ): React.ReactNode[] => {
    const isPct = rowType === "pct_admis";
    const fmtFn = isPct ? fmtPct : fmt;
    return CLASS_NAMES.flatMap((cn, ci) => {
      const lvl = classLevels[ci];
      const vals = lvl[rowType];
      const cellStyle: React.CSSProperties = {
        border: `1px solid ${CI_GREEN}`,
        padding: "6px",
        textAlign: "center",
        background: ci % 2 === 0 ? CI_GREEN_BG : "transparent",
        ...PRINT_COLOR_STYLE,
      };
      return [
        <td key={`${rowType}-${cn}-G`} style={cellStyle}>{fmtFn(vals[0])}</td>,
        <td key={`${rowType}-${cn}-F`} style={cellStyle}>{fmtFn(vals[1])}</td>,
        <td key={`${rowType}-${cn}-T`} style={cellStyle}>{fmtFn(vals[2])}</td>,
      ];
    });
  };

  // Sous-en-têtes G/F/T pour chaque classe (même technique : flatMap)
  const subHeaders: React.ReactNode[] = CLASS_NAMES.flatMap((cn) => [
    <th key={`${cn}-G`} style={headerStyle}>G</th>,
    <th key={`${cn}-F`} style={headerStyle}>F</th>,
    <th key={`${cn}-T`} style={headerStyle}>T</th>,
  ]);

  return (
    <div className="min-h-screen bg-gray-100 print:bg-white">
      {/* Barre d'outils */}
      <div className="sticky top-0 z-10 flex items-center justify-between bg-white border-b px-4 py-2 print:hidden">
        <h3 className="font-semibold text-sm">Document de Synthèse — Aperçu</h3>
        <div className="flex items-center gap-2">
          {canPrint ? (
            <button
              onClick={() => window.print()}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-900 text-white rounded-md text-sm hover:bg-blue-800"
            >
              <Printer className="w-4 h-4" />
              Imprimer / PDF
            </button>
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

      {/* === DOCUMENT === */}
      {!canPrint && <PrintLockDocumentMessage />}
      <div
        id="synthese-doc"
        className={`bg-white mx-auto shadow-lg print:shadow-none print:p-0 ${canPrint ? "" : "print-locked"}`}
        style={{
          width: "100%",
          maxWidth: "297mm",
          minHeight: "210mm",
          padding: "20px",
          fontFamily: "Helvetica, Arial, sans-serif",
          color: INK_DOC,
          overflowX: "auto",
          position: "relative", // filigrane armoiries DANS LE FOND
        }}
      >
        {/* v2 — décor drapeau CI : armoiries en filigrane (répétées
            sur chaque page imprimée) + rubans tricolores haut/bas */}
        <CIArmoiriesWatermark fixed />
        <div style={{ position: "fixed", top: 0, left: 0, right: 0 }}>
          <CIFlagRibbon height="2.4mm" bordered={false} />
        </div>
        <div style={{ position: "fixed", bottom: 0, left: 0, right: 0 }}>
          <CIFlagRibbon height="2.4mm" bordered={false} />
        </div>
        <div style={{ position: "relative", zIndex: 1 }}>
        {/* En-tête */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "8px" }}>
          <div style={{ fontSize: "10px", fontWeight: "bold", lineHeight: "1.5", textAlign: "left" }}>
            <div>République de Côte d&apos;Ivoire</div>
            <div>Ministère de l&apos;Éducation Nationale</div>
            <div>Et de l&apos;Alphabétisation</div>
            <div>Direction Régionale de {data.iep_region}</div>
            <div>Inspection de l&apos;Enseignement</div>
            <div>Préscolaire et Primaire de {data.iep_name}</div>
            {/* BP / Tel : alimentés par les champs de l'IEP (formulaire Inspections).
                Si vide, placeholder points pour préserver la mise en page. */}
            <div>BP : {data.iep_bp || "........."} / Tél : {data.inspector_phone || "............"}</div>
          </div>
          <div style={{ fontSize: "10px", fontWeight: "bold", textAlign: "right" }}>
            <div style={{ marginBottom: "4px" }}>Union - Discipline - Travail</div>
            <img
              src="/ci-coat-of-arms.png"
              alt="Armoiries Côte d'Ivoire"
              style={{ width: "60px", height: "60px", objectFit: "contain", marginLeft: "auto" }}
            />
            <div style={{ marginTop: "4px" }}>ÉCOLE : {data.school_name}</div>
          </div>
        </div>

        {/* Trait */}
        <hr style={{ borderColor: CI_GREEN, borderWidth: "1.5px", margin: "8px 0 12px 0" }} />

        {/* Titre — boîte bordée de VERT DRAPEAU sur fond pastel orange
            (inspiration bulletins individuels) */}
        <div style={{ display: "flex", justifyContent: "center", marginBottom: "16px" }}>
          <div style={{
            border: `2.2px solid ${CI_GREEN}`,
            borderRadius: "10px",
            padding: "5px 48px 6px",
            textAlign: "center",
            background: CI_ORANGE_BG,
            boxShadow: `2.5px 2.5px 0 ${CI_GREEN_BG}`,
            ...PRINT_COLOR_STYLE,
          }}>
            <div style={{ fontSize: "16px", fontWeight: "bold", letterSpacing: "1px", color: INK_DOC }}>
              SYNTHÈSE DES RESULTATS
            </div>
            <div style={{ fontSize: "12px", fontWeight: "bold", marginTop: "2px", color: LABEL_GREEN }}>
              {data.eval_label.toUpperCase()} N°{data.eval_number} DU MOIS DE {monthLabel(data.month).toUpperCase()} {data.year}
            </div>
            {/* Périmètre du document (CP1 au CM1 / CM2 / etc.) — permet de
                différencier visuellement les 2 versions de synthèse. */}
            <div style={{ fontSize: "10px", fontStyle: "italic", marginTop: "2px", opacity: 0.85, color: INK_DOC }}>
              {data.document_label}
            </div>
          </div>
        </div>

        {/* Tableau de synthèse — 6 classes (CP1-CM2) × 3 colonnes (G/F/T) + 1 label = 19 colonnes */}
        <table style={{
          width: "100%",
          borderCollapse: "collapse",
          border: `2px solid ${CI_GREEN}`,
          color: INK_DOC,
          fontSize: "10px",
          fontWeight: "bold",
        }}>
          <thead>
            {/* Ligne 1 : noms des classes (colSpan=3 pour chacune) */}
            <tr>
              <th style={{ ...headerStyle, width: "5%" }}></th>
              {CLASS_NAMES.map((cn) => (
                <th key={cn} colSpan={3} style={{ ...headerStyle, padding: "6px" }}>
                  {cn}
                </th>
              ))}
            </tr>
            {/* Ligne 2 : sous-en-têtes G/F/T pour chaque classe */}
            <tr>
              <th style={headerStyle}></th>
              {subHeaders}
            </tr>
          </thead>
          <tbody>
            {/* Ligne INSCRITS */}
            <tr>
              <td style={labelCellStyle}>INSCRITS</td>
              {renderDataRow("inscrits")}
            </tr>
            {/* Ligne PRÉSENTS */}
            <tr>
              <td style={labelCellStyle}>PRÉSENTS</td>
              {renderDataRow("presents")}
            </tr>
            {/* Ligne ADMIS */}
            <tr>
              <td style={labelCellStyle}>ADMIS</td>
              {renderDataRow("admis")}
            </tr>
            {/* Ligne % ADMIS */}
            <tr>
              <td style={labelCellStyle}>% ADMIS</td>
              {renderDataRow("pct_admis")}
            </tr>
            {/* FIX BUG #3 : colSpan étaient codés en dur (8+8=16) pour 5 classes.
                Avec 6 classes, le total est 19 colonnes. On utilise TOTAL_COLS. */}
            <tr>
              <td colSpan={Math.floor(TOTAL_COLS / 2)} style={{ border: `1px solid ${CI_GREEN}`, padding: "8px", textAlign: "center", fontSize: "12px", background: CI_GREEN_BG, color: LABEL_GREEN, ...PRINT_COLOR_STYLE }}>
                FILLES : {fmtPct(data.totals.pct_f)} %
              </td>
              <td colSpan={TOTAL_COLS - Math.floor(TOTAL_COLS / 2)} style={{ border: `1px solid ${CI_GREEN}`, padding: "8px", textAlign: "center", fontSize: "12px", background: CI_GREEN_BG, color: LABEL_GREEN, ...PRINT_COLOR_STYLE }}>
                GARÇONS : {fmtPct(data.totals.pct_g)} %
              </td>
            </tr>
            <tr>
              <td colSpan={TOTAL_COLS} style={{ border: `1px solid ${CI_GREEN}`, padding: "10px", textAlign: "center", fontSize: "14px", background: CI_ORANGE_BG, fontWeight: "bold", color: INK_DOC, ...PRINT_COLOR_STYLE }}>
                {fmtPct(data.totals.pct_t)} %
              </td>
            </tr>
          </tbody>
        </table>

        {/* Signatures : nom du directeur (depuis User role=director) remplace
            le nom de l'école. Nom de l'inspecteur ajouté (depuis IEP.inspector_name). */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: "40px" }}>
          <div style={{ textAlign: "center", width: "40%" }}>
            <div style={{ fontSize: "12px", fontWeight: "bold", textDecoration: "underline" }}>Le Directeur</div>
            <div style={{ height: "60px" }}></div>
            {/* Nom du directeur de l'école (User role=director, school_id).
                Placeholder si aucun directeur affecté. */}
            <div style={{ fontSize: "11px", fontWeight: "bold", textTransform: "uppercase" }}>
              {data.director_name || "................................"}
            </div>
          </div>
          <div style={{ textAlign: "right", width: "40%" }}>
            <div style={{ fontSize: "11px", marginBottom: "20px" }}>
              Fait à {data.iep_region}, le ...../...../.....
            </div>
            <div style={{ fontSize: "12px", fontWeight: "bold", textDecoration: "underline" }}>
              L&apos;Inspecteur
            </div>
            <div style={{ height: "40px" }}></div>
            {/* Nom de l'inspecteur titulaire de l'IEP (IEP.inspector_name).
                Placeholder si non renseigné. */}
            <div style={{ fontSize: "11px", fontWeight: "bold", textTransform: "uppercase" }}>
              {data.inspector_name || "................................"}
            </div>
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}
