"use client";

// === Bulletins A5 paysage — Module Bulletins SYGREN ===
//
// Document officiel CI : 2 bulletins A5 (148×210mm) par page A4 paysage
// (297×210mm), séparés par une ligne pointillée centrale pour la découpe.
//
// Couleurs institutionnelles (pixel-perfect vs modèle de référence) :
//   - Bordures tableau : rgb(40,100,200) (bleu roi)
//   - Texte titres du tableau : rgb(20,50,140) (bleu foncé)
//   - Bordures externes : rgb(40,100,200)
//   - Fond en-tête colonnes : bg-[rgb(40,100,200)]/10
//
// Tailles de police très petites (8-11px) pour tenir dans A5.
// Image armoiries CI : /ci-coat-of-arms.png (asset local — plus fiable qu'une
// URL Wikimedia externe, déjà utilisé par /releve).
//
// L'utilisateur fournit un tableau d'élèves ; le composant rend N pages A4
// paysage avec 2 bulletins côte à côte par page (chunked par paquets de 2).
//
// Layout du tableau (grid-cols-12) :
//   - Colonne gauche (8/12) : Matières (6/8) + Notes (2/8)
//   - Colonne droite (4/12) : Visa Directeur / Visa Parents / TOTAL / Moyenne / Rang
//
// Bloc "Éveil au Milieu" : accolade `{` verticale (col-span-1, gros caractère
// bleu, centré verticalement) qui relie visuellement les 3 sous-matières
// (Hist-Géo, EDHC milieu, Sciences) placées dans une sous-colonne (col-span-5).

// === Types ===

export interface BulletinEleve {
  id: number | string;
  nomPrenoms: string;
  matricule: string;
  classe: string;
  effectif: number;
  sexe: "M" | "F";
  anneeScolaire: string;
  session: string;
  mois: string;
  notes: {
    explText?: number | string;
    histGeo?: number | string;
    edhcMilieu?: number | string;
    sciences?: number | string;
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
    edhcBase?: number | string;
  };
  total?: string;
  moyenne?: string;
  rang?: string;
  appreciation?: string;
}

export interface IEPInfo {
  name?: string; // "Dabou-1"
  region?: string; // "Dabou"
  bp?: string; // "317 Dabou"
  inspector_name?: string;
  inspector_email?: string;
  inspector_phone?: string;
  school_name?: string;
}

interface BulletinsA5LandscapeProps {
  eleves: BulletinEleve[];
  iepInfo?: IEPInfo;
}

// === Helpers ===

const DEFAULT_IEP: Required<Omit<IEPInfo, "school_name">> = {
  name: "Dabou-1",
  region: "Dabou",
  bp: "317 Dabou",
  inspector_name: "",
  inspector_email: "iep1dabou@gmail.com",
  inspector_phone: "23 57 23 14",
};

const DEFAULT_SCHOOL_NAME = "École";

// Découpe un tableau en chunks de taille `size`.
function chunk<T>(arr: T[], size: number): T[][] {
  if (arr.length === 0) return [];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

// Affiche une note : si vide → "" (cellule vide), sinon valeur brute.
function renderNote(v: number | string | undefined): string {
  if (v === undefined || v === null || v === "") return "";
  if (typeof v === "number") {
    const r = Math.round(v * 100) / 100;
    return r.toFixed(2).replace(/\.?0+$/, "");
  }
  return String(v);
}

// Rang → label lisible (ex: "1er" / "2e" / "15e").
function renderRang(r: string | undefined): string {
  if (!r) return "";
  if (/^\d+$/.test(r)) {
    const num = parseInt(r, 10);
    if (num === 1) return "1er";
    return `${num}e`;
  }
  return r;
}

// === Constantes de couleurs (pixel-perfect vs modèle de référence) ===
const BORDER_BLUE = "border-[rgb(40,100,200)]";
const TEXT_BLUE = "text-[rgb(20,50,140)]";
const BG_BLUE_LIGHT = "bg-[rgb(40,100,200)]/10";

// === Composant principal ===

export function BulletinsA5Landscape({
  eleves,
  iepInfo,
}: BulletinsA5LandscapeProps) {
  const iep = { ...DEFAULT_IEP, ...iepInfo };
  const schoolName = iepInfo?.school_name || DEFAULT_SCHOOL_NAME;

  const pages = chunk(eleves, 2);

  if (pages.length === 0) {
    return (
      <div className="mx-auto p-8 text-center text-gray-600 text-sm">
        Aucun élève à imprimer.
      </div>
    );
  }

  return (
    <div id="bulletins-doc" className="font-sans text-black">
      {pages.map((pageEleves, pageIndex) => {
        const isLastPage = pageIndex === pages.length - 1;
        return (
          <div
            key={pageIndex}
            className={`page-bulletins break-after-page w-[297mm] min-h-[210mm] print:w-full print:min-h-0 bg-white mx-auto mb-4 print:mb-0 shadow-md print:shadow-none print:m-0 print:p-0 flex`}
            style={{ pageBreakAfter: isLastPage ? "auto" : "always" }}
          >
            <div className="grid grid-cols-2 w-full">
              {/* === BULLETIN GAUCHE === */}
              <div className="p-2 pr-3">
                {pageEleves[0] && (
                  <BulletinA5
                    eleve={pageEleves[0]}
                    iep={iep}
                    schoolName={schoolName}
                  />
                )}
              </div>

              {/* === BULLETIN DROITE === (séparé par la ligne pointillée) */}
              <div className="p-2 pl-3 border-l-2 border-dashed border-gray-400">
                {pageEleves[1] && (
                  <BulletinA5
                    eleve={pageEleves[1]}
                    iep={iep}
                    schoolName={schoolName}
                  />
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// === Bulletin A5 individuel ===
//
// Structure pixel-perfect vs le modèle de référence :
//
//   ┌── ENTÊTE INSTITUTIONNEL CI ────────────────────────────┐
//   │ Ministère + Direction + IEP + BP + Tel + Courriel    │  République + armoiries
//   └── ────────────────────────────────────────────────────┘
//   ┌── BULLETIN DE NOTES — Session de {session} ───────────┐
//   │ Élève: …    Matricule: …                              │
//   │ Classe: …   Effectif: …                                │
//   │ Sexe: …     Année scolaire: …                          │
//   └────────────────────────────────────────────────────────┘
//   ┌── TABLEAU ENCADRÉ BLEU rgb(40,100,200) ────────────────┐
//   │ MOIS DE : {mois} 20..  (centré bold)                  │
//   ├────────────────────────────────────────────────────────┤
//   │ MATIÈRES | NOTES | Visa du Directeur                  │
//   ├────────────────────────────────────────────────────────┤
//   │ Exploitation de Texte            | <note>             │
//   │ ┌─Éveil─┐ { ┌─ Hist-Géo.   ────┐│                    │
//   │ │ au   │  │ ├─ EDHC        ────┤│  [Visa Directeur]  │
//   │ │Milieu│  │ └─ Sciences    ────┘│                    │
//   │ └──────┘                        │                    │
//   │ Mathématiques                    │                    │
//   │ Dictée                           │  [Visa des Parents]│
//   │ EPS                              │                    │
//   │ Copie                            │  TOTAL : ..../..  │
//   │ Écriture                         │  Moyenne : ..../..│
//   │ Expression Écrite                │  Rang : ..../..   │
//   │ Dessin                           │                    │
//   │ EDHC                             │                    │
//   │ Lecture                          │                    │
//   │ Poésie/ Chant                    │                    │
//   │ E.D.H.C                          │                    │
//   ├────────────────────────────────────────────────────────┤
//   │ Appréciation et Visa du Maître (centré souligné)      │
//   └────────────────────────────────────────────────────────┘

function BulletinA5({
  eleve,
  iep,
  schoolName,
}: {
  eleve: BulletinEleve;
  iep: Required<Omit<IEPInfo, "school_name">>;
  schoolName: string;
}) {
  const n = eleve.notes;

  // Liste ordonnée des matières simples (hors Éveil au Milieu).
  const SIMPLE_SUBJECTS: { name: string; key: keyof typeof n; bold?: boolean }[] = [
    { name: "Mathématiques", key: "maths", bold: true },
    { name: "Dictée", key: "dictee" },
    { name: "EPS", key: "eps" },
    { name: "Copie", key: "copie" },
    { name: "Ecriture", key: "ecriture" },
    { name: "Expression Écrite", key: "expressionEcrite" },
    { name: "Dessin", key: "dessin" },
    { name: "EDHC", key: "edhc" },
    { name: "Lecture", key: "lecture" },
    { name: "Poésie/ Chant", key: "poesieChant" },
    { name: "E.D.H.C", key: "edhcBase" },
  ];

  return (
    <div className="w-full flex flex-col text-[10px] leading-tight text-black">
      {/* === ENTÊTE INSTITUTIONNEL CI === */}
      <header className="flex justify-between items-start gap-2 mb-1">
        {/* Bloc gauche : Ministère + IEP */}
        <div className="text-left leading-[1.2]">
          <p className="font-semibold text-[8px]">
            Ministère de l&apos;Éducation Nationale et de l&apos;Alphabétisation
          </p>
          <p className="italic text-[8px]">et de l&apos;Enseignement Technique</p>
          <p className="italic text-[8px]">
            Direction Régionale de {iep.region}
          </p>
          <p className="font-bold text-[8px]">
            Inspection de l&apos;Enseignement Préscolaire et Primaire de {iep.name}
          </p>
          <p className="text-[8px]">
            BP : {iep.bp} / Tel : {iep.inspector_phone}
          </p>
          <p className="text-[8px]">
            Courriel :{" "}
            <a
              className="text-blue-700 underline"
              href={`mailto:${iep.inspector_email}`}
            >
              {iep.inspector_email}
            </a>
          </p>
        </div>

        {/* Bloc droit : République de CI + armoiries */}
        <div className="flex flex-col items-center text-center min-w-[60px]">
          <p className="font-semibold text-[8px]">
            République de Côte d&apos;Ivoire
          </p>
          <p className="italic text-[7px]">Union-Discipline-Travail</p>
          <img
            src="/ci-coat-of-arms.png"
            alt="Armoiries Côte d'Ivoire"
            className="h-8 my-0.5 object-contain"
          />
        </div>
      </header>

      {/* === TITRE BULLETIN DE NOTES === */}
      <div className="text-center mb-1">
        <h2 className={`font-bold text-[12px] tracking-wide uppercase ${TEXT_BLUE}`}>
          Bulletin de Notes
        </h2>
        <p className={`text-[9px] italic font-semibold ${TEXT_BLUE}`}>
          Session de {eleve.session}
        </p>
      </div>

      {/* === INFOS ÉLÈVE === */}
      <div className="grid grid-cols-2 gap-x-2 text-[9px] font-semibold mb-1 leading-snug">
        <div>
          <p>
            Élève : <span className="font-normal">{eleve.nomPrenoms}</span>
          </p>
          <p>
            Classe : <span className="font-normal">{eleve.classe}</span>
          </p>
          <p>
            Sexe :{" "}
            <span className="font-normal">
              {eleve.sexe === "F" ? "Féminin" : "Masculin"}
            </span>
          </p>
        </div>
        <div className="text-right">
          <p>
            Matricule : <span className="font-normal">{eleve.matricule || "—"}</span>
          </p>
          <p>
            Effectif : <span className="font-normal">{eleve.effectif}</span>
          </p>
          <p>
            Année scolaire :{" "}
            <span className="font-normal">{eleve.anneeScolaire}</span>
          </p>
        </div>
      </div>

      {/* === TABLEAU ENCADRÉ BLEU === */}
      <div className={`border-2 ${BORDER_BLUE} flex-grow flex flex-col justify-between`}>
        {/* LIGNE DU MOIS */}
        <div
          className={`border-b-2 ${BORDER_BLUE} text-center font-bold ${TEXT_BLUE} py-0.5 text-[11px] ${BG_BLUE_LIGHT}`}
        >
          MOIS DE : {eleve.mois || "........................................................20......"}
        </div>

        {/* EN-TÊTE TABLEAU */}
        <div
          className={`grid grid-cols-12 border-b-2 ${BORDER_BLUE} text-center font-bold ${TEXT_BLUE} text-[10px]`}
        >
          <div className={`col-span-6 border-r-2 ${BORDER_BLUE} py-0.5 text-left pl-2`}>
            MATIÈRES
          </div>
          <div className={`col-span-2 border-r-2 ${BORDER_BLUE} py-0.5`}>
            NOTES
          </div>
          <div className="col-span-4 py-0.5">Visa du Directeur</div>
        </div>

        {/* CORPS DU TABLEAU — grid-cols-12 : col-gauche 8 + col-droite 4 */}
        <div className="grid grid-cols-12 flex-grow text-[9px]">
          {/* === COLONNE GAUCHE (8/12) : MATIÈRES + NOTES === */}
          <div className={`col-span-8 border-r-2 ${BORDER_BLUE} flex flex-col justify-between`}>
            {/* Ligne 1 : Exploitation de Texte (bold blue) */}
            <div className={`grid grid-cols-8 border-b ${BORDER_BLUE} py-0.5`}>
              <span className={`col-span-6 font-bold ${TEXT_BLUE} pl-2`}>
                Exploitation de Texte
              </span>
              <span className={`col-span-2 border-l ${BORDER_BLUE} text-center font-semibold`}>
                {renderNote(n.explText)}
              </span>
            </div>

            {/* Ligne 2 : Éveil au Milieu AVEC ACCOLADE */}
            {/* Layout : col-span-2 (label vertical "Éveil/au/Milieu")
                        col-span-1 (accolade "{" gros caractère bleu, centré verticalement)
                        col-span-5 (3 sous-matières empilées : Hist-Géo, EDHC, Sciences) */}
            <div className={`grid grid-cols-8 border-b ${BORDER_BLUE}`}>
              {/* Label "Éveil au Milieu" — vertical sur 3 lignes */}
              <div className={`col-span-2 pl-1 flex items-center justify-center font-bold ${TEXT_BLUE} leading-tight text-[9px] text-center border-r ${BORDER_BLUE}`}>
                Éveil<br />au<br />Milieu
              </div>
              {/* Accolade "{" — gros caractère bleu, centré verticalement */}
              <div className={`col-span-1 flex items-center justify-center text-[20px] ${TEXT_BLUE} border-r ${BORDER_BLUE}`}>
                {"{"}
              </div>
              {/* Sous-colonne 5/8 avec les 3 sous-matières */}
              <div className="col-span-5">
                {/* Hist – Géo. */}
                <div className={`grid grid-cols-5 border-b ${BORDER_BLUE} py-0.5`}>
                  <span className="col-span-3 font-semibold text-[8px] pl-1">
                    Hist – Géo.
                  </span>
                  <span className={`col-span-2 border-l ${BORDER_BLUE} text-center font-semibold`}>
                    {renderNote(n.histGeo)}
                  </span>
                </div>
                {/* EDHC (milieu) */}
                <div className={`grid grid-cols-5 border-b ${BORDER_BLUE} py-0.5`}>
                  <span className="col-span-3 font-semibold text-[8px] pl-1">
                    EDHC
                  </span>
                  <span className={`col-span-2 border-l ${BORDER_BLUE} text-center font-semibold`}>
                    {renderNote(n.edhcMilieu)}
                  </span>
                </div>
                {/* Sciences */}
                <div className={`grid grid-cols-5 py-0.5`}>
                  <span className="col-span-3 font-semibold text-[8px] pl-1">
                    Sciences
                  </span>
                  <span className={`col-span-2 border-l ${BORDER_BLUE} text-center font-semibold`}>
                    {renderNote(n.sciences)}
                  </span>
                </div>
              </div>
            </div>

            {/* Lignes 3-13 : Autres matières */}
            {SIMPLE_SUBJECTS.map((m, i) => {
              const isLast = i === SIMPLE_SUBJECTS.length - 1;
              return (
                <div
                  key={i}
                  className={`grid grid-cols-8 ${isLast ? "" : `border-b ${BORDER_BLUE}`} py-0.5`}
                >
                  <span
                    className={`col-span-6 pl-2 ${m.bold ? `font-bold ${TEXT_BLUE}` : "font-medium"}`}
                  >
                    {m.name}
                  </span>
                  <span className={`col-span-2 border-l ${BORDER_BLUE} text-center font-semibold`}>
                    {renderNote(n[m.key])}
                  </span>
                </div>
              );
            })}
          </div>

          {/* === COLONNE DROITE (4/12) : VISA + TOTAUX === */}
          <div className="col-span-4 flex flex-col justify-between text-center">
            {/* Visa Directeur (espace h-16 ≈ 64px) */}
            <div className="h-16" />

            {/* Visa Parents */}
            <div className={`border-t-2 ${BORDER_BLUE} pt-1`}>
              <p className={`font-bold ${TEXT_BLUE} text-[9px]`}>Visa des Parents</p>
              <div className="h-12" />
            </div>

            {/* TOTAL / Moyenne / Rang — pointillés */}
            <div className={`border-t-2 ${BORDER_BLUE} pt-1 space-y-1.5 text-[9px] pb-1.5`}>
              <div>
                <p className={`font-bold ${TEXT_BLUE}`}>TOTAL :</p>
                <p className="font-semibold text-gray-700">
                  {eleve.total || "............/.........."}
                </p>
              </div>
              <div>
                <p className={`font-bold ${TEXT_BLUE}`}>Moyenne :</p>
                <p className="font-semibold text-gray-700">
                  {eleve.moyenne || "............/.........."}
                </p>
              </div>
              <div>
                <p className={`font-bold ${TEXT_BLUE}`}>Rang :</p>
                <p className="font-semibold text-gray-700">
                  {renderRang(eleve.rang) || "........../ ......."}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* LIGNE PLEINE SOUS LE TABLEAU : APPRÉCIATION + VISA DU MAÎTRE */}
        <div className={`border-t-2 ${BORDER_BLUE} p-1 text-center min-h-[40px]`}>
          <p className={`font-bold ${TEXT_BLUE} underline text-[9px]`}>
            Appréciation et Visa du Maître
          </p>
        </div>
      </div>

      {/* Pied de bulletin — école + année */}
      <div className="mt-1 text-center text-[7px] text-gray-600 italic">
        {schoolName} — Année scolaire {eleve.anneeScolaire}
      </div>
    </div>
  );
}
