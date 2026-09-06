"use client";

import { Suspense, type ReactNode } from "react";

// Task 37 — @page PAR DÉFAUT A4 PAYSAGE pour la route /synthese (importé
// APRÈS globals.css → gagne la cascade sur cette route uniquement ; les
// pages nommées ne sont pas supportées par tous les moteurs d'impression).
import "./print.css";

export const dynamic = "force-dynamic";

export default function SyntheseLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><p>Chargement…</p></div>}>{children}</Suspense>;
}
