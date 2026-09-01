"use client";

// === Document officiel du SUIVI PLURIANNUEL — page dédiée ===
// Pattern /synthese : le document vit sur sa propre page (hors dashboard),
// car l'isolement print (#pda-tl-doc) est tronqué par les conteneurs
// flex/overflow du shell. Ouverte dans un nouvel onglet par
// pda-timeline-view.tsx (window.open), « Fermer » referme l'onglet.
// Query params : class_id (requis), year (requis).

import { useSearchParams } from "next/navigation";

import { Providers } from "@/components/providers";
import { PdaTimelineDocument } from "@/components/views/pda-timeline-document";

function PdaTimelineDocPageInner() {
  const params = useSearchParams();
  const classId = params.get("class_id") ?? "";
  const year = Number(params.get("year") ?? "");

  if (!classId || !Number.isFinite(year) || year < 2000 || year > 2100) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-destructive mb-3">
            Paramètres manquants ou invalides (class_id et year requis)
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
    <PdaTimelineDocument
      classId={classId}
      year={year}
      onClose={() => window.close()}
    />
  );
}

export default function PdaTimelineDocPage() {
  return (
    <Providers>
      <PdaTimelineDocPageInner />
    </Providers>
  );
}
