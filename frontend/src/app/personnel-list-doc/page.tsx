"use client";

// === Documents « LISTE NOMINATIVE DES DIRECTEURS D'ECOLE » et
// « LISTE NOMINATIVE DES MAITRES DE CM2 » (Task 74) — page dédiée ===
// Pattern /personnel-doc : le document vit sur sa propre page (hors
// dashboard), ouverte dans un nouvel onglet par staff-data-view.tsx
// (module Fichier du personnel), « Fermer » referme l'onglet
// (window.close). Query param : kind (directeurs | cm2, requis).

import { useSearchParams } from "next/navigation";

import { Providers } from "@/components/providers";
import { PersonnelListDocument } from "@/components/views/personnel-list-document";
import type { PersonnelListKind } from "@/lib/types";

function PersonnelListDocPageInner() {
  const params = useSearchParams();
  const kindParam = params.get("kind") ?? "";
  // kind invalide → écran d'erreur (jamais de document ambigu).
  const kind: PersonnelListKind | null =
    kindParam === "directeurs" || kindParam === "cm2" ? kindParam : null;

  if (!kind) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-destructive mb-3">
            Paramètre manquant ou invalide (kind=directeurs ou kind=cm2 requis)
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

  return <PersonnelListDocument kind={kind} onClose={() => window.close()} />;
}

export default function PersonnelListDocPage() {
  return (
    <Providers>
      <PersonnelListDocPageInner />
    </Providers>
  );
}
