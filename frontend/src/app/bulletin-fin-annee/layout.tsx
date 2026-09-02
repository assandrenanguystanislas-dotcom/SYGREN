"use client";

import { Suspense, type ReactNode } from "react";

// @page PAR DÉFAUT de la route : A4 PAYSAGE, marge 8mm (voir print.css —
// dimensions explicites 297mm × 210mm). Import CSS de route : chargé après
// globals.css, il gagne la cascade sur les @page des autres documents.
import "./print.css";

export const dynamic = "force-dynamic";

// Même gabarit que /resultats-fin-annee-doc : page dédiée hors dashboard
// (l'impression des documents est cassée dans le shell — conteneurs
// flex/overflow du shell tronquent l'isolement print). Suspense requis par
// useSearchParams.
export default function BulletinFinAnneeLayout({
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
