"use client";

// === Bulletins A5 paysage — Module Bulletins SYGREN ===
//
// Document officiel CI : 2 bulletins A5 (148×210mm) par page A4 paysage
// (297×210mm), séparés par une ligne pointillée centrale pour la découpe.
//
// Couleur primaire imposée : blue-700 (border) / blue-900 (titres) /
// blue-50/30 (fond en-tête colonnes). Le bleu est EXIGÉ pour ce document
// officiel — la couleur SYGREN (emerald/orange) n'est pas utilisée ici.
//
// Tailles de police très petites (8-10px) pour tenir dans A5.
// Image armoiries CI : /ci-coat-of-arms.png (asset local, déjà utilisé par
// /releve — plus fiable qu'une URL Wikimedia externe).
//
// L'utilisateur fournit un tableau d'élèves ; le composant rend N pages A4
// paysage avec 2 bulletins côte à côte par page (chunked par paquets de 2).

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
  name?: string; // "Dabou-1" → Inspection de l'Enseignement Préscolaire et Primaire de {name}
  region?: string; // "Dabou" → Direction Régionale de {region}
  bp?: string; // "317 Dabou"
  inspector_name?: string;
  inspector_email?: string;
  inspector_phone?: string; // "23 57 23 14"
  school_name?: string;
}

interface BulletinsA5LandscapeProps {
  eleves: BulletinEleve[];
  iepInfo?: IEPInfo;
}

// === Helpers ===

// Valeurs IEP par défaut (Dabou-1) — utilisées si iepInfo absent.
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
    // Arrondi à 2 décimales, sans zéros inutiles (ex: 18.5 → "18.5", 18 → "18").
    const r = Math.round(v * 100) / 100;
    return r.toFixed(2).replace(/\.?0+$/, "");
  }
  return String(v);
}

// === Composant principal ===

export function BulletinsA5Landscape({
  eleves,
  iepInfo,
}: BulletinsA5LandscapeProps) {
  const iep = { ...DEFAULT_IEP, ...iepInfo };
  const schoolName = iepInfo?.school_name || DEFAULT_SCHOOL_NAME;

  // Pages : 2 bulletins par page A4 paysage.
  const pages = chunk(eleves, 2);

  if (pages.length === 0) {
    return (
      <div className="w-[297mm] mx-auto p-8 text-center text-gray-600 text-sm">
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
            {/* Container 2 colonnes : un bulletin A5 (148mm) par côté, séparés
                par une ligne pointillée centrale pour la découpe.
                Sur A4 paysage (297mm), 2×148mm = 296mm → ~1mm de marge interne
                distribuée. On utilise grid-cols-2 avec une bordure centrale. */}
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

  // Rang → label lisible (ex: "1er" / "2e" / "15e"). On accepte string ou number.
  function renderRang(r: string | undefined): string {
    if (!r) return "";
    if (/^\d+$/.test(r)) {
      const num = parseInt(r, 10);
      if (num === 1) return "1er";
      return `${num}e`;
    }
    return r;
  }

  return (
    <div className="w-full text-[9px] leading-tight" style={{ fontSize: "9px" }}>
      {/* === ENTÊTE INSTITUTIONNEL CI === */}
      <header className="flex justify-between items-start gap-2 mb-1.5">
        {/* Bloc gauche : Ministère + IEP */}
        <div className="text-left leading-[1.15]">
          <p className="font-bold text-blue-900 text-[8px]">
            Ministère de l&apos;Éducation Nationale et de l&apos;Alphabétisation
          </p>
          <p className="font-bold text-blue-900 text-[8px]">
            et de l&apos;Enseignement Technique
          </p>
          <p className="italic text-[8px]">
            Direction Régionale de {iep.region}
          </p>
          <p className="font-bold text-[8px]">Inspection de l&apos;Enseignement</p>
          <p className="font-bold text-[8px]">
            Préscolaire et Primaire de {iep.name}
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
      <div className="text-center mb-1.5">
        <h1 className="font-bold text-blue-900 text-[11px] tracking-wide uppercase">
          Bulletin de Notes
        </h1>
        <p className="text-[8px] italic text-blue-900">
          Session de {eleve.session}
        </p>
      </div>

      {/* === INFOS ÉLÈVE === */}
      <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[8px] mb-1.5 border border-blue-700 p-1">
        <div>
          <span className="font-semibold">Élève :</span> {eleve.nomPrenoms}
        </div>
        <div>
          <span className="font-semibold">Matricule :</span>{" "}
          {eleve.matricule || "—"}
        </div>
        <div>
          <span className="font-semibold">Classe :</span> {eleve.classe}
        </div>
        <div>
          <span className="font-semibold">Effectif :</span> {eleve.effectif}
        </div>
        <div>
          <span className="font-semibold">Sexe :</span>{" "}
          {eleve.sexe === "F" ? "Féminin" : "Masculin"}
        </div>
        <div>
          <span className="font-semibold">Année scolaire :</span>{" "}
          {eleve.anneeScolaire}
        </div>
      </div>

      {/* === LIGNE DU MOIS === */}
      <div className="text-center font-bold text-blue-900 text-[9px] bg-blue-50/30 border border-blue-700 py-0.5 mb-1">
        MOIS DE : {eleve.mois}
      </div>

      {/* === TABLEAU DES NOTES — LAYOUT 2 COLONNES === */}
      {/*
        Colonnes : MATIÈRES (6/12) | NOTES (2/12) | Visa/Totaux (4/12)
        On rend le tableau comme un grid-cols-12 où chaque ligne matière
        a 6+2=8 colonnes à gauche + 4 colonnes à droite (vides, car les
        visas/totaux sont rendus en bas, en parallèle de la dernière ligne).
        Plus simple et plus lisible en A5 : on rend un tableau 2 colonnes
        (Matières | Notes) qui occupe 8/12 de la largeur, et la colonne
        droite 4/12 contient verticalement : Visa Directeur, Visa Parents,
        TOTAL, Moyenne, Rang.
      */}
      <div className="grid grid-cols-12 border border-blue-700">
        {/* === COLONNE GAUCHE (8/12) : MATIÈRES + NOTES === */}
        <div className="col-span-8 border-r border-blue-700">
          {/* En-tête */}
          <div className="grid grid-cols-8 bg-blue-50/30 border-b border-blue-700 text-[7px] font-bold uppercase text-blue-900">
            <div className="col-span-6 px-1 py-0.5 border-r border-blue-700">
              Matières
            </div>
            <div className="col-span-2 px-1 py-0.5 text-center">Notes</div>
          </div>

          {/* Ligne 1 : Exploitation de Texte */}
          <BulletinRow
            label="Exploitation de Texte"
            labelClass="font-bold text-blue-900"
            note={renderNote(n.explText)}
          />

          {/* Ligne 2 : Éveil au Milieu (sous-blocs indentés) */}
          <div className="border-b border-blue-700/50">
            <div className="px-1 py-0.5 text-[8px] font-bold text-blue-900 border-l-[3px] border-blue-700 bg-blue-50/20">
              Éveil au Milieu
            </div>
            <BulletinRow
              label="— Hist. – Géo."
              note={renderNote(n.histGeo)}
              indented
              noBorderBottom
            />
            <BulletinRow
              label="— EDHC (milieu)"
              note={renderNote(n.edhcMilieu)}
              indented
              noBorderBottom
            />
            <BulletinRow
              label="— Sciences"
              note={renderNote(n.sciences)}
              indented
            />
          </div>

          <BulletinRow
            label="Mathématiques"
            labelClass="font-bold"
            note={renderNote(n.maths)}
          />
          <BulletinRow label="Dictée" note={renderNote(n.dictee)} />
          <BulletinRow label="EPS" note={renderNote(n.eps)} />
          <BulletinRow label="Copie" note={renderNote(n.copie)} />
          <BulletinRow label="Écriture" note={renderNote(n.ecriture)} />
          <BulletinRow
            label="Expression Écrite"
            note={renderNote(n.expressionEcrite)}
          />
          <BulletinRow label="Dessin" note={renderNote(n.dessin)} />
          <BulletinRow label="EDHC" note={renderNote(n.edhc)} />
          <BulletinRow label="Lecture" note={renderNote(n.lecture)} />
          <BulletinRow label="Poésie/ Chant" note={renderNote(n.poesieChant)} />
          <BulletinRow
            label="E.D.H.C"
            note={renderNote(n.edhcBase)}
            isLastSubject
          />
        </div>

        {/* === COLONNE DROITE (4/12) : VISA + TOTAUX (empilés verticalement) === */}
        <div className="col-span-4 flex flex-col text-[8px]">
          {/* Visa Directeur (espace h-16 ≈ 64px) */}
          <div className="p-1 border-b border-blue-700/50 flex-1 min-h-[64px]">
            <p className="text-[7px] font-bold text-blue-900 uppercase">
              Visa du Directeur
            </p>
            <div className="h-12 mt-0.5" />
          </div>
          {/* Visa Parents (bold blue-900 + espace h-12 ≈ 48px) */}
          <div className="p-1 border-b border-blue-700/50">
            <p className="text-[7px] font-bold text-blue-900 uppercase">
              Visa des Parents
            </p>
            <div className="h-9 mt-0.5" />
          </div>
          {/* TOTAL */}
          <div className="grid grid-cols-2 border-b border-blue-700/50 bg-blue-50/30">
            <div className="px-1 py-0.5 border-r border-blue-700/50 font-bold text-blue-900">
              TOTAL
            </div>
            <div className="px-1 py-0.5 text-center font-bold">
              {eleve.total || "—"}
            </div>
          </div>
          {/* Moyenne */}
          <div className="grid grid-cols-2 border-b border-blue-700/50 bg-blue-50/30">
            <div className="px-1 py-0.5 border-r border-blue-700/50 font-bold text-blue-900">
              Moyenne
            </div>
            <div className="px-1 py-0.5 text-center font-bold">
              {eleve.moyenne || "—"}
            </div>
          </div>
          {/* Rang */}
          <div className="grid grid-cols-2 bg-blue-50/30">
            <div className="px-1 py-0.5 border-r border-blue-700/50 font-bold text-blue-900">
              Rang
            </div>
            <div className="px-1 py-0.5 text-center font-bold">
              {renderRang(eleve.rang) || "—"}
            </div>
          </div>
        </div>
      </div>

      {/* === LIGNE PLEINE SOUS LE TABLEAU : APPRÉCIATION + VISA DU MAÎTRE === */}
      <div className="border-x border-b border-blue-700 px-1 py-1 text-center">
        <p className="text-[7px] font-bold text-blue-900 uppercase underline mb-0.5">
          Appréciation
        </p>
        <p className="text-[8px] font-bold text-blue-900">
          {eleve.appreciation ||
            "………………………………………………………………………………………"}
        </p>
        <p className="text-[7px] mt-1 font-bold text-blue-900 uppercase underline">
          Visa du Maître
        </p>
      </div>

      {/* Pied de bulletin — école + année */}
      <div className="mt-1 text-center text-[7px] text-gray-600 italic">
        {schoolName} — Année scolaire {eleve.anneeScolaire}
      </div>
    </div>
  );
}

// === Sous-composant : ligne d'une matière dans le tableau ===

function BulletinRow({
  label,
  note,
  labelClass = "",
  indented = false,
  noBorderBottom = false,
  isLastSubject = false,
}: {
  label: string;
  note: string;
  labelClass?: string;
  indented?: boolean;
  noBorderBottom?: boolean;
  isLastSubject?: boolean;
}) {
  const borderClass = isLastSubject
    ? ""
    : noBorderBottom
      ? ""
      : "border-b border-blue-700/50";

  return (
    <div className={`grid grid-cols-8 text-[8px] ${borderClass}`}>
      <div
        className={`col-span-6 px-1 py-0.5 border-r border-blue-700 ${indented ? "pl-3" : ""} ${labelClass}`}
      >
        {label}
      </div>
      <div className="col-span-2 px-1 py-0.5 text-center font-semibold">
        {note || ""}
      </div>
    </div>
  );
}
