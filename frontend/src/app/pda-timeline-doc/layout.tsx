"use client";

import { Suspense, type ReactNode } from "react";

// @page PAR DÉFAUT de la route : A4 paysage, marge 8mm (sans page nommée —
// voir print.css pour la raison). Import CSS de route : chargé après
// globals.css, il gagne la cascade sur le @page portrait du relevé.
import "./print.css";

export const dynamic = "force-dynamic";

// Même gabarit que /synthese : page dédiée hors dashboard (l'impression des
// documents est cassée dans le shell — conteneurs flex/overflow du shell
// tronquent l'isolement print). Suspense requis par useSearchParams.
export default function PdaTimelineDocLayout({
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
