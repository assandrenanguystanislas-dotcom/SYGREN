"use client";

// === Page /bulletins — impression A5 paysage des bulletins de notes ===
//
// URL : /bulletins?session_id=ID&t=TOKEN
//   - session_id : requis — ID de la session à imprimer
//   - t          : requis — token JWT (passé par le bouton "Imprimer les
//                  bulletins (A5)" dans bulletins-view.tsx). Stocké dans
//                  localStorage["sygren-auth"] au format zustand-persist
//                  minimal ({state: {token}, version: 0}) pour que apiFetch
//                  l'utilise automatiquement.
//
// Comportement :
//   1. Au montage : lit les URL params + stocke le token dans localStorage.
//   2. Fetch en parallèle : liste des classes de la session (releve-classes)
//      puis releve-data pour chaque classe.
//   3. Map chaque student → BulletinEleve via mapSubjectName().
//   4. Affiche la barre d'actions (Imprimer / Fermer) + <BulletinsA5Landscape>.
//   5. Bouton "Imprimer" → window.print() (ouvre le dialog navigateur).
//
// Aucune modification backend : on réutilise les endpoints existants
// /api/reports/releve-classes et /api/reports/releve-data.

import { useEffect, useState } from "react";
import { Loader2, Printer, X, AlertCircle, RefreshCw } from "lucide-react";

import { reportsApi } from "@/lib/api";
import { monthLabel } from "@/lib/session-utils";
import {
  BulletinsA5Landscape,
  type BulletinEleve,
  type IEPInfo,
} from "@/components/bulletins-a5-landscape";

// === Types locaux ===

// Type dérivé de la valeur de retour de reportsApi.getReleveData.
type ReleveData = Awaited<ReturnType<typeof reportsApi.getReleveData>>;

interface ClassInfo {
  id: string;
  name: string;
  level: string;
  student_count: number;
}

// === Mapping matières SYGREN → slots bulletin ===
//
// Le backend releve-data renvoie students[].grades[] avec subject_name.
// SYGREN a 8 matières par défaut + l'utilisateur peut en ajouter.
// On mappe case-insensitive, partial match.
//
// Si une matière n'est pas mappée, le slot reste vide (note "").
//
// Clés du BulletinEleve.notes :
//   explText, histGeo, edhcMilieu, sciences, maths, dictee, eps, copie,
//   ecriture, expressionEcrite, dessin, edhc, lecture, poesieChant, edhcBase

type BulletinNoteKey = keyof BulletinEleve["notes"];

function mapSubjectName(name: string): BulletinNoteKey | null {
  const n = name.toLowerCase();
  if (n.includes("français") || n.includes("francais") || n.includes("exploit"))
    return "explText";
  if (n.includes("math")) return "maths";
  if (n.includes("hist") || n.includes("géo") || n.includes("geo"))
    return "histGeo";
  if (n.includes("science")) return "sciences";
  if (n.includes("eps") || n.includes("sport")) return "eps";
  if (n.includes("dictée") || n.includes("dictee")) return "dictee";
  if (n.includes("copie")) return "copie";
  if (n.includes("expression") && (n.includes("écrit") || n.includes("ecrit")))
    return "expressionEcrite";
  // « écrit » / « ecrit » (sans « expression ») → ecriture
  if (n.includes("écrit") || n.includes("ecrit")) return "ecriture";
  if (n.includes("dessin")) return "dessin";
  if (n.includes("poés") || n.includes("poes") || n.includes("chant"))
    return "poesieChant";
  if (n.includes("lect")) return "lecture";
  if (n.includes("edhc")) {
    if (n.includes("milieu")) return "edhcMilieu";
    if (n.includes("base")) return "edhcBase";
    return "edhc";
  }
  return null; // sujet non mappé — slot reste vide
}

// Construit un BulletinEleve à partir d'un élève du backend.
function buildBulletinEleve(
  student: ReleveData["students"][number],
  className: string,
  classLevel: string,
  effectif: number,
  session: string,
  mois: string,
  anneeScolaire: string,
): BulletinEleve {
  // Note : le backend renvoie last_name + first_name séparément. On les
  // concatène dans l'ordre "Nom Prénoms" (format officiel CI).
  const nomPrenoms = `${student.last_name} ${student.first_name}`.trim();

  const notes: BulletinEleve["notes"] = {};
  for (const g of student.grades) {
    const slot = mapSubjectName(g.subject_name);
    if (!slot) continue; // sujet non mappé → on ignore
    if (notes[slot] !== undefined) continue; // 1ère occurrence gagne (en cas de doublon)
    notes[slot] = g.has_grade ? g.value : "";
  }

  // Formatage des valeurs numériques en chaînes lisibles.
  const fmtNum = (v: number | undefined, ok: boolean): string => {
    if (!ok || v === undefined) return "—";
    const r = Math.round(v * 100) / 100;
    return r.toFixed(2).replace(/\.?0+$/, "");
  };

  return {
    id: student.matricule || student.num,
    nomPrenoms,
    matricule: student.matricule,
    classe: className || classLevel,
    effectif,
    sexe: student.gender === "F" ? "F" : "M",
    anneeScolaire,
    session,
    mois,
    notes,
    total: fmtNum(student.total, student.has_average),
    moyenne: fmtNum(student.average, student.has_average),
    rang: "", // Pas de rang dans releve-data ; on laisse vide (sera rempli manuellement)
    appreciation: student.observation || "",
  };
}

// === Page ===

export default function BulletinsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [eleves, setEleves] = useState<BulletinEleve[]>([]);
  const [iepInfo, setIepInfo] = useState<IEPInfo | undefined>(undefined);
  const [meta, setMeta] = useState<{
    schoolName: string;
    sessionLabel: string;
  } | null>(null);

  // Fetch au montage.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get("session_id");
    const urlToken = params.get("t");

    // Si pas de session_id → erreur immédiate.
    if (!sessionId) {
      Promise.resolve().then(() => {
        setError("session_id est requis dans l'URL.");
        setLoading(false);
      });
      return;
    }

    // Si on a un token dans l'URL, on l'écrit dans localStorage au format
    // zustand-persist minimal ({state: {token}, version: 0}). apiFetch lit
    // ensuite ce token via getToken() et l'injecte dans Authorization.
    // NB : on préserve les autres champs du store (user, modules, etc.)
    // si l'entrée existe déjà, pour ne pas déconnecter l'onglet principal.
    if (urlToken) {
      try {
        const raw = localStorage.getItem("sygren-auth");
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed?.state) {
            parsed.state.token = urlToken;
            localStorage.setItem("sygren-auth", JSON.stringify(parsed));
          } else {
            // Format inattendu → on écrase avec le format minimal.
            localStorage.setItem(
              "sygren-auth",
              JSON.stringify({ state: { token: urlToken }, version: 0 }),
            );
          }
        } else {
          localStorage.setItem(
            "sygren-auth",
            JSON.stringify({ state: { token: urlToken }, version: 0 }),
          );
        }
      } catch {
        // En cas d'erreur de parsing : on écrase avec le format minimal.
        try {
          localStorage.setItem(
            "sygren-auth",
            JSON.stringify({ state: { token: urlToken }, version: 0 }),
          );
        } catch {}
      }
    }

    // Fetch parallèle : lister les classes de la session.
    reportsApi
      .listReleveClasses(sessionId)
      .then(async (cls) => {
        const classes: ClassInfo[] = cls.classes || [];
        if (classes.length === 0) {
          setEleves([]);
          setMeta({ schoolName: "—", sessionLabel: "Session inconnue" });
          setLoading(false);
          return;
        }

        // Pour chaque classe : releve-data en parallèle.
        const datas = await Promise.all(
          classes.map((c) =>
            reportsApi
              .getReleveData(sessionId, c.id)
              .then((d) => ({ classInfo: c, data: d }))
              .catch((e) => {
                // Si une classe échoue, on ne casse pas tout : on logge et continue.
                console.error(
                  `releve-data failed for class ${c.id} (${c.name}):`,
                  e,
                );
                return null;
              }),
          ),
        );

        const valid = datas.filter(
          (d): d is { classInfo: ClassInfo; data: ReleveData } => d !== null,
        );
        if (valid.length === 0) {
          throw new Error(
            "Aucune donnée récupérée pour cette session (toutes les classes ont échoué).",
          );
        }

        // Construire le IEPInfo commun (toutes les classes partagent le même
        // IEP car même session → on prend le 1er).
        const first = valid[0].data;
        const iep: IEPInfo = {
          name: first.iep_name,
          region: first.iep_region,
          bp: first.iep_bp,
          inspector_name: first.inspector_name,
          inspector_email: first.inspector_email,
          inspector_phone: first.inspector_phone,
          school_name: first.school_name,
        };
        setIepInfo(iep);

        // Construire le sessionLabel : ex: "Composition N°2 — Décembre 2026".
        const sessionLabel = `${first.type_examen} — ${monthLabel(first.month)} ${first.year}`;
        setMeta({
          schoolName: first.school_name,
          sessionLabel,
        });

        // Année scolaire : si month >= 9 (sept-déc), année scolaire commence
        // cette année (year/year+1). Sinon (jan-juil), année scolaire a
        // commencé l'année précédente (year-1/year).
        const anneeScolaire =
          first.month >= 9
            ? `${first.year}-${first.year + 1}`
            : `${first.year - 1}-${first.year}`;

        // Mois lisible (ex: "Décembre 2026").
        const mois = `${monthLabel(first.month)} ${first.year}`;

        // Construire les BulletinEleve pour toutes les classes.
        const allEleves: BulletinEleve[] = [];
        for (const { classInfo, data } of valid) {
          for (const s of data.students) {
            allEleves.push(
              buildBulletinEleve(
                s,
                data.class_name || classInfo.name,
                data.class_level || classInfo.level,
                data.total_t || classInfo.student_count,
                data.type_examen,
                mois,
                anneeScolaire,
              ),
            );
          }
        }

        setEleves(allEleves);

        // Titre onglet indicatif (le navigateur l'utilise pour le nom du PDF).
        document.title = `Bulletins A5 — ${first.school_name} — ${sessionLabel}`;

        setLoading(false);
      })
      .catch((e: unknown) => {
        const msg =
          e instanceof Error
            ? e.message
            : typeof e === "string"
              ? e
              : "Erreur inconnue";
        setError(msg);
        setLoading(false);
      });
  }, []);

  // === Rendus ===

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-100">
        <Loader2 className="w-8 h-8 animate-spin text-blue-700" />
        <p className="mt-2 text-sm text-gray-700">Chargement des bulletins…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-100">
        <div className="text-center max-w-md">
          <AlertCircle className="w-10 h-10 text-red-600 mx-auto" />
          <p className="mt-2 text-red-600 font-semibold">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-blue-700 text-white rounded-md text-sm font-semibold hover:bg-blue-800"
          >
            <RefreshCw className="w-4 h-4" />
            Réessayer
          </button>
          <button
            onClick={() => window.close()}
            className="mt-2 ml-2 inline-flex items-center gap-2 px-4 py-2 bg-gray-200 rounded-md text-sm"
          >
            <X className="w-4 h-4" />
            Fermer
          </button>
        </div>
      </div>
    );
  }

  if (eleves.length === 0) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-100">
        <div className="text-center max-w-md">
          <AlertCircle className="w-10 h-10 text-amber-600 mx-auto" />
          <p className="mt-2 text-amber-700 font-semibold">
            Aucun élève à imprimer pour cette session.
          </p>
          <button
            onClick={() => window.close()}
            className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-gray-200 rounded-md text-sm"
          >
            <X className="w-4 h-4" />
            Fermer
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gray-100 min-h-screen py-6 print:bg-white print:py-0 print:min-h-0">
      {/* Barre d'outils — cachée à l'impression */}
      <div className="sticky top-0 z-10 flex items-center justify-between bg-white border-b px-4 py-2 print:hidden shadow-sm">
        <div>
          <h1 className="font-semibold text-sm text-gray-900">
            Bulletins A5 — {meta?.schoolName ?? "École"} — {meta?.sessionLabel ?? "Session"}
          </h1>
          <p className="text-[11px] text-gray-500">
            {eleves.length} élève(s) · {Math.ceil(eleves.length / 2)} page(s) A4
            paysage · 2 bulletins/page
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-700 text-white rounded-md text-sm font-semibold hover:bg-blue-800 shadow-sm"
          >
            <Printer className="w-4 h-4" />
            Imprimer / PDF
          </button>
          <button
            onClick={() => window.close()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-200 rounded-md text-sm hover:bg-gray-300"
          >
            <X className="w-4 h-4" />
            Fermer
          </button>
        </div>
      </div>

      {/* === DOCUMENT === */}
      <div className="py-4 print:p-0 print:py-0">
        <BulletinsA5Landscape eleves={eleves} iepInfo={iepInfo} />
      </div>
    </div>
  );
}
