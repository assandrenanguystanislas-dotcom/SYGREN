"use client";

import { useSearchParams } from "next/navigation";
import { SyntheseDocument } from "@/components/views/synthese-document";

export default function SynthesePage() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("session_id") ?? "";

  if (!sessionId) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-red-600">Session ID manquant</p>
      </div>
    );
  }

  return <SyntheseDocument sessionId={sessionId} onClose={() => window.close()} />;
}
