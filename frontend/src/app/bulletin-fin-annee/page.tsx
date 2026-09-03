"use client";

// === Bulletins individuels « RESULTATS DE FIN D'ANNEE » — page dédiée ===
// Même pattern que /resultats-fin-annee-doc : document hors dashboard,
// ouvert dans un nouvel onglet par end-of-year-view.tsx (window.open),
// « Fermer » referme l'onglet (window.close). Le token vient du
// localStorage (même origine — onglet ouvert depuis la session active).
// Query params : school (id école), class (id classe), year (année de
// référence, optionnel) — OU, en mode PORTAIL PARENT (v2) :
// matricule (matricule de l'enfant). En mode parent, les données sont
// chargées via /api/parent/end-of-year et seuls les DEUX EXEMPLAIRES du
// bulletin de l'enfant sont rendus (impression autorisée pour le rôle
// parent sur CE document uniquement).

import { useSearchParams } from "next/navigation";

import { Providers } from "@/components/providers";
import { EndOfYearBulletin } from "@/components/views/end-of-year-bulletin";
import { storeUrlTokenIfPresent } from "@/lib/print-guard";

function BulletinFinAnneePageInner() {
  // Token de l'URL → localStorage (AVANT les requêtes des composants)
  storeUrlTokenIfPresent();
  const params = useSearchParams();
  const school = params.get("school") ?? "";
  const klass = params.get("class") ?? "";
  const yearStr = params.get("year") ?? "";
  const year = parseInt(yearStr, 10) || new Date().getFullYear();
  // v2 — mode Portail Parent : recherche par matricule de l'enfant
  const matricule = params.get("matricule") ?? "";

  if (!matricule && (!school || !klass)) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-destructive mb-3">
            Paramètre manquant ou invalide (school et class requis)
          </p>
          <button
            onClick={() => window.close()}
            className="px-3 py-1.5 bg-gray-200 rounded-md text-sm"
          >
            Fermer
          </button>
        </div>
      </div>
    );
  }

  return (
    <EndOfYearBulletin
      schoolId={school || undefined}
      classId={klass || undefined}
      year={year}
      onClose={() => window.close()}
      matricule={matricule || undefined}
    />
  );
}

export default function BulletinFinAnneePage() {
  return (
    <Providers>
      <BulletinFinAnneePageInner />
    </Providers>
  );
}
