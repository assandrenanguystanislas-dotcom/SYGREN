"use client";

// === Document « FICHE D'INSCRIPTION DE L'ÉLÈVE » — page dédiée ===
// Pattern /resultats-fin-annee-doc : le document vit sur sa propre page
// (hors dashboard), ouverte dans un nouvel onglet par students-view.tsx
// (bouton « Fiche » de chaque ligne — window.open), « Fermer » referme
// l'onglet (window.close).
// Query params : student (id élève, requis), t (token, requis).

import { useSearchParams } from "next/navigation";

import { Providers } from "@/components/providers";
import { FicheEleveDocument } from "@/components/views/fiche-eleve-document";
import { storeUrlTokenIfPresent } from "@/lib/print-guard";

function FicheEleveDocPageInner() {
  // Token de l'URL → localStorage (AVANT les requêtes des composants)
  storeUrlTokenIfPresent();
  const params = useSearchParams();
  const student = params.get("student") ?? "";

  if (!student) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-destructive mb-3">
            Paramètre manquant ou invalide (student requis)
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

  return <FicheEleveDocument studentId={student} onClose={() => window.close()} />;
}

export default function FicheEleveDocPage() {
  return (
    <Providers>
      <FicheEleveDocPageInner />
    </Providers>
  );
}
