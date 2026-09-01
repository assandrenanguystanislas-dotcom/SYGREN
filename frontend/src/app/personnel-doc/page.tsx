"use client";

// === Document « ÉTAT NOMINATIF DU PERSONNEL » — page dédiée ===
// Pattern /pda-plan-doc : le document vit sur sa propre page (hors
// dashboard), ouverte dans un nouvel onglet par teachers-view.tsx
// (window.open), « Fermer » referme l'onglet (window.close).
// Query param : school (id de l'école, requis).

import { useSearchParams } from "next/navigation";

import { Providers } from "@/components/providers";
import { PersonnelDocument } from "@/components/views/personnel-document";

function PersonnelDocPageInner() {
  const params = useSearchParams();
  const school = params.get("school") ?? "";

  if (!school) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-destructive mb-3">
            Paramètre manquant ou invalide (school requis)
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

  return <PersonnelDocument schoolId={school} onClose={() => window.close()} />;
}

export default function PersonnelDocPage() {
  return (
    <Providers>
      <PersonnelDocPageInner />
    </Providers>
  );
}
