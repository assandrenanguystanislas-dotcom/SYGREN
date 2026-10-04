"use client";

// Task 73 — BARRE D'ACTIONS DE LA SÉLECTION (partagée) : affichée dès
// qu'au moins une ligne est cochée dans un tableau — compte des lignes
// cochées + boutons fournis par la vue (« Exporter la sélection » si
// onExport — réservé au Super Admin par la vue, Task 71 — et
// « Supprimer la sélection » si onDelete) + « Désélectionner ».
// Fond orange pâle (primary) — même visuel que la barre du Fichier du
// personnel (Task 72).
import { FileSpreadsheet, Loader2, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";

interface SelectionActionsBarProps {
  /** Texte du compte, ex : « 3 élèves sélectionnés sur 42 affichés ». */
  label: string;
  exporting?: boolean;
  deleting?: boolean;
  onExport?: () => void;
  onDelete?: () => void;
  onClear: () => void;
}

export function SelectionActionsBar({
  label,
  exporting = false,
  deleting = false,
  onExport,
  onDelete,
  onClear,
}: SelectionActionsBarProps) {
  const busy = exporting || deleting;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-primary/25 bg-primary/5 px-3 py-2">
      <span className="text-sm font-semibold text-primary">{label}</span>
      <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
        {onExport && (
          <Button
            variant="outline"
            size="sm"
            onClick={onExport}
            disabled={busy}
            className="shadow-sm"
          >
            {exporting ? (
              <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
            ) : (
              <FileSpreadsheet className="w-4 h-4 mr-1.5" />
            )}
            Exporter la sélection
          </Button>
        )}
        {onDelete && (
          <Button
            variant="destructive"
            size="sm"
            onClick={onDelete}
            disabled={busy}
            className="shadow-sm"
          >
            {deleting ? (
              <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
            ) : (
              <Trash2 className="w-4 h-4 mr-1.5" />
            )}
            Supprimer la sélection
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={onClear} disabled={busy}>
          <X className="w-4 h-4 mr-1.5" />
          Désélectionner
        </Button>
      </div>
    </div>
  );
}
