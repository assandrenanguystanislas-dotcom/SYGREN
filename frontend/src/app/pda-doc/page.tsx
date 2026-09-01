"use client";

// === Document officiel du plan d'action IEPP — page dédiée ===
// Pattern /synthese : le document vit sur sa propre page (hors dashboard),
// car l'isolement print (#pda-doc) est tronqué par les conteneurs
// flex/overflow du shell. Ouverte dans un nouvel onglet par pda-view.tsx
// (window.open), « Fermer » referme l'onglet (window.close).
// Query params : exam_id (requis), class_id (requis).

import { useSearchParams } from "next/navigation";

import { Providers } from "@/components/providers";
import { PdaDocument } from "@/components/views/pda-document";

function PdaDocPageInner() {
  const params = useSearchParams();
  const examId = params.get("exam_id") ?? "";
  const classId = params.get("class_id") ?? "";

  if (!examId || !classId) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-destructive mb-3">
            Paramètres manquants (exam_id et class_id requis)
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
    <PdaDocument
      examId={examId}
      classId={classId}
      onClose={() => window.close()}
    />
  );
}

export default function PdaDocPage() {
  return (
    <Providers>
      <PdaDocPageInner />
    </Providers>
  );
}
