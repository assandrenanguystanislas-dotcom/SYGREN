"use client";

// === Document réseau du PLAN D'ACTION PLURIANNUEL DE L'IEPP — page dédiée ===
// Pattern /pda-doc : le document vit sur sa propre page (hors dashboard),
// car l'isolement print est tronqué par les conteneurs flex/overflow du
// shell. Ouverte dans un nouvel onglet par pda-view.tsx (window.open),
// « Fermer » referme l'onglet (window.close).
// Query params : year (requis), number (requis), kind (blanc|composition).

import { useSearchParams } from "next/navigation";

import { Providers } from "@/components/providers";
import { PdaPlanDocument } from "@/components/views/pda-plan-document";

function PdaPlanDocPageInner() {
  const params = useSearchParams();
  const year = Number(params.get("year") ?? "");
  const number = Number(params.get("number") ?? "");
  const kind = params.get("kind") === "composition" ? "composition" : "blanc";

  if (
    !Number.isFinite(year) ||
    year < 2000 ||
    year > 2100 ||
    !Number.isFinite(number) ||
    number < 1
  ) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-destructive mb-3">
            Paramètres manquants ou invalides (year et number requis)
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
    <PdaPlanDocument
      year={year}
      number={number}
      kind={kind}
      onClose={() => window.close()}
    />
  );
}

export default function PdaPlanDocPage() {
  return (
    <Providers>
      <PdaPlanDocPageInner />
    </Providers>
  );
}
