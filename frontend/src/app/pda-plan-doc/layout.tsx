"use client";

import { Suspense, type ReactNode } from "react";

export const dynamic = "force-dynamic";

// Même gabarit que /pda-doc et /pda-timeline-doc : page dédiée hors dashboard
// (l'impression des documents est cassée dans le shell — conteneurs
// flex/overflow du shell tronquent l'isolement print). Suspense requis par
// useSearchParams.
export default function PdaPlanDocLayout({
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
