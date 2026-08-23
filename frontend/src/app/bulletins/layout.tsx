"use client";

import { Suspense, type ReactNode } from "react";

// Layout minimal pour la page d'impression /bulletins.
// Pas de sidebar, pas de header SYGREN — uniquement le document brut.
// force-dynamic : la page doit toujours être rendue côté client car
// elle lit l'URL (?session_id=…&t=…) et déclenche window.print().
export const dynamic = "force-dynamic";

export default function BulletinsLayout({
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
