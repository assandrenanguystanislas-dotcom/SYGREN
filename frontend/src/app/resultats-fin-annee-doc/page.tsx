"use client";

// === Document « RESULTATS DE FIN D'ANNEE » — page dédiée ===
// Pattern /personnel-doc : le document vit sur sa propre page (hors
// dashboard), ouverte dans un nouvel onglet par end-of-year-view.tsx
// (window.open), « Fermer » referme l'onglet (window.close).
// Query params : school (id école, requis), class (id classe, requis),
// year (année de référence, optionnel).

import { useSearchParams } from "next/navigation";

import { Providers } from "@/components/providers";
import { EndOfYearDocument } from "@/components/views/end-of-year-document";

function ResultatsFinAnneeDocPageInner() {
  const params = useSearchParams();
  const school = params.get("school") ?? "";
  const klass = params.get("class") ?? "";
  const yearStr = params.get("year") ?? "";
  const year = parseInt(yearStr, 10) || new Date().getFullYear();

  if (!school || !klass) {
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
    <EndOfYearDocument
      schoolId={school}
      classId={klass}
      year={year}
      onClose={() => window.close()}
    />
  );
}

export default function ResultatsFinAnneeDocPage() {
  return (
    <Providers>
      <ResultatsFinAnneeDocPageInner />
    </Providers>
  );
}
