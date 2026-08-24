"use client";

import React from "react";

// === Bulletins A5 paysage — 2 bulletins par page A4 ===
//
// Modèle officiel CI avec entête institutionnel IDENTIQUE aux autres
// documents SYGREN (relevé & synthèse) : données IEP dynamiques (backend)
// + armoiries locales /ci-coat-of-arms.png (fiable à l'impression, sans
// dépendance réseau vers Wikimedia).
//
// Chaque page fait EXACTEMENT le format A4 paysage (297×210mm) avec
// @page margin 0. À l'impression, choisir dans le dialogue l'échelle
// « Ajuster / Agrandir pour remplir la zone imprimable » : le navigateur
// met à l'échelle la page A4 complète pour remplir la zone imprimable de
// l'imprimante (marges physiques gérées par le dialogue, pas par le CSS).
// Chaque page contient 2 bulletins A5 côte à côte,
// séparés par une ligne pointillée (zone de découpe/perforation).
//
// Couleurs du modèle officiel :
//   - Bordures du tableau : bleu rgb(40,100,200)
//   - Intitulés / libellés / noms de disciplines : bleu foncé gras
//     rgb(20,50,140), centrés dans leur cellule
//   - Notes : noir gras, centrées dans leur cellule
//
// Rendu « Éveil au Milieu » — même style pour TOUS les niveaux (CP, CE,
// CM) : label + accolade + 3 sous-lignes (Hist-Géo / EDHC / Sciences)
// et UNE cellule note unique fusionnée (note globale).
//
// Zones de signature : le nom du Directeur de l'école est imprimé dans la
// zone « Visa du Directeur », le nom du maître de classe (titulaire) dans
// la zone « Appréciation et Visa du Maître » — tous deux dynamiques.
//
// Barème de la moyenne : dynamique par élève (average_scale du backend —
// CP/CE → /10, CM → /20, cahier des charges §3 Module 2). Fallback : déduit
// du préfixe de la classe.

export interface IEPInfo {
  name: string;
  region: string;
  bp: string;
  inspector_name: string;
  inspector_email: string;
  inspector_phone: string;
  school_name: string;
  /** Directeur de l'école — imprimé dans la zone « Visa du Directeur ». */
  director_name?: string;
}

export interface BulletinEleve {
  id: number | string;
  nomPrenoms: string;
  matricule: string;
  classe: string; // Ex: "CP1", "CP2", "CE1", "CE2", "CM1", "CM2"
  effectif: number;
  sexe: string;
  anneeScolaire: string;
  typeExamen: string; // Ex: "COMPOSITION N°1"
  mois?: string;
  /** Barème de la moyenne pour CET élève — 10 (CP/CE) ou 20 (CM).
   *  Fallback si absent : déduit du préfixe de la classe. */
  averageScale?: number;
  notes: {
    explText?: number | string;
    eveilMilieu?: number | string; // Note globale unique — tous niveaux (CP, CE, CM)
    histGeo?: number | string;     // Composante CP (si matière séparée en DB)
    edhcMilieu?: number | string;  // Composante CP (si matière séparée en DB)
    sciences?: number | string;    // Composante CP (si matière séparée en DB)
    maths?: number | string;
    dictee?: number | string;
    eps?: number | string;
    copie?: number | string;
    ecriture?: number | string;
    expressionEcrite?: number | string;
    dessin?: number | string;
    edhc?: number | string;
    lecture?: number | string;
    poesieChant?: number | string;
  };
  total?: number | string;
  moyenne?: number | string;
  rangNum?: number | string; // Ex: 1 ou "1er"
  /** Statistiques de LA classe de l'élève — affichées sous le RANG. */
  stats?: {
    moyenneClasse: number;
    plusForte: number;
    plusFaible: number;
  };
  /** Évolution vs session précédente (même école/type/année scolaire).
   *  delta > 0 → ▲ vert ; < 0 → ▼ rouge ; exprimé sur l'échelle du
   *  niveau courant. undefined → ligne masquée (Composition N°1,
   *  élève absent à la session précédente…). */
  evolution?: {
    delta: number;
    previousAvg: number;
  };
  /** Maître de la classe (titulaire) — imprimé dans la zone
   *  « Appréciation et Visa du Maître ». */
  maitreName?: string;
  /** Appréciation générale automatique (mêmes textes que le backend PDF
   *  — getGeneralAppreciation). Affichée en gras italique dans la zone
   *  « Appréciation et Visa du Maître ». Vide → zone laissée au visa. */
  appreciation?: string;
  /** true → appréciation NÉGATIVE (moyenne < 10/20 normalisés ou aucune
   *  note) : texte ROUGE. false/absent → positive : texte NOIR. */
  appreciationNegative?: boolean;
}

// Bordures bleues du modèle officiel.
const BORDER = "rgb(40,100,200)";
const LABEL = "rgb(20,50,140)";
// Rouge d'alerte pour les appréciations négatives (impression nette).
const NEGATIVE = "rgb(200,20,20)";
// Vert progression (harmonisé avec le vert notes du PDF backend).
const POSITIVE = "rgb(0,120,50)";

// Formatage compact (8.5 → "8.5", 9.0123 → "9.01").
function fmt(v: number): string {
  return String(Math.round(v * 100) / 100);
}

export default function BulletinsA5Landscape({
  eleves,
  iepInfo,
}: {
  eleves: BulletinEleve[];
  iepInfo?: IEPInfo;
}) {
  // Découpage par pages de 2 bulletins — sans jamais mélanger deux classes
  // sur la même page (facilite la découpe et la distribution par classe) :
  // un changement de classe force une nouvelle page.
  const chunked: BulletinEleve[][] = [];
  for (const e of eleves) {
    const last = chunked[chunked.length - 1];
    if (!last || last.length === 2 || last[0].classe !== e.classe) {
      chunked.push([e]);
    } else {
      last.push(e);
    }
  }

  return (
    <div className="bg-gray-200 min-h-screen py-4 print:bg-white print:p-0">
      {chunked.map((pair, pageIdx) => {
        const isLastPage = pageIdx === chunked.length - 1;
        return (
          <div
            key={pageIdx}
            className={`page-bulletins w-[297mm] h-[210mm] bg-white mx-auto mb-6 p-4 print:p-2 print:m-0 flex flex-row border border-gray-300 print:border-none overflow-hidden ${!isLastPage ? "break-after-page" : ""}`}
            style={{ pageBreakAfter: isLastPage ? "auto" : "always" }}
          >
            {pair.map((eleve, idx) => {
              const classUpper = eleve.classe.toUpperCase();
              // Barème de la moyenne : priorité à la donnée backend
              // (average_scale : 10 pour CP/CE, 20 pour CM — cahier des
              // charges §3). Fallback : déduit du préfixe de la classe.
              const bareme =
                eleve.averageScale ??
                (classUpper.startsWith("CM") ? 20 : 10);
              const baremeMoyenne = `/${bareme}`;

              return (
                <React.Fragment key={eleve.id}>
                  {/* Moitié A5 */}
                  <div className="w-1/2 h-full px-3 py-1 flex flex-col justify-between text-black font-sans text-[11px]">

                    {/* En-tête officiel — dynamique (données IEP), comme le relevé */}
                    <div>
                      <div className="flex justify-between items-start text-[9px] leading-tight">
                        <div className="text-left">
                          <p className="font-semibold">
                            Ministère de l&apos;Education Nationale Et de
                            l&apos;Alphabétisation
                          </p>
                          <p className="italic">et de l&apos;Enseignement Technique</p>
                          <p className="italic">
                            Direction Régionale de {iepInfo?.region || "........."}
                          </p>
                          <p className="font-bold">
                            Inspection de l&apos;Enseignement Préscolaire et
                            Primaire de {iepInfo?.name || "........."}
                          </p>
                          <p>
                            BP : {iepInfo?.bp || "....."} / Tel :{" "}
                            {iepInfo?.inspector_phone || "............."}
                          </p>
                          <p className="text-blue-700 underline">
                            Courriel : {iepInfo?.inspector_email || "............"}
                          </p>
                        </div>
                        <div className="text-center flex flex-col items-center shrink-0 pl-2">
                          <p className="font-semibold text-[9px]">
                            République de Côte d&apos;Ivoire
                          </p>
                          <p className="italic text-[8px]">Union-Discipline-Travail</p>
                          {/* Armoiries locales — fiables à l'impression
                              (pas de dépendance réseau externe). */}
                          <img
                            src="/ci-coat-of-arms.png"
                            alt="Armoiries de la Côte d'Ivoire"
                            className="h-9 my-0.5 object-contain"
                          />
                        </div>
                      </div>

                      {/* Titre */}
                      <div className="text-center my-1">
                        <h2 className="font-bold text-sm tracking-wide">
                          BULLETIN DE NOTES
                        </h2>
                        <p className="font-semibold text-xs uppercase">
                          {eleve.typeExamen || "COMPOSITION N°1"}
                        </p>
                      </div>

                      {/* Infos élève (alignement strict Matricule & Effectif) */}
                      <div className="grid grid-cols-2 text-[10px] font-semibold mb-1 leading-snug">
                        <div>
                          <p>
                            Élève :{" "}
                            <span className="font-normal">{eleve.nomPrenoms}</span>
                          </p>
                          <p>
                            Classe : <span className="font-normal">{eleve.classe}</span>
                          </p>
                          <p>
                            Sexe : <span className="font-normal">{eleve.sexe}</span>
                          </p>
                        </div>
                        {/* Bloc droit calé à l'extrême droite, libellés
                            empilés sur la MÊME VERTICALE (grille 2 colonnes
                            auto : libellés alignés entre eux, valeurs
                            alignées entre elles — « Effectif » exactement
                            sous « Matricule », conformément au modèle). */}
                        <div className="ml-auto w-fit grid grid-cols-[auto_auto] gap-x-1.5 text-left">
                          <span>Matricule :</span>
                          <span className="font-normal">{eleve.matricule}</span>
                          <span>Effectif :</span>
                          <span className="font-normal">{eleve.effectif}</span>
                          <span>Année scolaire :</span>
                          <span className="font-normal">{eleve.anneeScolaire}</span>
                        </div>
                      </div>
                    </div>

                    {/* TABLEAU EN BORDURE BLEUE */}
                    <div
                      className="border-2 flex-grow flex flex-col justify-between"
                      style={{ borderColor: BORDER }}
                    >

                      {/* Mois */}
                      <div
                        className="border-b-2 text-center font-bold py-0.5 text-xs"
                        style={{ borderColor: BORDER, color: LABEL }}
                      >
                        MOIS DE :{" "}
                        {eleve.mois ||
                          "........................................................20......"}
                      </div>

                      {/* En-tête tableau — matières resserrées : 5/12
                          (au lieu de 6), NOTES 2/12 inchangée, colonne
                          visas/totaux élargie 5/12. */}
                      <div
                        className="grid grid-cols-12 border-b-2 text-center font-bold text-[11px]"
                        style={{ borderColor: BORDER, color: LABEL }}
                      >
                        <div
                          className="col-span-5 border-r-2 py-0.5 text-left pl-2"
                          style={{ borderColor: BORDER }}
                        >
                          MATIÈRES
                        </div>
                        <div
                          className="col-span-2 border-r-2 py-0.5"
                          style={{ borderColor: BORDER }}
                        >
                          NOTES
                        </div>
                        <div className="col-span-5 py-0.5">VISA DU DIRECTEUR</div>
                      </div>

                      {/* Corps du tableau */}
                      <div className="grid grid-cols-12 flex-grow text-[10px]">

                        {/* Colonnes Matières + Notes (7/12 — matières
                            resserrées) */}
                        <div
                          className="col-span-7 border-r-2 flex flex-col justify-between"
                          style={{ borderColor: BORDER }}
                        >

                          {/* Exploitation de texte — nom bleu gras aligné à gauche, note noire grasse centrée */}
                          <div
                            className="grid grid-cols-7 border-b py-0.5 text-[11px]"
                            style={{ borderColor: BORDER }}
                          >
                            <span
                              className="col-span-5 font-bold text-left pl-2"
                              style={{ color: LABEL }}
                            >
                              Exploitation de Texte
                            </span>
                            <span
                              className="col-span-2 border-l font-bold text-black text-center"
                              style={{ borderColor: BORDER }}
                            >
                              {eleve.notes.explText ?? ""}
                            </span>
                          </div>

                          {/* Éveil au Milieu — MÊME STYLE pour tous les
                             * niveaux (CP, CE et CM) : label + accolade +
                             * 3 sous-lignes (Hist-Géo / EDHC / Sciences)
                             * et UNE cellule note unique fusionnée sur la
                             * colonne NOTES (col-span-2), centrée
                             * verticalement — une seule note globale. */}
                          <div
                            className="grid grid-cols-7 border-b"
                            style={{ borderColor: BORDER }}
                          >
                            {/* Partie libellés (5/7) : Éveil au Milieu + { + sous-lignes */}
                            <div className="col-span-5 flex">
                              <div
                                className="w-[30%] flex items-center justify-center font-bold leading-tight text-[10px] text-center"
                                style={{ color: LABEL }}
                              >
                                Éveil<br />au<br />Milieu
                              </div>
                              <div
                                className="w-[10%] flex items-center justify-center text-lg"
                                style={{ color: BORDER }}
                              >
                                &#123;
                              </div>
                              <div className="flex-1">
                                <div
                                  className="border-b py-0.5 text-left pl-1 font-bold text-[10px]"
                                  style={{ color: LABEL }}
                                >
                                  Hist – Géo.
                                </div>
                                <div
                                  className="border-b py-0.5 text-left pl-1 font-bold text-[10px]"
                                  style={{ color: LABEL }}
                                >
                                  EDHC
                                </div>
                                <div
                                  className="py-0.5 text-left pl-1 font-bold text-[10px]"
                                  style={{ color: LABEL }}
                                >
                                  Sciences
                                </div>
                              </div>
                            </div>
                            {/* Cellule note unique fusionnée (2/7) — note globale */}
                            <div
                              className="col-span-2 border-l flex items-center justify-center font-bold text-black text-center"
                              style={{ borderColor: BORDER }}
                            >
                              {eleve.notes.eveilMilieu ?? ""}
                            </div>
                          </div>

                          {/* Autres matières — noms bleu gras alignés à gauche, notes noires grasses centrées */}
                          {[
                            { name: "Mathématiques", key: "maths" },
                            { name: "Dictée", key: "dictee" },
                            { name: "EPS", key: "eps" },
                            { name: "Copie", key: "copie" },
                            { name: "Ecriture", key: "ecriture" },
                            { name: "Expression Écrite", key: "expressionEcrite" },
                            { name: "Dessin", key: "dessin" },
                            { name: "EDHC", key: "edhc" },
                            { name: "Lecture", key: "lecture" },
                            { name: "Poésie/ Chant", key: "poesieChant" },
                          ].map((m, i) => (
                            <div
                              key={i}
                              className="grid grid-cols-7 border-b last:border-b-0 py-0.5 text-[11px]"
                              style={{ borderColor: BORDER }}
                            >
                              <span
                                className="col-span-5 font-bold text-left pl-2"
                                style={{ color: LABEL }}
                              >
                                {m.name}
                              </span>
                              <span
                                className="col-span-2 border-l font-bold text-black text-center"
                                style={{ borderColor: BORDER }}
                              >
                                {eleve.notes[m.key as keyof typeof eleve.notes] ?? ""}
                              </span>
                            </div>
                          ))}
                        </div>

                        {/* Colonne Visas & Totaux (5/12 — élargie pour
                            compenser les matières resserrées) */}
                        <div className="col-span-5 flex flex-col text-center">
                          {/* Signature du Directeur — cellule sous l'en-tête
                              « Visa du Directeur » (96px ≈ 25mm) : nom
                              imprimé en bas, place pour signer au-dessus. */}
                          <div className="h-[96px] flex flex-col justify-end pb-1 px-1">
                            {iepInfo?.director_name && (
                              <p className="text-center text-[9px] font-semibold leading-tight">
                                {iepInfo.director_name}
                              </p>
                            )}
                          </div>

                          {/* Cellule VISA DES PARENTS — titre CELLULE pleine
                              largeur (style VISA DU DIRECTEUR : centré +
                              filet de séparation) + 96px. */}
                          <div
                            className="border-t-2"
                            style={{ borderColor: BORDER }}
                          >
                            <p
                              className="font-bold text-[10px] py-0.5 text-center border-b"
                              style={{ color: LABEL, borderColor: BORDER }}
                            >
                              VISA DES PARENTS
                            </p>
                            <div className="h-[96px]"></div>
                          </div>

                          {/* Cellule RÉSULTATS — titre ENCADRÉ + lignes
                              compactes (libellé à gauche, valeur à droite). */}
                          <div
                            className="border-t-2 pt-1"
                            style={{ borderColor: BORDER }}
                          >
                            <p
                              className="font-bold text-[10px] py-0.5 text-center border-b"
                              style={{ color: LABEL, borderColor: BORDER }}
                            >
                              RÉSULTATS
                            </p>
                            <div className="space-y-1 text-[11px]">
                              <div className="flex justify-between px-1.5">
                                <span className="font-bold" style={{ color: LABEL }}>
                                  TOTAL :
                                </span>
                                <span className="font-bold text-black">
                                  {eleve.total ?? "......../........"}
                                </span>
                              </div>
                              <div className="flex justify-between px-1.5">
                                <span className="font-bold" style={{ color: LABEL }}>
                                  MOYENNE :
                                </span>
                                <span className="font-bold text-black">
                                  {eleve.moyenne
                                    ? `${eleve.moyenne} ${baremeMoyenne}`
                                    : `........ ${baremeMoyenne}`}
                                </span>
                              </div>
                              <div className="flex justify-between px-1.5">
                                <span className="font-bold" style={{ color: LABEL }}>
                                  RANG :
                                </span>
                                <span className="font-bold text-black">
                                  {eleve.rangNum
                                    ? `${eleve.rangNum}${eleve.rangNum === 1 || eleve.rangNum === "1" ? "er" : "ème"} / ${eleve.effectif}`
                                    : "....../....."}
                                </span>
                              </div>
                            </div>
                          </div>

                          {/* Cellule STATISTIQUES — titre ENCADRÉ + stats.
                              flex-1 + justify-evenly : la cellule absorbe
                              l'espace restant de la colonne (plus de vide
                              blanc sous les lignes) et répartit ses lignes. */}
                          {(eleve.stats || eleve.evolution) && (
                            <div
                              className="border-t-2 pt-1 pb-1 flex-1 flex flex-col min-h-0"
                              style={{ borderColor: BORDER }}
                            >
                              <p
                                className="font-bold text-[10px] py-0.5 text-center border-b"
                                style={{ color: LABEL, borderColor: BORDER }}
                              >
                                STATISTIQUES
                              </p>
                              <div className="flex-1 flex flex-col justify-evenly text-[9px]">
                              {eleve.stats && (
                                <>
                                  <div className="flex justify-between px-1.5">
                                    <span className="font-bold" style={{ color: LABEL }}>
                                      MOY. CLASSE :
                                    </span>
                                    <span className="font-bold text-black">
                                      {fmt(eleve.stats.moyenneClasse)}
                                    </span>
                                  </div>
                                  <div className="flex justify-between px-1.5">
                                    <span className="font-bold" style={{ color: LABEL }}>
                                      PLUS FORTE :
                                    </span>
                                    <span className="font-bold text-black">
                                      {fmt(eleve.stats.plusForte)}
                                    </span>
                                  </div>
                                  <div className="flex justify-between px-1.5">
                                    <span className="font-bold" style={{ color: LABEL }}>
                                      PLUS FAIBLE :
                                    </span>
                                    <span className="font-bold text-black">
                                      {fmt(eleve.stats.plusFaible)}
                                    </span>
                                  </div>
                                </>
                              )}
                              {eleve.evolution && (
                                <div
                                  className={`flex justify-between px-1.5 ${
                                    eleve.stats ? "border-t pt-0.5" : ""
                                  }`}
                                  style={
                                    eleve.stats ? { borderColor: BORDER } : undefined
                                  }
                                >
                                  {/* Libellé dynamique : PROGRESSION (▲ vert) /
                                      RÉGRESSION (▼ rouge) / STABLE (= noir). */}
                                  <span className="font-bold" style={{ color: LABEL }}>
                                    {eleve.evolution.delta > 0
                                      ? "ÉLÈVE EN PROGRESSION :"
                                      : eleve.evolution.delta < 0
                                        ? "ÉLÈVE EN RÉGRESSION :"
                                        : "ÉLÈVE STABLE :"}
                                  </span>
                                  <span
                                    className="font-bold"
                                    style={{
                                      color:
                                        eleve.evolution.delta > 0
                                          ? POSITIVE
                                          : eleve.evolution.delta < 0
                                            ? NEGATIVE
                                            : "black",
                                    }}
                                  >
                                    {eleve.evolution.delta > 0
                                      ? `▲ +${fmt(eleve.evolution.delta)}`
                                      : eleve.evolution.delta < 0
                                        ? `▼ ${fmt(eleve.evolution.delta)}`
                                        : "= 0"}
                                  </span>
                                </div>
                              )}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Appréciation / Visa du maître */}
                      <div
                        className="border-t-2 p-1 text-center flex-grow flex flex-col min-h-[48px]"
                        style={{ borderColor: BORDER }}
                      >
                        {/* Titre CELLULE pleine largeur (style VISA DU
                            DIRECTEUR : centré + filet de séparation). */}
                        <p
                          className="font-bold text-[10px] py-0.5 text-center border-b mx-1.5"
                          style={{ color: LABEL, borderColor: BORDER }}
                        >
                          APPRÉCIATION ET VISA DU MAÎTRE
                        </p>
                        {/* Appréciation générale automatique (calculée comme
                            le backend PDF) — GRAS ITALIQUE lisible, couleur
                            dynamique : NOIR si positive (≥ 10/20 normalisés),
                            ROUGE si négative (< 10/20 ou aucune note). */}
                        {eleve.appreciation && (
                          <p
                            className="font-bold italic text-[10px] leading-snug mt-0.5 px-1.5"
                            style={{
                              color: eleve.appreciationNegative
                                ? NEGATIVE
                                : "black",
                            }}
                          >
                            {eleve.appreciation}
                          </p>
                        )}
                        {/* Nom du maître de classe (titulaire) imprimé en bas
                            de la zone — dynamique, depuis releve-data. */}
                        {eleve.maitreName && (
                          <p className="mt-auto text-[9px] font-semibold leading-tight pb-0.5 px-1.5">
                            {eleve.maitreName}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Ligne pointillée centrale de séparation (découpe) */}
                  {idx === 0 && pair.length === 2 && (
                    <div className="border-r border-dashed border-gray-400 h-full"></div>
                  )}
                </React.Fragment>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
