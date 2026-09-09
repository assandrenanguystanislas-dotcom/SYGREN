"use client";

// === Document « LISTE DES CANDIDATS ... A L'EXAMEN DU CEPE » — page dédiée
// === (module Élèves — image ELEVES IA_1 / IA_2 envoyée par l'utilisateur)
// Pattern /resultats-fin-annee-doc : le document vit
// sur sa propre page (hors dashboard), ouverte dans un nouvel onglet par
// students-view.tsx (bouton « Liste des candidats » — window.open),
// « Fermer » referme l'onglet (window.close).
// Query params : class (id classe, requis), t (token, requis).

import { useSearchParams } from "next/navigation";

import { Providers } from "@/components/providers";
import { CandidatesListDocument } from "@/components/views/candidates-list-document";
import { storeUrlTokenIfPresent } from "@/lib/print-guard";

function ListeCandidatsDocPageInner() {
  // Token de l'URL → localStorage (AVANT les requêtes des composants)
  storeUrlTokenIfPresent();
  const params = useSearchParams();
  const classId = params.get("class") ?? "";

  if (!classId) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-destructive mb-3">
            Paramètre manquant ou invalide (classe requise)
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
    <CandidatesListDocument classId={classId} onClose={() => window.close()} />
  );
}

export default function ListeCandidatsDocPage() {
  return (
    <Providers>
      <ListeCandidatsDocPageInner />
    </Providers>
  );
}
