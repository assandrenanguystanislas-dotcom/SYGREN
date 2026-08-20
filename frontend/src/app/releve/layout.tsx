"use client";

import { Suspense, type ReactNode } from "react";

export const dynamic = "force-dynamic";

export default function ReleveLayout({
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
