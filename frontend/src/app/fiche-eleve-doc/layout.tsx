"use client";

import { Suspense, type ReactNode } from "react";

// @page PAR DÉFAUT de la route : A4 PAYSAGE, marge 8mm (sans page nommée —
// même raison que /personnel-doc et /resultats-fin-annee-doc : le changement
// de contexte de page après le document génère une page blanche finale).
// Import CSS de route : chargé après globals.css, il gagne la cascade sur
// le @page portrait du relevé (la fiche d'inscription de l'élève expose
// TOUTE l'identité civile — exige la largeur paysage).
import "./print.css";

export const dynamic = "force-dynamic";

// Même gabarit que /personnel-doc et /resultats-fin-annee-doc : page dédiée
// hors dashboard (l'impression des documents est cassée dans le shell —
// conteneurs flex/overflow du shell tronquent l'isolement print). Suspense
// requis par useSearchParams.
export default function FicheEleveDocLayout({
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
