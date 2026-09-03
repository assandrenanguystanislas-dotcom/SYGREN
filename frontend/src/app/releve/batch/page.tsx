"use client";

import { useState, useEffect, useCallback } from "react";
import { Loader2, Printer, FileSpreadsheet, ExternalLink, CheckCircle2, AlertCircle } from "lucide-react";
import { canPrintDocument, PrintLockBadge, usePrintRole } from "@/lib/print-guard";

// === Types ===
interface ClassInfo {
  id: string;
  name: string;
  level: string;
  student_count: number;
}

interface Progress {
  current: number;
  total: number;
  currentName: string;
  status: "loading" | "printing" | "done" | "error";
}

// === Helpers ===

// Lit session_id + token depuis l'URL (ou localStorage en fallback).
// Appelé à la demande (useEffect + callbacks) — pas de state, pas de re-render.
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

// Attend que le #releve-doc soit présent dans l'iframe (content loaded + rendered).
// Timeout 30s pour éviter un blocage si l'API échoue.
async function waitForReleveReady(
  iframe: HTMLIFrameElement,
  timeoutMs = 30000
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const doc = iframe.contentDocument;
      if (doc?.querySelector("#releve-doc")) return true;
    } catch {
      // cross-origin (ne devrait pas arriver en same-origin)
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

// === Composant principal ===
export default function ReleveBatchPage() {
  const [classes, setClasses] = useState<ClassInfo[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  // v2 — VERROU D'IMPRESSION : réservé à l'Admin IEP + Super Admin.
  const role = usePrintRole();
  const canPrint = canPrintDocument(role, false);

  // 1. Fetch de la liste des classes au montage
  useEffect(() => {
    const { sid, tok } = getParams();

    if (!sid) {
      // setState async (microtask) pour éviter react-hooks/set-state-in-effect
      Promise.resolve().then(() => {
        setError("session_id est requis dans l'URL");
        setLoading(false);
      });
      return;
    }

    const apiBase = process.env.NEXT_PUBLIC_API_URL || "";
    const separator = apiBase ? "" : "?XTransformPort=8080";
    const url = `${apiBase}/api/reports/releve-classes?session_id=${encodeURIComponent(sid)}${apiBase ? "" : separator}`;

    fetch(url, {
      headers: tok ? { Authorization: `Bearer ${tok}` } : {},
    })
      .then(async (res) => {
        if (!res.ok) {
          const text = await res.text();
          let msg = `HTTP ${res.status}`;
          try {
            const j = JSON.parse(text);
            if (j?.error) msg = j.error;
          } catch {}
          throw new Error(msg);
        }
        return res.json();
      })
      .then((data: { classes: ClassInfo[]; count: number }) => {
        const list = data.classes || [];
        setClasses(list);
        setSelected(new Set(list.map((c) => c.id))); // toutes cochées par défaut
        setLoading(false);
        // Titre onglet indicatif (le batch ne s'imprime pas lui-même, mais le
        // titre aide à identifier l'onglet quand plusieurs sont ouverts).
        document.title = `Relevés PDF — ${list.length} classe(s)`;
      })
      .catch((e: Error) => {
        setError(e.message);
        setLoading(false);
      });
  }, []);

  // 2. Toggle d'une classe
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
      if (prev.size === classes.length) return new Set();
      return new Set(classes.map((c) => c.id));
    });
  }, [classes]);

  // 3. Impression séquentielle des Relevés sélectionnés
  const printSelected = useCallback(async () => {
    const { sid, tok } = getParams();
    if (!sid || selected.size === 0) return;

    const toPrint = classes.filter((c) => selected.has(c.id));
    setProgress({ current: 0, total: toPrint.length, currentName: "", status: "loading" });

    for (let i = 0; i < toPrint.length; i++) {
      const cls = toPrint[i];
      setProgress({ current: i + 1, total: toPrint.length, currentName: cls.name, status: "loading" });

      // Créer un iframe caché (offscreen mais pas display:none — display:none
      // peut casser le rendu d'impression dans certains navigateurs).
      const iframe = document.createElement("iframe");
      iframe.style.position = "fixed";
      iframe.style.right = "-9999px";
      iframe.style.top = "0";
      iframe.style.width = "794px"; // A4 portrait @96dpi
      iframe.style.height = "1123px";
      iframe.src = `${window.location.origin}/releve?session_id=${encodeURIComponent(sid)}&class_id=${encodeURIComponent(cls.id)}&t=${encodeURIComponent(tok)}`;
      document.body.appendChild(iframe);

      // Attendre le chargement du contenu (#releve-doc présent)
      const ready = await waitForReleveReady(iframe);
      if (!ready) {
        console.error(`Timeout chargement Relevé ${cls.name}`);
        iframe.remove();
        setProgress({ current: i + 1, total: toPrint.length, currentName: cls.name, status: "error" });
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }

      // Marge supplémentaire pour le rendu complet (polices, images)
      await new Promise((r) => setTimeout(r, 800));
      setProgress({ current: i + 1, total: toPrint.length, currentName: cls.name, status: "printing" });

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
        // Fallback 5 min (si onafterprint ne fire pas — navigateur exotique)
        setTimeout(done, 300000);

        try {
          win.focus();
          win.print();
        } catch {
          done();
        }
      });

      setProgress({ current: i + 1, total: toPrint.length, currentName: cls.name, status: "done" });
      // Petite pause entre chaque pour laisser le navigateur respirer
      await new Promise((r) => setTimeout(r, 500));
    }

    setProgress(null);
  }, [classes, selected]);

  // === Rendu ===
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-gray-800 mx-auto" />
          <p className="mt-2 text-sm text-gray-600">Chargement des classes…</p>
        </div>
      </div>
    );
  }

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

  const { sid, tok } = getParams();
  const totalStudents = classes.reduce((s, c) => s + c.student_count, 0);

  return (
    <div className="min-h-screen bg-gray-100 print:bg-white print:min-h-0">
      {/* Barre d'outils — cachée à l'impression */}
      <div className="sticky top-0 z-10 bg-white border-b print:hidden">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-gray-900">
              Relevés PDF — Session {sid.slice(0, 8)}…
            </h1>
            <p className="text-xs text-gray-500">
              {classes.length} classe(s) · {totalStudents} élève(s) au total
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
            <strong>Téléchargement des Relevés PDF de la session.</strong> Cliquez
            sur « Imprimer les Relevés sélectionnés » : le navigateur ouvrira
            successivement une boîte de dialogue d&apos;impression pour chaque classe.
            Choisissez « Enregistrer au format PDF » à chaque fois pour obtenir un
            PDF par classe. <strong>Ordre :</strong> CP1 → CP2 → CE1 → CE2 → CM1 → CM2.
          </p>
        </div>

        {/* Bouton d'impression */}
        <div className="flex items-center gap-3 mb-4 print:hidden">
          {canPrint ? null : (
            <PrintLockBadge />
          )}
          <button
            onClick={printSelected}
            disabled={progress !== null || selected.size === 0 || !canPrint}
            className="inline-flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded-md text-sm font-semibold hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {progress ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Printer className="w-4 h-4" />
            )}
            {progress
              ? `Impression en cours… (${progress.current}/${progress.total})`
              : `Imprimer les Relevés sélectionnés (${selected.size})`}
          </button>
          <button
            onClick={toggleAll}
            disabled={progress !== null}
            className="px-3 py-2 text-sm bg-gray-200 rounded hover:bg-gray-300 disabled:opacity-50"
          >
            {selected.size === classes.length ? "Tout décocher" : "Tout cocher"}
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
            {/* Barre de progression */}
            <div className="mt-2 w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
              <div
                className="h-full bg-gray-900 transition-all"
                style={{ width: `${(progress.current / progress.total) * 100}%` }}
              />
            </div>
          </div>
        )}

        {/* Liste des classes */}
        <div className="bg-white border rounded-lg overflow-hidden print:hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="p-2 text-left w-8">
                  <input
                    type="checkbox"
                    checked={selected.size === classes.length && classes.length > 0}
                    onChange={toggleAll}
                    disabled={progress !== null}
                    className="w-4 h-4"
                  />
                </th>
                <th className="p-2 text-left font-semibold">Classe</th>
                <th className="p-2 text-left font-semibold">Niveau</th>
                <th className="p-2 text-right font-semibold">Élèves</th>
                <th className="p-2 text-center font-semibold">Ouvrir</th>
              </tr>
            </thead>
            <tbody>
              {classes.map((c) => (
                <tr key={c.id} className="border-b last:border-0 hover:bg-gray-50">
                  <td className="p-2">
                    <input
                      type="checkbox"
                      checked={selected.has(c.id)}
                      onChange={() => toggle(c.id)}
                      disabled={progress !== null}
                      className="w-4 h-4"
                    />
                  </td>
                  <td className="p-2 font-medium">{c.name}</td>
                  <td className="p-2 text-gray-600">{c.level}</td>
                  <td className="p-2 text-right">{c.student_count}</td>
                  <td className="p-2 text-center">
                    <a
                      href={`${window.location.origin}/releve?session_id=${encodeURIComponent(sid)}&class_id=${encodeURIComponent(c.id)}&t=${encodeURIComponent(tok)}`}
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
              {classes.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-4 text-center text-gray-500">
                    Aucune classe active trouvée pour cette session.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Note de bas de page */}
        <p className="mt-4 text-xs text-gray-400 print:hidden">
          <FileSpreadsheet className="w-3 h-3 inline mr-1" />
          Astuce : pour un seul PDF contenant toutes les classes, imprimez chaque
          classe en PDF puis fusionnez-les avec un outil externe (ou utilisez la
          fonction « Synthèse » pour un document global par niveau).
        </p>
      </div>
    </div>
  );
}
