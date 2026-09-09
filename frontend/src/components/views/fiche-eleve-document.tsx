"use client";

// === Document officiel « FICHE D'INSCRIPTION DE L'ÉLÈVE » (module Élèves) ===
//
// Demande utilisateur : « le document doit être disposé en PAYSAGE pour
// prendre en compte tous les détails » — c'est CE document (et non le
// « RESULTATS DE FIN D'ANNEE », resté inchangé) qui doit apparaître dans
// le module Élèves : le bouton « Fiche » de chaque ligne d'élève ouvre la
// fiche dans un nouvel onglet.
//
//   - A4 PAYSAGE (route dédiée /fiche-eleve-doc — zéro PDF serveur,
//     impression 100 % navigateur, discipline du projet) ;
//   - En-tête institutionnel identique aux autres documents officiels
//     (bloc ministériel, Direction Régionale, Inspection Préscolaire et
//     Primaire, BP/Tél, Courriel, République de Côte d'Ivoire,
//     Union-Discipline-Travail, armoiries en filigrane) ;
//   - Identité civile COMPLÈTE de l'élève en tableau libellé/valeur :
//     Matricule, Sexe, Nom, Prénoms, Jour/Mois/Année de naissance,
//     Lieu de naissance, Nationalité, Père, Mère, N° de l'acte de
//     naissance, Lieu de l'acte, Scolarité dans le cours, Scolarité
//     totale. Champ non renseigné = pointillés « ………… » (la fiche reste
//     imprimable vierge pour une inscription à compléter à la main) ;
//   - Bloc signature « Le Directeur » (nom du directeur actif de
//     l'école) + « Fait à …… Le ……/……/…… » ;
//   - Verrou d'impression identique aux autres documents (Admin IEP et
//     Super Admin impriment ; le directeur et l'enseignant consultent
//     la fiche à l'écran — print-guard.tsx).

import { useQuery } from "@tanstack/react-query";
import { Loader2, Printer, X } from "lucide-react";
import type { CSSProperties } from "react";

import { studentsApi } from "@/lib/api";
import type { StudentWithClass } from "@/lib/types";

import { INK, OFFICIAL_FONT } from "./official-doc";
import {
  CIArmoiriesWatermark,
  CI_GREEN,
  CI_GREEN_TEXT,
  CI_ORANGE_BG,
  PRINT_COLOR_STYLE,
} from "@/components/ci-decor";
import {
  canPrintDocument,
  PrintLockBadge,
  PrintLockDocumentMessage,
  usePrintRole,
} from "@/lib/print-guard";

/** Mois en français (index 1..12 — aligné sur birth_month). */
const MOIS_FR = [
  "",
  "Janvier",
  "Février",
  "Mars",
  "Avril",
  "Mai",
  "Juin",
  "Juillet",
  "Août",
  "Septembre",
  "Octobre",
  "Novembre",
  "Décembre",
];

/** Date du jour au format jj/mm/aaaa (rendu identique serveur/client). */
function todayFr(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** Valeur d'identité civile : champ non renseigné = pointillés (la fiche
 *  vierge reste imprimable pour une saisie manuelle, comme le modèle
 *  papier). */
function civilOrDots(v: string | number | null | undefined): string {
  const s = v == null ? "" : String(v).trim();
  return s || "…………………";
}

/** Sexe en clair (M → Masculin, F → Féminin). */
function genderFr(g: string | null | undefined): string {
  const s = (g ?? "").trim().toUpperCase();
  if (s === "M") return "Masculin";
  if (s === "F") return "Féminin";
  return "…………………";
}

/** Mois de naissance en français (1..12). */
function monthFr(m: number | null | undefined): string {
  if (m == null || m < 1 || m > 12) return "…………………";
  return MOIS_FR[m];
}

/** Prénoms « en minuscule » : initiale en majuscule, lettres suivantes en
 *  minuscules (segments séparés par espace, tiret ou apostrophe). */
function titleCasePrenoms(s: string): string {
  return s
    .toLowerCase()
    .replace(/(^|[\s'\-])(\p{L})/gu, (_, sep: string, c: string) => sep + c.toUpperCase());
}

// Cellules du tableau d'identité (bordures vert drapeau, cohérence
// visuelle avec les autres documents officiels).
const labelTd: CSSProperties = {
  border: `1px solid ${CI_GREEN}`,
  padding: "6px 10px",
  fontSize: "11px",
  fontWeight: 700,
  lineHeight: 1.3,
  color: "#ffffff",
  background: CI_GREEN,
  textAlign: "left",
  verticalAlign: "middle",
  width: "15%",
  ...PRINT_COLOR_STYLE,
};

const valueTd: CSSProperties = {
  border: `1px solid ${CI_GREEN}`,
  padding: "6px 10px",
  fontSize: "12.5px",
  lineHeight: 1.3,
  color: INK,
  textAlign: "left",
  verticalAlign: "middle",
  background: "#ffffff",
  ...PRINT_COLOR_STYLE,
};

export function FicheEleveDocument({
  studentId,
  onClose,
}: {
  studentId: string;
  onClose: () => void;
}) {
  const role = usePrintRole();
  const canPrint = canPrintDocument(role, false);
  const { data, isLoading, error } = useQuery({
    queryKey: ["fiche-eleve", studentId],
    queryFn: () => studentsApi.get(studentId),
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-2">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Chargement de la fiche…</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-destructive mb-3">
            Impossible de charger la fiche de l&apos;élève
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

  const st: StudentWithClass = data.student;
  const iep = data.iep;
  const nom = (st.last_name ?? "").trim().toUpperCase();
  const prenoms = (st.first_name ?? "").trim()
    ? titleCasePrenoms(st.first_name ?? "")
    : "";

  return (
    <div className="min-h-screen bg-gray-100 print:bg-white">
      {/* Barre d'outils (masquée à l'impression) */}
      <div className="sticky top-0 z-10 flex items-center justify-between bg-white border-b px-4 py-2 print:hidden">
        <h3 className="font-semibold text-sm">
          Fiche d&apos;inscription — {nom} {prenoms} · {st.class_name ?? "—"}
        </h3>
        <div className="flex items-center gap-2">
          <span className="hidden sm:inline text-xs text-muted-foreground mr-1">
            Format : A4 paysage
          </span>
          {canPrint ? (
            <button
              onClick={() => window.print()}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-sm hover:opacity-90"
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

      {/* === DOCUMENT OFFICIEL (isolement impression #fiche-eleve-doc) === */}
      {!canPrint && <PrintLockDocumentMessage />}
      <div
        id="fiche-eleve-doc"
        className={`bg-white mx-auto shadow-lg print:shadow-none mt-3 ${canPrint ? "" : "print-locked"}`}
        style={{
          width: "100%",
          maxWidth: "297mm", // A4 paysage
          padding: "8mm 9mm",
          fontFamily: OFFICIAL_FONT,
          color: INK,
          overflowX: "auto",
          position: "relative", // filigrane armoiries DANS LE FOND
        }}
      >
        {/* --- ARMOIRIES DE LA CÔTE D'IVOIRE en filigrane (fond) --- */}
        <CIArmoiriesWatermark fixed />
        <div style={{ position: "relative", zIndex: 1 }}>
          {/* --- En-tête institutionnel (identique aux autres documents) --- */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              marginBottom: "8px",
            }}
          >
            <div style={{ fontSize: "12px", color: INK, lineHeight: 1.35 }}>
              <div>Ministère de l&apos;Education Nationale</div>
              <div>de l&apos;Alphabétisation et de l&apos;Enseignement Technique</div>
              <div style={{ fontWeight: 600, marginTop: "2px" }}>
                Direction Régionale de {(iep?.region || "…………").toUpperCase()}
              </div>
              <div style={{ fontWeight: 700, marginTop: "2px" }}>
                Inspection de l&apos;Enseignement
              </div>
              <div style={{ fontWeight: 700 }}>
                Préscolaire et Primaire de {(iep?.name || "…………").toUpperCase()}
              </div>
              <div style={{ marginTop: "2px" }}>
                BP : {iep?.bp || "……"} / Tel : {iep?.inspector_phone || "…………"}
              </div>
              <div>
                Courriel :{" "}
                <span style={{ color: "#0563C1", textDecoration: "underline" }}>
                  {iep?.inspector_email || "…………"}
                </span>
              </div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: "12.5px", color: INK }}>
                République de Côte d&apos;Ivoire
              </div>
              <div style={{ fontSize: "12px", color: INK, padding: "1px 0" }}>
                Union-Discipline-Travail
              </div>
              <img
                src="/ci-coat-of-arms.png"
                alt="Armoiries de la République de Côte d'Ivoire"
                style={{ height: "52px", margin: "2px auto 0", display: "block" }}
              />
            </div>
          </div>

          {/* --- Boîte du titre (bord arrondi, cohérence visuelle) --- */}
          <div style={{ textAlign: "center", margin: "4px 0 8px" }}>
            <span
              style={{
                display: "inline-block",
                border: `2.2px solid ${CI_GREEN}`,
                background: CI_ORANGE_BG,
                borderRadius: "14px",
                padding: "6px 34px 7px",
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
              FICHE D&apos;INSCRIPTION DE L&apos;ÉLÈVE
            </span>
          </div>

          {/* --- Lignes École / Classe / Année scolaire / Date --- */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-end",
              fontSize: "12px",
              margin: "0 2px 6px",
              color: INK,
            }}
          >
            <span>
              <b style={{ color: CI_GREEN_TEXT }}>ECOLE</b> :{" "}
              <b>{data.school.name}</b>
            </span>
            <span style={{ textAlign: "right", lineHeight: 1.5 }}>
              <div>
                <span style={{ color: CI_GREEN_TEXT }}>Cours</span> :{" "}
                <b>{data.class.name}</b>
                <span style={{ color: CI_GREEN_TEXT, marginLeft: "14px" }}>
                  Année scolaire
                </span>{" "}
                : <b>{data.annee_scolaire}</b>
              </div>
              <div>
                <span style={{ color: CI_GREEN_TEXT }}>Date</span> : <b>{todayFr()}</b>
              </div>
            </span>
          </div>

          {/* --- Tableau d'identité civile (grille 6 colonnes : libellé /
                 valeur — paysage pour « tous les détails ») --- */}
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              tableLayout: "fixed",
              color: INK,
            }}
          >
            <colgroup>
              <col style={{ width: "15%" }} />
              <col style={{ width: "18.3%" }} />
              <col style={{ width: "15%" }} />
              <col style={{ width: "18.3%" }} />
              <col style={{ width: "15%" }} />
              <col style={{ width: "18.3%" }} />
            </colgroup>
            <tbody>
              <tr>
                <td style={labelTd}>Matricule</td>
                <td style={valueTd} colSpan={2}>
                  {civilOrDots(st.matricule)}
                </td>
                <td style={labelTd}>Sexe</td>
                <td style={valueTd} colSpan={2}>
                  {genderFr(st.gender)}
                </td>
              </tr>
              <tr>
                <td style={labelTd}>Nom</td>
                <td style={valueTd} colSpan={2}>
                  {civilOrDots(nom)}
                </td>
                <td style={labelTd}>Prénoms</td>
                <td style={valueTd} colSpan={2}>
                  {civilOrDots(prenoms)}
                </td>
              </tr>
              <tr>
                <td style={labelTd}>Jour de naissance</td>
                <td style={valueTd}>{civilOrDots(st.birth_day)}</td>
                <td style={labelTd}>Mois de naissance</td>
                <td style={valueTd}>{monthFr(st.birth_month)}</td>
                <td style={labelTd}>Année de naissance</td>
                <td style={valueTd}>{civilOrDots(st.birth_year)}</td>
              </tr>
              <tr>
                <td style={labelTd}>Lieu de naissance</td>
                <td style={valueTd} colSpan={2}>
                  {civilOrDots(st.birth_place)}
                </td>
                <td style={labelTd}>Nationalité</td>
                <td style={valueTd} colSpan={2}>
                  {civilOrDots(st.nationality)}
                </td>
              </tr>
              <tr>
                <td style={labelTd}>Père</td>
                <td style={valueTd} colSpan={2}>
                  {civilOrDots(st.father_name)}
                </td>
                <td style={labelTd}>Mère</td>
                <td style={valueTd} colSpan={2}>
                  {civilOrDots(st.mother_name)}
                </td>
              </tr>
              <tr>
                <td style={labelTd}>N° acte de naissance</td>
                <td style={valueTd} colSpan={2}>
                  {civilOrDots(st.acte_number)}
                </td>
                <td style={labelTd}>Lieu de l&apos;acte</td>
                <td style={valueTd} colSpan={2}>
                  {civilOrDots(st.acte_place)}
                </td>
              </tr>
              <tr>
                <td style={labelTd}>Scolarité dans le cours</td>
                <td style={valueTd} colSpan={2}>
                  {st.scolarite_cours == null || st.scolarite_cours === 0
                    ? "…………………"
                    : `${st.scolarite_cours} an(s)`}
                </td>
                <td style={labelTd}>Scolarité totale</td>
                <td style={valueTd} colSpan={2}>
                  {st.scolarite_totale == null || st.scolarite_totale === 0
                    ? "…………………"
                    : `${st.scolarite_totale} an(s)`}
                </td>
              </tr>
            </tbody>
          </table>

          {/* --- Fait à / Le + signature Le Directeur --- */}
          <div
            style={{
              textAlign: "right",
              fontSize: "12px",
              margin: "14px 4% 0 0",
              color: INK,
            }}
          >
            Fait à ……………………. Le ……..…/…….……/……….…
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              fontSize: "12.5px",
              fontWeight: 700,
              marginTop: "16px",
              padding: "0 2%",
              color: INK,
            }}
          >
            <div style={{ textAlign: "center" }}>
              <div>Le Directeur</div>
              <div
                style={{
                  fontSize: "12px",
                  fontWeight: 700,
                  marginTop: "14px",
                  textTransform: "uppercase",
                  letterSpacing: "0.3px",
                }}
              >
                {data.directeur || "……………………"}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
