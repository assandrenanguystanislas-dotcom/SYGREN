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
//   - Tableau 20 colonnes du modèle : N° | Nom et prénoms | Matricule |
//     Date et lieu de naissance | IO IA IS IAS | Classe | Échelon |
//     Date entrée F.P | Fonction | Dates (Entrée DREN | Entrée IEP) |
//     Cours | Effectif (F|G|T) | Redoublants (F|G|T) | Contact |
//     Emargement — avec une ligne vide supplémentaire (le modèle) ;
//   - N° ordre ; noms des femmes EN ROUGE (N.B du modèle) ;
//   - Ligne TOTAL CALCULÉE : somme des effectifs et des redoublants
//     saisis (colonne sans aucune donnée → case vide, comme les « # »
//     du modèle) ;
//   - Signature « Le Directeur », N.B (RPL / MAC / MSC) et mention
//     « (A RETOURNER EN 03 EXEMPLAIRES) ».
//
// Données : /api/reports/personnel?school_id=… (source unique — le
// document ne recalcule rien de plus que les totaux affichés).
// Impression 100 % navigateur A4 paysage (route dédiée /personnel-doc,
// isolement #personnel-doc, lignes insécables).

import { useQuery } from "@tanstack/react-query";
import { Loader2, Printer, X } from "lucide-react";
import type { CSSProperties } from "react";

import { reportsApi } from "@/lib/api";
import {
  CLASSE_GRADE_LABELS,
} from "@/components/personnel-dossier-fields";
import { formatDossierDate, type PersonnelStaffRow } from "@/lib/types";

import {
  INK,
  OFFICIAL_FONT,
  OfficialDocHeader,
  THIN,
} from "./official-doc";

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

const th: CSSProperties = {
  border: THIN,
  padding: "2px 3px",
  fontSize: "9px",
  lineHeight: 1.2,
  fontWeight: 700, // entêtes en gras comme le modèle reçu
  textAlign: "center",
  verticalAlign: "middle",
  color: INK,
};

const td: CSSProperties = {
  border: THIN,
  padding: "1px 3px",
  fontSize: "9px",
  lineHeight: 1.25,
  textAlign: "center",
  verticalAlign: "middle",
  color: INK,
  height: "18px",
};

const tdLeft: React.CSSProperties = { ...td, textAlign: "left" };

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
  const totalEffF = sumCol(staff.map((s) => s.effectif_f));
  const totalEffG = sumCol(staff.map((s) => s.effectif_g));
  const totalEffT = sumCol(staff.map((s) => s.effectif_t));
  const totalRedF = sumCol(staff.map((s) => s.redoublant_f));
  const totalRedG = sumCol(staff.map((s) => s.redoublant_g));
  const totalRedT = sumCol(staff.map((s) => s.redoublant_t));

  return (
    <div className="min-h-screen bg-gray-100 print:bg-white">
      {/* Barre d'outils (masquée à l'impression) */}
      <div className="sticky top-0 z-10 flex items-center justify-between bg-white border-b px-4 py-2 print:hidden">
        <h3 className="font-semibold text-sm">
          État nominatif du personnel — {data.school.name} · {data.count}{" "}
          agent(s) · Année {data.annee_scolaire}
        </h3>
        <div className="flex items-center gap-2">
          <button
            onClick={() => window.print()}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-sm hover:opacity-90"
          >
            <Printer className="w-4 h-4" />
            Imprimer / PDF
          </button>
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
      <div
        id="personnel-doc"
        className="bg-white mx-auto shadow-lg print:shadow-none mt-3"
        style={{
          width: "100%",
          maxWidth: "297mm", // A4 paysage
          padding: "5mm 7mm",
          fontFamily: OFFICIAL_FONT,
          color: INK,
          overflowX: "auto",
        }}
      >
        {/* --- En-tête institutionnel (bloc ministériel + République + armoiries) --- */}
        <OfficialDocHeader iep={data.iep} variant="plan" size="sm" />

        {/* --- Boîte du titre (bord arrondi, police à empattements — modèle) --- */}
        <div style={{ textAlign: "center", margin: "2px 0 6px" }}>
          <span
            style={{
              display: "inline-block",
              border: "2.2px solid #000000",
              borderRadius: "14px",
              padding: "6px 30px 7px",
              fontFamily:
                '"Cambria", "Caladea", Georgia, "Times New Roman", serif',
              fontSize: "19px",
              fontWeight: 700,
              letterSpacing: "1.5px",
              lineHeight: 1.25,
              color: INK,
              boxShadow: "2.5px 2.5px 0 #bfbfbf",
              textAlign: "center",
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
            fontSize: "11.5px",
            margin: "0 2px 3px",
            color: INK,
          }}
        >
          <span>Ecole: {data.school.name}</span>
          <span>
            Année scolaire: {data.annee_scolaire.split(" ")[0]}&nbsp;&nbsp;
            {data.annee_scolaire.split(" ")[1] ?? ""}
          </span>
        </div>

        {/* --- Tableau du modèle (20 colonnes) --- */}
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
            {[
              "3%", // N°
              "11.5%", // Nom et prénoms
              "6.5%", // Matricule
              "10%", // Date et lieu de naissance
              "3.6%", // IO IA IS IAS
              "3.8%", // Classe
              "4.4%", // Échelon
              "7%", // Date entrée F.P
              "6.8%", // Fonction
              "5.6%", // Entrée DREN
              "5.6%", // Entrée IEP
              "4.6%", // Cours
              "3.6%", // Effectif F
              "3.6%", // Effectif G
              "3.6%", // Effectif T
              "3.6%", // Redoublants F
              "3.6%", // Redoublants G
              "3.6%", // Redoublants T
              "6.7%", // Contact
              "7.3%", // Emargement
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
              <th style={th} rowSpan={2}>
                Classe
              </th>
              <th style={th} rowSpan={2}>
                Échelon
              </th>
              <th style={th} rowSpan={2}>
                Date entrée F.P
              </th>
              <th style={th} rowSpan={2}>
                Fonction
              </th>
              <th style={th} colSpan={2}>
                Dates
              </th>
              <th style={th} rowSpan={2}>
                Cours
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
              <th style={th}>F</th>
              <th style={th}>G</th>
              <th style={th}>T</th>
              <th style={th}>F</th>
              <th style={th}>G</th>
              <th style={th}>T</th>
            </tr>
          </thead>
          <tbody>
            {/* Une ligne par agent — directeur d'abord, puis cours CP1→CM2
                (tri serveur). Noms des femmes EN ROUGE (N.B du modèle). */}
            {staff.map((s, i) => (
              <StaffRow key={s.id} s={s} n={i + 1} />
            ))}
            {/* Ligne supplémentaire vierge (le modèle garde une ligne libre) */}
            <tr>
              <td style={td}>{staff.length + 1}</td>
              <td style={tdLeft}>&nbsp;</td>
              {Array.from({ length: 18 }, (_, k) => (
                <td key={k} style={td}>
                  &nbsp;
                </td>
              ))}
            </tr>
            {/* --- Ligne TOTAL (calculée, fond gris, gras — modèle) --- */}
            <tr>
              <td colSpan={9} style={{ border: "none", padding: 0 }} />
              <td
                colSpan={2}
                style={{
                  ...th,
                  background: "#d9d9d9",
                  fontSize: "10px",
                }}
              >
                TOTAL
              </td>
              <td style={{ border: "none", padding: 0 }} />
              <td style={{ ...td, background: "#d9d9d9", fontWeight: 700 }}>
                {fmtNum(totalEffF)}
              </td>
              <td style={{ ...td, background: "#d9d9d9", fontWeight: 700 }}>
                {fmtNum(totalEffG)}
              </td>
              <td style={{ ...td, background: "#d9d9d9", fontWeight: 700 }}>
                {fmtNum(totalEffT)}
              </td>
              <td style={{ ...td, background: "#d9d9d9", fontWeight: 700 }}>
                {fmtNum(totalRedF)}
              </td>
              <td style={{ ...td, background: "#d9d9d9", fontWeight: 700 }}>
                {fmtNum(totalRedG)}
              </td>
              <td style={{ ...td, background: "#d9d9d9", fontWeight: 700 }}>
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
          <div
            style={{
              fontSize: "11.5px",
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
              fontSize: "12.5px",
              fontWeight: 700,
              margin: "8px 0 0 18%",
              letterSpacing: "0.4px",
            }}
          >
            (A RETOURNER EN <u>03 EXEMPLAIRES</u>&nbsp;)
          </div>
        </div>
      </div>
    </div>
  );
}

/** Une ligne agent du tableau (20 cellules). */
function StaffRow({ s, n }: { s: PersonnelStaffRow; n: number }) {
  const isWoman = s.sexe === "F";
  const birth = formatDossierDate(s.date_naissance);
  const birthCell = birth
    ? s.lieu_naissance
      ? `${birth} à ${s.lieu_naissance}`
      : birth
    : (s.lieu_naissance ?? "");
  return (
    <tr>
      <td style={td}>{n}</td>
      <td
        style={{
          ...tdLeft,
          fontWeight: 600,
          color: isWoman ? "#e00000" : INK, // « écrire le nom des femmes en rouge »
        }}
      >
        {s.full_name}
      </td>
      <td style={td}>{s.matricule ?? ""}</td>
      <td style={tdLeft}>{birthCell}</td>
      <td style={td}>{s.categorie ?? ""}</td>
      <td style={td}>
        {/* CLASSE : notation administrative courte — 1 · 2 · E
            (Exceptionnelle) · P (Principale) — mêmes items que la
            liste déroulante du dossier personnel. */}
        {s.classe_grade != null
          ? (CLASSE_GRADE_LABELS[s.classe_grade] ?? String(s.classe_grade))
          : ""}
      </td>
      <td style={td}>{s.echelon ?? ""}</td>
      <td style={td}>{formatDossierDate(s.date_entree_fp)}</td>
      <td style={td}>{s.fonction ?? ""}</td>
      <td style={td}>{formatDossierDate(s.date_entree_dren)}</td>
      <td style={td}>{formatDossierDate(s.date_entree_iep)}</td>
      <td style={td}>{s.class_name ?? ""}</td>
      <td style={td}>{fmtNum(s.effectif_f)}</td>
      <td style={td}>{fmtNum(s.effectif_g)}</td>
      <td style={td}>{fmtNum(s.effectif_t)}</td>
      <td style={td}>{fmtNum(s.redoublant_f)}</td>
      <td style={td}>{fmtNum(s.redoublant_g)}</td>
      <td style={td}>{fmtNum(s.redoublant_t)}</td>
      <td style={tdLeft}>{s.phone ?? ""}</td>
      <td style={td}>&nbsp;</td>
    </tr>
  );
}
