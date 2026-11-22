"use client";

import { Suspense, type ReactNode } from "react";

// @page PAR DÉFAUT de la route : A4 PAYSAGE, marge 6mm (sans page nommée —
// même raison que /personnel-doc et /liste-candidats-doc : le changement de
// contexte de page après le document génère une page blanche finale).
// Import CSS de route : chargé après globals.css, il gagne la cascade sur
// le @page portrait du relevé (le FICHIER CM2 compte 13 colonnes — exige
// la largeur paysage, comme la LISTE DES CANDIDATS).
import "./print.css";

export const dynamic = "force-dynamic";

// Même gabarit que /liste-candidats-doc : page dédiée hors dashboard
// (l'impression des documents est cassée dans le shell — conteneurs
// flex/overflow du shell tronquent l'isolement print). Suspense requis
// par useSearchParams.
export default function Cm2FileDocLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <p>Chargement…</p>
        </div>
      }
    >
      {children}
    </Suspense>
  );
}
