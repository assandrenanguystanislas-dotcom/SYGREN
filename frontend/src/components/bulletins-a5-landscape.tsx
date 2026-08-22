"use client";

// === Bulletins A5 paysage — Module Bulletins SYGREN ===
//
// Dimensions strictes pour impression physique sans décalage :
//   - Page A4 paysage : 297mm × 210mm (class .page-a4-landscape)
//   - Bulletin A5 individuel : 143.5mm de large (la moitié de 297mm moins
//     le trait de découpe central de 10mm)
//   - Trait de découpe : w-[10mm] avec border-r dashed au centre
//   - overflow-hidden + box-border sur le conteneur pour empêcher le
//     débordement vertical
//
// Couleurs institutionnelles :
//   - Bordures : rgb(40,100,200)
//   - Noms de matières : rgb(20,50,140) en gras
//   - Notes : noir en gras
//
// Éveil au Milieu : accolade + 3 noms + 1 cellule note fusionnée (eveilMilieu)
// Barème Moyenne : CP → /10, CE/CM → /20
// Rang : "1er / 5" ou "..... / 5"

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
    // Ces 3 champs sont utilisés en interne par computeEveilMilieu()
    // (dans page.tsx) pour calculer eveilMilieu. Ils ne sont pas affichés
    // individuellement dans le bulletin.
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
            className="page-a4-landscape w-[297mm] h-[210mm] bg-white mx-auto mb-6 p-2 print:m-0 flex flex-row box-border border border-gray-300 print:border-none overflow-hidden"
            style={{ pageBreakAfter: isLastPage ? "auto" : "always" }}
          >
            {pageEleves.map((eleve, idx) => (
              <BulletinFragment
                key={eleve.id}
                eleve={eleve}
                iep={iep}
                schoolName={schoolName}
                showDivider={idx === 0 && pageEleves.length === 2}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}

function BulletinFragment({
  eleve,
  iep,
  schoolName,
  showDivider,
}: {
  eleve: BulletinEleve;
  iep: Required<Omit<IEPInfo, "school_name">>;
  schoolName: string;
  showDivider: boolean;
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
    <>
      {/* BULLETIN A5 : 143.5mm de large strict */}
      <div className="w-[143.5mm] h-full px-2 py-1 flex flex-col justify-between text-black font-sans text-[10px] box-border">

        {/* EN-TÊTE INSTITUTIONNEL */}
        <div>
          <div className="flex justify-between items-start text-[8px] leading-tight">
            <div>
              <p className="font-semibold">Ministère de l&apos;Éducation Nationale et de l&apos;Alphabétisation</p>
              <p className="italic">et de l&apos;Enseignement Technique</p>
              <p className="italic">Direction Régionale de {iep.region}</p>
              <p className="font-bold">Inspection de l&apos;Enseignement Préscolaire et Primaire de {iep.name}</p>
              <p>BP : {iep.bp} / Tel : {iep.inspector_phone}</p>
              <p>
                <a className="text-blue-700 underline" href={`mailto:${iep.inspector_email}`}>
                  {iep.inspector_email}
                </a>
              </p>
            </div>
            <div className="text-center flex flex-col items-center min-w-[70px]">
              <p className="font-semibold text-[8px]">République de Côte d&apos;Ivoire</p>
              <p className="italic text-[7px]">Union-Discipline-Travail</p>
              <img
                src="/ci-coat-of-arms.png"
                alt="Armoiries Côte d'Ivoire"
                className="h-8 my-0.5 object-contain"
              />
            </div>
          </div>

          {/* TITRE */}
          <div className="text-center my-0.5">
            <h2 className="font-bold text-xs tracking-wide text-blue-900">BULLETIN DE NOTES</h2>
            <p className="font-semibold text-[10px] text-blue-700 uppercase">
              {eleve.typeExamen || "COMPOSITION N°1"}
            </p>
          </div>

          {/* INFOS ÉLÈVE — grid-cols-[auto_1fr] sur LES DEUX colonnes
              Labels droite-alignés (text-right) pour que les ':' s'alignent
              verticalement. Valeurs droite-alignées (text-right) pour que
              les valeurs s'alignent verticalement. */}
          <div className="grid grid-cols-2 gap-x-2 text-[9px] font-semibold mb-1 leading-tight">
            {/* Colonne gauche : Élève / Classe / Sexe */}
            <div className="grid grid-cols-[auto_1fr] gap-x-1 gap-y-0.5">
              <span className="font-bold text-right">Élève :</span>
              <span className="font-normal text-right">{eleve.nomPrenoms}</span>
              <span className="font-bold text-right">Classe :</span>
              <span className="font-normal text-right">{eleve.classe}</span>
              <span className="font-bold text-right">Sexe :</span>
              <span className="font-normal text-right">{eleve.sexe}</span>
            </div>
            {/* Colonne droite : Matricule / Effectif / Année scolaire */}
            <div className="grid grid-cols-[auto_1fr] gap-x-1 gap-y-0.5">
              <span className="font-bold text-right">Matricule :</span>
              <span className="font-normal text-right">{eleve.matricule || "—"}</span>
              <span className="font-bold text-right">Effectif :</span>
              <span className="font-normal text-right">{eleve.effectif}</span>
              <span className="font-bold text-right">Année scolaire :</span>
              <span className="font-normal text-right">{eleve.anneeScolaire}</span>
            </div>
          </div>
        </div>

        {/* TABLEAU BLEU */}
        <div className={`border-2 ${BORDER_BLUE} flex-grow flex flex-col justify-between`}>
          {/* MOIS */}
          <div className={`border-b-2 ${BORDER_BLUE} text-center font-bold ${TEXT_BLUE} py-0.5 text-[10px]`}>
            MOIS DE : {eleve.mois || "........................................................20......"}
          </div>

          {/* EN-TÊTE TABLEAU */}
          <div className={`grid grid-cols-12 border-b-2 ${BORDER_BLUE} text-center font-bold ${TEXT_BLUE} text-[10px]`}>
            <div className={`col-span-6 border-r-2 ${BORDER_BLUE} py-0.5 text-left pl-1.5`}>MATIÈRES</div>
            <div className={`col-span-2 border-r-2 ${BORDER_BLUE} py-0.5`}>NOTES</div>
            <div className="col-span-4 py-0.5">Visa du Directeur</div>
          </div>

          {/* CORPS */}
          <div className="grid grid-cols-12 flex-grow text-[9px]">
            {/* COLONNE GAUCHE 8/12 */}
            <div className={`col-span-8 border-r-2 ${BORDER_BLUE} flex flex-col justify-between`}>
              {/* Exploitation de Texte */}
              <div className={`grid grid-cols-8 border-b ${BORDER_BLUE} py-0.5`}>
                <span className={`col-span-6 font-bold ${TEXT_BLUE} pl-1.5`}>Exploitation de Texte</span>
                <span className={`col-span-2 border-l ${BORDER_BLUE} text-center font-bold text-black`}>
                  {renderNote(n.explText)}
                </span>
              </div>

              {/* Éveil au Milieu — fusion */}
              <div className={`grid grid-cols-8 border-b ${BORDER_BLUE} flex-grow`}>
                <div className={`col-span-2 pl-1 flex items-center justify-center font-bold ${TEXT_BLUE} leading-tight text-[9px] text-center border-r ${BORDER_BLUE}`}>
                  Éveil<br />au<br />Milieu
                </div>
                <div className={`col-span-1 flex items-center justify-center text-base ${TEXT_BLUE} border-r ${BORDER_BLUE}`}>
                  {"{"}
                </div>
                <div className="col-span-3 flex flex-col justify-between">
                  <div className={`border-b ${BORDER_BLUE} py-0.5 pl-1 font-bold ${TEXT_BLUE} text-[8px]`}>Hist – Géo.</div>
                  <div className={`border-b ${BORDER_BLUE} py-0.5 pl-1 font-bold ${TEXT_BLUE} text-[8px]`}>EDHC (milieu)</div>
                  <div className={`py-0.5 pl-1 font-bold ${TEXT_BLUE} text-[8px]`}>Sciences</div>
                </div>
                <div className={`col-span-2 border-l ${BORDER_BLUE} flex items-center justify-center font-bold text-black text-center`}>
                  {renderNote(n.eveilMilieu)}
                </div>
              </div>

              {/* Autres matières */}
              {SIMPLE_SUBJECTS.map((m, i) => {
                const isLast = i === SIMPLE_SUBJECTS.length - 1;
                return (
                  <div
                    key={i}
                    className={`grid grid-cols-8 ${isLast ? "" : `border-b ${BORDER_BLUE}`} py-0.5`}
                  >
                    <span className={`col-span-6 pl-1.5 font-bold ${TEXT_BLUE} truncate`}>{m.name}</span>
                    <span className={`col-span-2 border-l ${BORDER_BLUE} text-center font-bold text-black`}>
                      {renderNote(n[m.key])}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* COLONNE DROITE 4/12 */}
            <div className="col-span-4 flex flex-col justify-between text-center">
              <div className="h-12" />
              <div className={`border-t-2 ${BORDER_BLUE} pt-0.5`}>
                <p className={`font-bold ${TEXT_BLUE} text-[9px] uppercase`}>Visa des Parents</p>
                <div className="h-10" />
              </div>
              <div className={`border-t-2 ${BORDER_BLUE} pt-1 space-y-1 text-[9px] pb-1`}>
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
          <div className={`border-t-2 ${BORDER_BLUE} p-0.5 text-center min-h-[35px] flex flex-col justify-between`}>
            <p className={`font-bold ${TEXT_BLUE} underline text-[8px] uppercase`}>
              Appréciation et Visa du Maître
            </p>
          </div>
        </div>

        {/* PIED DE PAGE */}
        <div className="text-center text-[7px] italic text-gray-600 mt-0.5">
          {schoolName} — Année scolaire {eleve.anneeScolaire}
        </div>
      </div>

      {/* TRAIT DE DÉCOUPE CENTRAL — w-[10mm] séparé */}
      {showDivider && (
        <div className="w-[10mm] flex justify-center">
          <div className="border-r border-dashed border-gray-400 h-full" />
        </div>
      )}
    </>
  );
}
