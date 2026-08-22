"use client";

import { useState, useEffect, useCallback } from "react";
import { Loader2, Printer, FileText, ExternalLink, CheckCircle2, AlertCircle } from "lucide-react";

// === Types ===
// Les 2 documents Synthèse sont FIXES (pas d'endpoint backend à appeler,
// contrairement au batch Relevé qui liste les classes dynamiquement).
interface SyntheseDoc {
  id: "primary" | "cm2";       // level_group passé au /synthese
  label: string;               // affiché dans la table
  description: string;          // sous-titre (périmètre du document)
}

const DOCUMENTS: SyntheseDoc[] = [
  { id: "primary", label: "Synthèse CP1-CM1", description: "Document principal (CP1 au CM1)" },
  { id: "cm2", label: "Synthèse CM2", description: "Fin de cycle primaire (CM2 seul)" },
];

interface Progress {
  current: number;
  total: number;
  currentName: string;
  status: "loading" | "printing" | "done" | "error";
}

// === Helpers ===

// Lit session_id + token depuis l'URL (ou localStorage en fallback).
function getParams(): { sid: string; tok: string } {
  const params = new URLSearchParams(window.location.search);
  const sid = params.get("session_id") || "";
  let tok = "";
  const urlToken = params.get("t");
  if (urlToken) {
    tok = urlToken;
  } else {
    try {
      const raw = localStorage.getItem("sygren-auth");
      if (raw) tok = JSON.parse(raw)?.state?.token ?? "";
    } catch {}
  }
  return { sid, tok };
}

// Attend que le #synthese-doc soit présent dans l'iframe (content loaded + rendered).
// Timeout 30s (la synthèse est plus lourde que le relevé — paysage A4, 6 niveaux).
async function waitForSyntheseReady(
  iframe: HTMLIFrameElement,
  timeoutMs = 45000
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const doc = iframe.contentDocument;
      if (doc?.querySelector("#synthese-doc")) return true;
    } catch {
      // cross-origin (ne devrait pas arriver en same-origin)
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

// === Composant principal ===
export default function SyntheseBatchPage() {
  const [selected, setSelected] = useState<Set<string>>(new Set(DOCUMENTS.map((d) => d.id)));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);

  // 1. Vérification session_id au montage (pas de state pour les params —
  // getParams() lu à la demande dans le render, APRÈS le guard loading
  // pour éviter "window is not defined" pendant le pre-render SSR).
  // setState wrappés en microtask (Promise.resolve) pour éviter
  // react-hooks/set-state-in-effect (même pattern que le batch Relevé).
  useEffect(() => {
    const { sid } = getParams();
    Promise.resolve().then(() => {
      if (!sid) {
        setError("session_id est requis dans l'URL");
        setLoading(false);
        return;
      }
      // document.title indicatif pour l'onglet.
      document.title = `Synthèses PDF — ${DOCUMENTS.length} document(s)`;
      setLoading(false);
    });
  }, []);

  // 2. Toggle d'un document
  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelected((prev) => {
      if (prev.size === DOCUMENTS.length) return new Set();
      return new Set(DOCUMENTS.map((d) => d.id));
    });
  }, []);

  // 3. Impression séquentielle des Synthèses sélectionnées
  const printSelected = useCallback(async () => {
    const { sid, tok } = getParams();
    if (!sid || selected.size === 0) return;

    const toPrint = DOCUMENTS.filter((d) => selected.has(d.id));
    setProgress({ current: 0, total: toPrint.length, currentName: "", status: "loading" });

    for (let i = 0; i < toPrint.length; i++) {
      const doc = toPrint[i];
      setProgress({ current: i + 1, total: toPrint.length, currentName: doc.label, status: "loading" });

      // Créer un iframe caché (offscreen, pas display:none — display:none peut
      // casser le rendu d'impression dans certains navigateurs).
      // Viewport paysage A4 (297x210mm @96dpi ≈ 1123x794px) car la synthèse est paysage.
      const iframe = document.createElement("iframe");
      iframe.style.position = "fixed";
      iframe.style.right = "-9999px";
      iframe.style.top = "0";
      iframe.style.width = "1123px"; // A4 paysage @96dpi
      iframe.style.height = "794px";
      iframe.src = `${window.location.origin}/synthese?session_id=${encodeURIComponent(sid)}&level_group=${doc.id}&t=${encodeURIComponent(tok)}`;
      document.body.appendChild(iframe);

      // Attendre le chargement du contenu (#synthese-doc présent)
      const ready = await waitForSyntheseReady(iframe);
      if (!ready) {
        console.error(`Timeout chargement ${doc.label}`);
        iframe.remove();
        setProgress({ current: i + 1, total: toPrint.length, currentName: doc.label, status: "error" });
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }

      // Marge supplémentaire pour le rendu complet (polices, images)
      await new Promise((r) => setTimeout(r, 1000));
      setProgress({ current: i + 1, total: toPrint.length, currentName: doc.label, status: "printing" });

      // Lancer l'impression et attendre la fermeture du dialog (onafterprint)
      await new Promise<void>((resolve) => {
        const win = iframe.contentWindow;
        if (!win) {
          iframe.remove();
          resolve();
          return;
        }

        let resolved = false;
        const done = () => {
          if (resolved) return;
          resolved = true;
          iframe.remove();
          resolve();
        };

        // onafterprint = l'utilisateur a fermé le dialog (imprimé/sauvé/annulé)
        win.onafterprint = done;
        // Fallback 5 min (si onafterprint ne fire pas)
        setTimeout(done, 300000);

        try {
          win.focus();
          win.print();
        } catch {
          done();
        }
      });

      setProgress({ current: i + 1, total: toPrint.length, currentName: doc.label, status: "done" });
      await new Promise((r) => setTimeout(r, 500));
    }

    setProgress(null);
  }, [selected]);

  // === Rendu ===
  // Guard loading AVANT getParams() — sinon "window is not defined" en SSR.
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <Loader2 className="w-8 h-8 animate-spin text-gray-800" />
      </div>
    );
  }
  const { sid, tok } = getParams();
  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="text-center max-w-md">
          <AlertCircle className="w-10 h-10 text-red-600 mx-auto" />
          <p className="mt-2 text-red-600 font-semibold">{error}</p>
          <button
            onClick={() => window.close()}
            className="mt-4 px-4 py-2 bg-gray-200 rounded text-sm"
          >
            Fermer
          </button>
        </div>
      </div>
    );
  }

  if (!sid) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <Loader2 className="w-8 h-8 animate-spin text-gray-800" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 print:bg-white print:min-h-0">
      {/* Barre d'outils — cachée à l'impression */}
      <div className="sticky top-0 z-10 bg-white border-b print:hidden">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-gray-900">
              Synthèses PDF — Session {sid.slice(0, 8)}…
            </h1>
            <p className="text-xs text-gray-500">
              {DOCUMENTS.length} document(s) disponible(s)
            </p>
          </div>
          <button
            onClick={() => window.close()}
            className="px-3 py-1.5 text-sm bg-gray-200 rounded hover:bg-gray-300"
          >
            Fermer
          </button>
        </div>
      </div>

      <div className="max-w-3xl mx-auto p-4 print:p-0 print:max-w-none">
        {/* Explication */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4 print:hidden">
          <p className="text-sm text-blue-900">
            <strong>Téléchargement des Synthèses PDF de la session.</strong> Cliquez
            sur « Imprimer les Synthèses sélectionnées » : le navigateur ouvrira
            successivement une boîte de dialogue d&apos;impression pour chaque
            document. Choisissez « Enregistrer au format PDF » à chaque fois.
            <strong> Ordre :</strong> CP1-CM1 (document principal) → CM2 (fin de cycle).
          </p>
        </div>

        {/* Bouton d'impression */}
        <div className="flex items-center gap-3 mb-4 print:hidden">
          <button
            onClick={printSelected}
            disabled={progress !== null || selected.size === 0}
            className="inline-flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded-md text-sm font-semibold hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {progress ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Printer className="w-4 h-4" />
            )}
            {progress
              ? `Impression en cours… (${progress.current}/${progress.total})`
              : `Imprimer les Synthèses sélectionnées (${selected.size})`}
          </button>
          <button
            onClick={toggleAll}
            disabled={progress !== null}
            className="px-3 py-2 text-sm bg-gray-200 rounded hover:bg-gray-300 disabled:opacity-50"
          >
            {selected.size === DOCUMENTS.length ? "Tout décocher" : "Tout cocher"}
          </button>
        </div>

        {/* Progression */}
        {progress && (
          <div className="bg-white border rounded-lg p-4 mb-4 print:hidden">
            <div className="flex items-center gap-2">
              {progress.status === "done" ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-600" />
              ) : progress.status === "error" ? (
                <AlertCircle className="w-5 h-5 text-red-600" />
              ) : (
                <Loader2 className="w-5 h-5 animate-spin text-gray-600" />
              )}
              <span className="text-sm font-semibold">
                {progress.current}/{progress.total} — {progress.currentName}{" "}
                {progress.status === "loading" && "(chargement…)"}
                {progress.status === "printing" && "(impression — sauvegardez le PDF)"}
                {progress.status === "done" && "(terminé)"}
                {progress.status === "error" && "(échec chargement)"}
              </span>
            </div>
            <div className="mt-2 w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
              <div
                className="h-full bg-gray-900 transition-all"
                style={{ width: `${(progress.current / progress.total) * 100}%` }}
              />
            </div>
          </div>
        )}

        {/* Liste des documents */}
        <div className="bg-white border rounded-lg overflow-hidden print:hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="p-2 text-left w-8">
                  <input
                    type="checkbox"
                    checked={selected.size === DOCUMENTS.length && DOCUMENTS.length > 0}
                    onChange={toggleAll}
                    disabled={progress !== null}
                    className="w-4 h-4"
                  />
                </th>
                <th className="p-2 text-left font-semibold">Document</th>
                <th className="p-2 text-left font-semibold">Périmètre</th>
                <th className="p-2 text-center font-semibold">Ouvrir</th>
              </tr>
            </thead>
            <tbody>
              {DOCUMENTS.map((d) => (
                <tr key={d.id} className="border-b last:border-0 hover:bg-gray-50">
                  <td className="p-2">
                    <input
                      type="checkbox"
                      checked={selected.has(d.id)}
                      onChange={() => toggle(d.id)}
                      disabled={progress !== null}
                      className="w-4 h-4"
                    />
                  </td>
                  <td className="p-2 font-medium">{d.label}</td>
                  <td className="p-2 text-gray-600">{d.description}</td>
                  <td className="p-2 text-center">
                    <a
                      href={`${window.location.origin}/synthese?session_id=${encodeURIComponent(sid)}&level_group=${d.id}&t=${encodeURIComponent(tok)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 text-xs"
                    >
                      <ExternalLink className="w-3 h-3" />
                      Aperçu
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Note de bas de page */}
        <p className="mt-4 text-xs text-gray-400 print:hidden">
          <FileText className="w-3 h-3 inline mr-1" />
          La Synthèse est un document A4 paysage (1 page par niveau). Chaque document
          couvre un périmètre différent : CP1-CM1 (principal) et CM2 (fin de cycle primaire).
        </p>
      </div>
    </div>
  );
}
