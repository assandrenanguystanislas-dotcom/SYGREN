"use client";

// === Bulletins A5 paysage — Module Bulletins SYGREN ===
//
// Document officiel CI : 2 bulletins A5 (148×210mm) par page A4 paysage
// (297×210mm), séparés par une ligne pointillée centrale pour la découpe.
//
// Couleurs institutionnelles (pixel-perfect vs modèle de référence) :
//   - Bordures tableau : rgb(40,100,200) (bleu roi)
//   - Texte titres du tableau : rgb(20,50,140) (bleu foncé)
//
// Tailles de police très petites (8-11px) pour tenir dans A5.
// Image armoiries CI : /ci-coat-of-arms.png (asset local — plus fiable qu'une
// URL Wikimedia externe, déjà utilisé par /releve).
//
// Rendu conditionnel Éveil au Milieu :
//   - CP : 3 sous-matières (Hist-Géo / EDHC / Sciences) avec accolade "{"
//   - CE/CM : une seule ligne "Éveil au Milieu" avec note globale eveilMilieu
//
// Barème de la Moyenne dynamique :
//   - CP : /10
//   - CE/CM : /20
//
// Format du Rang :
//   - Avec valeur : "1er / 5" ou "2ème / 25" (rang/effectif)
//   - Sans valeur : "..... / 5" (pointillés + effectif)

// === Types ===

export interface BulletinEleve {
  id: number | string;
  nomPrenoms: string;
  matricule: string;
  classe: string; // "CP1", "CP2", "CE1", "CE2", "CM1", "CM2"
  effectif: number;
  sexe: string; // "M" ou "F"
  anneeScolaire: string;
  typeExamen: string; // ex: "COMPOSITION N°1"
  mois?: string;
  notes: {
    explText?: number | string;
    eveilMilieu?: number | string; // Note unique pour CE et CM
    histGeo?: number | string; // Détail CP
    edhcMilieu?: number | string; // Détail CP
    sciences?: number | string; // Détail CP
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
  rangNum?: number | string; // ex: 1 ou "1er"
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

// Couleurs institutionnelles (pixel-perfect)
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

// Affiche une note : si vide → "" (cellule vide), sinon valeur formatée.
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
              {/* BULLETIN GAUCHE */}
              <div className="p-2 pr-3">
                {pageEleves[0] && (
                  <BulletinA5
                    eleve={pageEleves[0]}
                    iep={iep}
                    schoolName={schoolName}
                  />
                )}
              </div>
              {/* BULLETIN DROITE — séparé par la ligne pointillée */}
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

  // Détection du niveau : CP → 3 sous-matières avec accolade, CE/CM → 1 ligne
  const isCP = eleve.classe.toUpperCase().startsWith("CP");

  // Barème de la Moyenne : CP → /10, CE/CM → /20
  const baremeMoyenne = isCP ? "/10" : "/20";

  // Format du Rang : "1er / 5" ou "2ème / 25" (rang/effectif)
  // Si pas de rang → "..... / {effectif}" (pointillés + effectif)
  const rangValue = eleve.rangNum;
  const rangSuffix =
    rangValue === 1 || rangValue === "1" ? "er" : "ème";
  const rangDisplay = rangValue
    ? `${rangValue}${rangSuffix} / ${eleve.effectif}`
    : `..... / ${eleve.effectif}`;

  // Liste ordonnée des matières simples (hors Éveil au Milieu)
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
        {/* Affiche directement le type d'examen (ex: "COMPOSITION N°1") sans préfixe */}
        <p className={`text-[9px] font-semibold uppercase ${TEXT_BLUE}`}>
          {eleve.typeExamen || "COMPOSITION N°1"}
        </p>
      </div>

      {/* === INFOS ÉLÈVE === */}
      {/* Layout grid 2-colonnes avec labels gauche-alignés et valeurs
          droite-alignées pour aligner verticalement les libellés
          (Matricule/Effectif/Année scolaire sur la même ligne verticale). */}
      <div className="grid grid-cols-2 gap-x-2 text-[9px] font-semibold mb-1 leading-snug">
        {/* Colonne gauche : Élève / Classe / Sexe */}
        <div className="grid grid-cols-[auto_1fr] gap-x-1 gap-y-0.5">
          <span>Élève :</span>
          <span className="font-normal">{eleve.nomPrenoms}</span>
          <span>Classe :</span>
          <span className="font-normal">{eleve.classe}</span>
          <span>Sexe :</span>
          <span className="font-normal">{eleve.sexe}</span>
        </div>
        {/* Colonne droite : Matricule / Effectif / Année scolaire
            Labels alignés à gauche, valeurs alignées à droite. */}
        <div className="grid grid-cols-[auto_1fr] gap-x-1 gap-y-0.5">
          <span>Matricule :</span>
          <span className="text-right font-normal">{eleve.matricule || "—"}</span>
          <span>Effectif :</span>
          <span className="text-right font-normal">{eleve.effectif}</span>
          <span>Année scolaire :</span>
          <span className="text-right font-normal">{eleve.anneeScolaire}</span>
        </div>
      </div>

      {/* === TABLEAU ENCADRÉ BLEU === */}
      <div className={`border-2 ${BORDER_BLUE} flex-grow flex flex-col justify-between`}>
        {/* LIGNE DU MOIS */}
        <div className={`border-b-2 ${BORDER_BLUE} text-center font-bold ${TEXT_BLUE} py-0.5 text-[11px]`}>
          MOIS DE : {eleve.mois || "........................................................20......"}
        </div>

        {/* EN-TÊTE TABLEAU */}
        <div className={`grid grid-cols-12 border-b-2 ${BORDER_BLUE} text-center font-bold ${TEXT_BLUE} text-[10px]`}>
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
            {/* Ligne 1 : Exploitation de Texte */}
            <div className={`grid grid-cols-8 border-b ${BORDER_BLUE} py-0.5`}>
              <span className={`col-span-6 font-bold ${TEXT_BLUE} pl-2`}>
                Exploitation de Texte
              </span>
              <span className={`col-span-2 border-l ${BORDER_BLUE} text-center font-semibold`}>
                {renderNote(n.explText)}
              </span>
            </div>

            {/* Ligne 2 : Éveil au Milieu — CONDITIONNEL par niveau */}
            {isCP ? (
              // CP : 3 sous-matières avec accolade "{"
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
                  <div className={`grid grid-cols-5 border-b ${BORDER_BLUE} py-0.5`}>
                    <span className="col-span-3 font-semibold text-[8px] pl-1">
                      Hist – Géo.
                    </span>
                    <span className={`col-span-2 border-l ${BORDER_BLUE} text-center font-semibold`}>
                      {renderNote(n.histGeo)}
                    </span>
                  </div>
                  <div className={`grid grid-cols-5 border-b ${BORDER_BLUE} py-0.5`}>
                    <span className="col-span-3 font-semibold text-[8px] pl-1">
                      EDHC
                    </span>
                    <span className={`col-span-2 border-l ${BORDER_BLUE} text-center font-semibold`}>
                      {renderNote(n.edhcMilieu)}
                    </span>
                  </div>
                  <div className="grid grid-cols-5 py-0.5">
                    <span className="col-span-3 font-semibold text-[8px] pl-1">
                      Sciences
                    </span>
                    <span className={`col-span-2 border-l ${BORDER_BLUE} text-center font-semibold`}>
                      {renderNote(n.sciences)}
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              // CE/CM : une seule ligne "Éveil au Milieu" avec note globale
              <div className={`grid grid-cols-8 border-b ${BORDER_BLUE} py-0.5`}>
                <span className={`col-span-6 font-bold ${TEXT_BLUE} pl-2`}>
                  Éveil au Milieu
                </span>
                <span className={`col-span-2 border-l ${BORDER_BLUE} text-center font-semibold`}>
                  {renderNote(n.eveilMilieu)}
                </span>
              </div>
            )}

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

            {/* TOTAL / Moyenne / Rang */}
            <div className={`border-t-2 ${BORDER_BLUE} pt-1 space-y-1.5 text-[9px] pb-1.5`}>
              <div>
                <p className={`font-bold ${TEXT_BLUE}`}>TOTAL :</p>
                <p className="font-semibold text-gray-800">
                  {eleve.total !== undefined && eleve.total !== null && eleve.total !== ""
                    ? renderNote(eleve.total)
                    : "............/.........."}
                </p>
              </div>
              <div>
                <p className={`font-bold ${TEXT_BLUE}`}>Moyenne :</p>
                <p className="font-semibold text-gray-800">
                  {eleve.moyenne !== undefined && eleve.moyenne !== null && eleve.moyenne !== ""
                    ? `${renderNote(eleve.moyenne)} ${baremeMoyenne}`
                    : `............ ${baremeMoyenne}`}
                </p>
              </div>
              <div>
                <p className={`font-bold ${TEXT_BLUE}`}>Rang :</p>
                <p className="font-semibold text-gray-800">{rangDisplay}</p>
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
