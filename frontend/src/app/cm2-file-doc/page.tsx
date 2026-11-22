"use client";

// === Document « FICHIER SECTEUR {X} — ÉLÈVES DE CM2 » — page dédiée
// (module Résultats — Task 86 : « mettre aussi en version pdf et word
// imprimable »). Pattern /liste-candidats-doc : le document vit sur sa
// propre page (hors dashboard), ouverte dans un nouvel onglet par
// cm2-files-view.tsx (bouton « Imprimer / PDF / Word » — window.open),
// « Fermer » referme l'onglet (window.close).
// Query params : year (année, requis), number (N° composition, requis),
// secteur (id ou « hors », requis), t (token, requis).

import { useSearchParams } from "next/navigation";

import { Providers } from "@/components/providers";
import { Cm2FileDocument } from "@/components/views/cm2-file-document";
import { storeUrlTokenIfPresent } from "@/lib/print-guard";

function Cm2FileDocPageInner() {
  // Token de l'URL → localStorage (AVANT les requêtes des composants)
  storeUrlTokenIfPresent();
  const params = useSearchParams();
  const year = Number(params.get("year") ?? "");
  const number = Number(params.get("number") ?? "");
  const secteur = params.get("secteur") ?? "";

  if (!params.get("year") || !params.get("number") || !secteur ||
      !Number.isFinite(year) || !Number.isFinite(number) ||
      year < 2000 || year > 2100 || number < 1 || number > 20) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-destructive mb-3">
            Paramètre manquant ou invalide (year, number et secteur requis)
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
    <Cm2FileDocument
      year={year}
      number={number}
      secteur={secteur}
      onClose={() => window.close()}
    />
  );
}

export default function Cm2FileDocPage() {
  return (
    <Providers>
      <Cm2FileDocPageInner />
    </Providers>
  );
}
