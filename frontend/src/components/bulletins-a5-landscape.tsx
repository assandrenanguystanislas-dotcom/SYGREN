"use client";

// === Bulletins A5 paysage — Module Bulletins SYGREN ===
//
// Document officiel CI : 2 bulletins A5 (148×210mm) par page A4 paysage
// (297×210mm), séparés par une ligne pointillée centrale pour la découpe.
//
// Couleurs institutionnelles :
//   - Bordures tableau : rgb(40,100,200) (bleu roi)
//   - Noms de matières : rgb(20,50,140) en gras (bleu foncé)
//   - Notes : noir en gras (font-bold text-black)
//   - Titres du tableau (MOIS, MATIÈRES, etc.) : rgb(20,50,140) en gras
//
// Éveil au Milieu : toujours fusionné — accolade "{" + 3 noms de sous-matières
// (Hist-Géo / EDHC / Sciences) sur la gauche + une CELLULE UNIQUE pour la
// note globale (eveilMilieu) centrée verticalement sur la droite.
//
// Barème de la Moyenne dynamique : CP → /10, CE/CM → /20
// Format du Rang : "1er / 5" ou "..... / 5" (rang/effectif)

// === Types ===

export interface BulletinEleve {
  id: number | string;
  nomPrenoms: string;
  matricule: string;
  classe: string;
  effectif: number;
  sexe: string;
  anneeScolaire: string;
  typeExamen: string;
  mois?: string;
  notes: {
    explText?: number | string;
    eveilMilieu?: number | string;
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
  total?: number | string;
  moyenne?: number | string;
  rangNum?: number | string;
}

export interface IEPInfo {
  name?: string;
  region?: string;
  bp?: string;
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

const BORDER_BLUE = "border-[rgb(40,100,200)]";
const TEXT_BLUE = "text-[rgb(20,50,140)]";

function chunk<T>(arr: T[], size: number): T[][] {
  if (arr.length === 0) return [];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

function renderNote(v: number | string | undefined): string {
  if (v === undefined || v === null || v === "") return "";
  if (typeof v === "number") {
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
              <div className="p-2 pr-3">
                {pageEleves[0] && (
                  <BulletinA5 eleve={pageEleves[0]} iep={iep} schoolName={schoolName} />
                )}
              </div>
              <div className="p-2 pl-3 border-l-2 border-dashed border-gray-400">
                {pageEleves[1] && (
                  <BulletinA5 eleve={pageEleves[1]} iep={iep} schoolName={schoolName} />
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

  const isCP = eleve.classe.toUpperCase().startsWith("CP");
  const baremeMoyenne = isCP ? "/10" : "/20";

  const rangValue = eleve.rangNum;
  const rangSuffix = rangValue === 1 || rangValue === "1" ? "er" : "ème";
  const rangDisplay = rangValue
    ? `${rangValue}${rangSuffix} / ${eleve.effectif}`
    : `..... / ${eleve.effectif}`;

  const SIMPLE_SUBJECTS: { name: string; key: keyof typeof n }[] = [
    { name: "Mathématiques", key: "maths" },
    { name: "Dictée", key: "dictee" },
    { name: "EPS", key: "eps" },
    { name: "Copie", key: "copie" },
    { name: "Écriture", key: "ecriture" },
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
            <a className="text-blue-700 underline" href={`mailto:${iep.inspector_email}`}>
              {iep.inspector_email}
            </a>
          </p>
        </div>
        <div className="flex flex-col items-center text-center min-w-[60px]">
          <p className="font-semibold text-[8px]">République de Côte d&apos;Ivoire</p>
          <p className="italic text-[7px]">Union-Discipline-Travail</p>
          <img
            src="/ci-coat-of-arms.png"
            alt="Armoiries Côte d'Ivoire"
            className="h-8 my-0.5 object-contain"
          />
        </div>
      </header>

      {/* === TITRE === */}
      <div className="text-center mb-1">
        <h2 className={`font-bold text-[12px] tracking-wide uppercase ${TEXT_BLUE}`}>
          Bulletin de Notes
        </h2>
        <p className="font-semibold text-[9px] uppercase text-blue-700">
          {eleve.typeExamen || "COMPOSITION N°1"}
        </p>
      </div>

      {/* === INFOS ÉLÈVE === */}
      <div className="grid grid-cols-2 gap-x-2 text-[9px] font-semibold mb-1 leading-snug">
        {/* Colonne gauche */}
        <div className="space-y-0.5">
          <p>Élève : <span className="font-normal">{eleve.nomPrenoms}</span></p>
          <p>Classe : <span className="font-normal">{eleve.classe}</span></p>
          <p>Sexe : <span className="font-normal">{eleve.sexe}</span></p>
        </div>
        {/* Colonne droite : grid avec labels gauche-alignés + valeurs droite-alignées */}
        <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
          <span className="font-bold">Matricule :</span>
          <span className="font-normal text-right">{eleve.matricule || "—"}</span>
          <span className="font-bold">Effectif :</span>
          <span className="font-normal text-right">{eleve.effectif}</span>
          <span className="font-bold">Année scolaire :</span>
          <span className="font-normal text-right">{eleve.anneeScolaire}</span>
        </div>
      </div>

      {/* === TABLEAU ENCADRÉ BLEU === */}
      <div className={`border-2 ${BORDER_BLUE} flex-grow flex flex-col justify-between`}>
        {/* MOIS */}
        <div className={`border-b-2 ${BORDER_BLUE} text-center font-bold ${TEXT_BLUE} py-0.5 text-[11px]`}>
          MOIS DE : {eleve.mois || "........................................................20......"}
        </div>

        {/* EN-TÊTE TABLEAU */}
        <div className={`grid grid-cols-12 border-b-2 ${BORDER_BLUE} text-center font-bold ${TEXT_BLUE} text-[10px]`}>
          <div className={`col-span-6 border-r-2 ${BORDER_BLUE} py-0.5 text-left pl-2`}>MATIÈRES</div>
          <div className={`col-span-2 border-r-2 ${BORDER_BLUE} py-0.5`}>NOTES</div>
          <div className="col-span-4 py-0.5">Visa du Directeur</div>
        </div>

        {/* CORPS DU TABLEAU */}
        <div className="grid grid-cols-12 flex-grow text-[9px]">
          {/* === COLONNE GAUCHE (8/12) : MATIÈRES + NOTES === */}
          <div className={`col-span-8 border-r-2 ${BORDER_BLUE} flex flex-col justify-between`}>

            {/* Exploitation de Texte */}
            <div className={`grid grid-cols-8 border-b ${BORDER_BLUE} py-0.5`}>
              <span className={`col-span-6 font-bold ${TEXT_BLUE} pl-2`}>Exploitation de Texte</span>
              <span className={`col-span-2 border-l ${BORDER_BLUE} text-center font-bold text-black`}>
                {renderNote(n.explText)}
              </span>
            </div>

            {/* ÉVEIL AU MILIEU — Fusion : accolade + 3 noms + 1 cellule note unique */}
            <div className={`grid grid-cols-8 border-b ${BORDER_BLUE} flex-grow`}>
              {/* Label vertical */}
              <div className={`col-span-2 pl-1 flex items-center justify-center font-bold ${TEXT_BLUE} leading-tight text-[9px] text-center border-r ${BORDER_BLUE}`}>
                Éveil<br />au<br />Milieu
              </div>
              {/* Accolade */}
              <div className={`col-span-1 flex items-center justify-center text-[20px] ${TEXT_BLUE} border-r ${BORDER_BLUE}`}>
                {"{"}
              </div>
              {/* 3 noms de sous-matières (sans notes individuelles) */}
              <div className={`col-span-3 flex flex-col justify-between`}>
                <div className={`border-b ${BORDER_BLUE} py-0.5 pl-1 font-bold ${TEXT_BLUE} text-[8px]`}>Hist – Géo.</div>
                <div className={`border-b ${BORDER_BLUE} py-0.5 pl-1 font-bold ${TEXT_BLUE} text-[8px]`}>EDHC (milieu)</div>
                <div className="py-0.5 pl-1 font-bold text-[8px] text-[rgb(20,50,140)]">Sciences</div>
              </div>
              {/* Cellule unique fusionnée pour la note d'Éveil */}
              <div className={`col-span-2 border-l ${BORDER_BLUE} flex items-center justify-center font-bold text-black text-center`}>
                {renderNote(n.eveilMilieu)}
              </div>
            </div>

            {/* Autres matières — toutes en bleu gras + notes en noir gras */}
            {SIMPLE_SUBJECTS.map((m, i) => {
              const isLast = i === SIMPLE_SUBJECTS.length - 1;
              return (
                <div
                  key={i}
                  className={`grid grid-cols-8 ${isLast ? "" : `border-b ${BORDER_BLUE}`} py-0.5`}
                >
                  <span className={`col-span-6 pl-2 font-bold ${TEXT_BLUE}`}>{m.name}</span>
                  <span className={`col-span-2 border-l ${BORDER_BLUE} text-center font-bold text-black`}>
                    {renderNote(n[m.key])}
                  </span>
                </div>
              );
            })}
          </div>

          {/* === COLONNE DROITE (4/12) : VISA + TOTAUX === */}
          <div className="col-span-4 flex flex-col justify-between text-center">
            <div className="h-16" />
            <div className={`border-t-2 ${BORDER_BLUE} pt-1`}>
              <p className={`font-bold ${TEXT_BLUE} text-[9px] uppercase`}>Visa des Parents</p>
              <div className="h-12" />
            </div>
            <div className={`border-t-2 ${BORDER_BLUE} pt-1 space-y-1.5 text-[9px] pb-1.5`}>
              <div>
                <p className={`font-bold ${TEXT_BLUE}`}>TOTAL :</p>
                <p className="font-bold text-black">
                  {eleve.total !== undefined && eleve.total !== null && eleve.total !== ""
                    ? renderNote(eleve.total)
                    : "............/.........."}
                </p>
              </div>
              <div>
                <p className={`font-bold ${TEXT_BLUE}`}>Moyenne :</p>
                <p className="font-bold text-black">
                  {eleve.moyenne !== undefined && eleve.moyenne !== null && eleve.moyenne !== ""
                    ? `${renderNote(eleve.moyenne)} ${baremeMoyenne}`
                    : `............ ${baremeMoyenne}`}
                </p>
              </div>
              <div>
                <p className={`font-bold ${TEXT_BLUE}`}>Rang :</p>
                <p className="font-bold text-black">{rangDisplay}</p>
              </div>
            </div>
          </div>
        </div>

        {/* APPRÉCIATION */}
        <div className={`border-t-2 ${BORDER_BLUE} p-1 text-center min-h-[40px] flex flex-col justify-between`}>
          <p className={`font-bold ${TEXT_BLUE} underline text-[9px] uppercase`}>
            Appréciation et Visa du Maître
          </p>
        </div>
      </div>

      {/* Pied de page */}
      <div className="mt-1 text-center text-[7px] italic text-gray-600">
        {schoolName} — Année scolaire {eleve.anneeScolaire}
      </div>
    </div>
  );
}
