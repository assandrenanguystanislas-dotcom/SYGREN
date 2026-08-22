"use client";

import { useState, useCallback, useRef } from "react";
import * as XLSX from "xlsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Upload, FileSpreadsheet, CheckCircle2, AlertCircle, X } from "lucide-react";
import { studentsApi } from "@/lib/api";

// === Types ===
interface ParsedStudent {
  row: number; // 1-based, ligne Excel (hors en-tête)
  matricule: string;
  last_name: string;
  first_name: string;
  gender_raw: string; // "MASCULIN"/"FEMININ" tel que lu
  class_name: string; // "CP2"
  // Erreurs de validation côté frontend (preview)
  errors: string[];
}

interface ImportResult {
  created: number;
  skipped: { row: number; matricule?: string; reason: string }[];
  failed: { row: number; matricule?: string; reason: string }[];
  total: number;
}

interface ImportStudentsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  schoolId: string; // école cible (director: son école ; admin: école sélectionnée)
  onImported?: () => void; // callback pour rafraîchir la liste après import
}

// === Helpers ===

// Normalise un en-tête : lowercase, sans accents, trim. "Prénoms" → "prenoms".
function normalizeHeader(s: string): string {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

// Convertit le genre : MASCULIN/M/MALE/G → "M", FEMININ/F/FEMALE → "F", "" sinon.
function convertGender(s: string): "M" | "F" | "" {
  const n = s.toUpperCase().trim();
  if (["MASCULIN", "M", "MALE", "G"].includes(n)) return "M";
  if (["FEMININ", "F", "FEMALE"].includes(n)) return "F";
  return "";
}

// Parse le fichier Excel (.xls/.xlsx) via SheetJS → tableau d'élèves + validation.
async function parseExcel(file: File): Promise<ParsedStudent[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error("Aucune feuille dans le fichier");
  const sheet = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false });
  if (rows.length < 2) throw new Error("Fichier vide (aucun élève après l'en-tête)");

  // En-têtes normalisés (ligne 0)
  const headers = (rows[0] as unknown[]).map((h) => normalizeHeader(String(h ?? "")));

  // Trouver l'index de chaque colonne (synonymes acceptés)
  const findCol = (synonyms: string[]): number => {
    for (const syn of synonyms) {
      const idx = headers.indexOf(syn);
      if (idx >= 0) return idx;
    }
    return -1;
  };
  const idxMatricule = findCol(["matricule", "matricul", "matr"]);
  const idxNom = findCol(["nom", "lastname", "last_name", "surname"]);
  const idxPrenoms = findCol(["prenoms", "prenom", "first_name", "firstname", "forename"]);
  const idxSexe = findCol(["sexe", "sex", "gender", "genre"]);
  const idxNiveau = findCol(["niveau", "classe", "class", "level"]);

  // Colonnes obligatoires (matricule optionnel)
  const missing: string[] = [];
  if (idxNom < 0) missing.push("nom");
  if (idxPrenoms < 0) missing.push("prenoms");
  if (idxSexe < 0) missing.push("sexe");
  if (idxNiveau < 0) missing.push("niveau");
  if (missing.length > 0) {
    throw new Error(`Colonnes manquantes : ${missing.join(", ")}. Colonnes trouvées : ${headers.filter((h) => h).join(", ") || "(aucune)"}`);
  }

  // Parser les lignes de données
  const students: ParsedStudent[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] as unknown[];
    if (!row || row.every((c) => c === null || c === undefined || String(c).trim() === "")) continue;

    const matricule = idxMatricule >= 0 ? String(row[idxMatricule] ?? "").trim() : "";
    const last_name = String(row[idxNom] ?? "").trim();
    const first_name = String(row[idxPrenoms] ?? "").trim();
    const gender_raw = String(row[idxSexe] ?? "").trim();
    const class_name = String(row[idxNiveau] ?? "").trim();

    // Validation côté frontend (erreurs potentielles, flaggées dans le preview)
    const errors: string[] = [];
    if (!last_name) errors.push("nom vide");
    if (!first_name) errors.push("prénoms vides");
    if (!class_name) errors.push("niveau vide");
    if (convertGender(gender_raw) === "") errors.push(`genre invalide : "${gender_raw}"`);

    students.push({
      row: i + 1, // 1-based ligne Excel (ligne 1 = en-tête, donc i+1 = ligne réelle)
      matricule,
      last_name,
      first_name,
      gender_raw,
      class_name,
      errors,
    });
  }
  return students;
}

// === Composant ===
export function ImportStudentsDialog({ open, onOpenChange, schoolId, onImported }: ImportStudentsDialogProps) {
  const [fileName, setFileName] = useState("");
  const [parsed, setParsed] = useState<ParsedStudent[] | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reset = useCallback(() => {
    setFileName("");
    setParsed(null);
    setParseError(null);
    setParsing(false);
    setImporting(false);
    setResult(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const handleFile = useCallback(async (file: File) => {
    setParsing(true);
    setParseError(null);
    setParsed(null);
    setResult(null);
    setFileName(file.name);
    try {
      const students = await parseExcel(file);
      setParsed(students);
    } catch (e) {
      setParseError(e instanceof Error ? e.message : String(e));
    } finally {
      setParsing(false);
    }
  }, []);

  const handleImport = useCallback(async () => {
    if (!parsed || parsed.length === 0 || !schoolId) return;
    setImporting(true);
    setResult(null);
    try {
      const res = await studentsApi.bulkCreate({
        school_id: schoolId,
        students: parsed.map((p) => ({
          matricule: p.matricule || undefined,
          first_name: p.first_name,
          last_name: p.last_name,
          gender: convertGender(p.gender_raw) || p.gender_raw, // M/F, ou raw (backend normalisera/échouera)
          class_name: p.class_name,
        })),
      });
      setResult(res);
      if (res.created > 0 && onImported) onImported();
    } catch (e) {
      setParseError(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
    }
  }, [parsed, schoolId, onImported]);

  const errorCount = parsed?.filter((p) => p.errors.length > 0).length ?? 0;
  const validCount = parsed ? parsed.length - errorCount : 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5" />
            Importer des élèves depuis Excel
          </DialogTitle>
          <DialogDescription>
            Sélectionnez un fichier Excel (.xls ou .xlsx) contenant les colonnes :
            <span className="font-mono text-xs"> matricule, nom, prenoms, sexe, niveau</span>.
            Les matricules existants seront ignorés (skip), les classes introuvables signalées.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Input fichier */}
          <div className="flex items-center gap-3">
            <Input
              ref={fileInputRef}
              type="file"
              accept=".xls,.xlsx,.csv"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
              disabled={parsing || importing}
              className="flex-1"
            />
            {fileName && (
              <span className="text-xs text-gray-500 truncate max-w-[200px]">{fileName}</span>
            )}
          </div>

          {/* Parsing en cours */}
          {parsing && (
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <Loader2 className="w-4 h-4 animate-spin" />
              Analyse du fichier…
            </div>
          )}

          {/* Erreur de parsing */}
          {parseError && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded p-3 text-sm text-red-700">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-semibold">Erreur</p>
                <p className="text-xs">{parseError}</p>
              </div>
            </div>
          )}

          {/* Résumé du parsing */}
          {parsed && (
            <div className="bg-gray-50 border rounded p-3">
              <div className="flex items-center gap-4 text-sm">
                <span className="font-semibold">{parsed.length} élèves</span>
                <span className="text-emerald-600">{validCount} valides</span>
                {errorCount > 0 && (
                  <span className="text-red-600">{errorCount} avec erreurs potentielles</span>
                )}
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Les lignes en erreur (genre invalide, classe introuvable) seront signalées
                par le backend dans <code>failed[]</code>. Les matricules déjà en base seront
                dans <code>skipped[]</code>.
              </p>
            </div>
          )}

          {/* Preview table (10 premières lignes) */}
          {parsed && parsed.length > 0 && (
            <div className="border rounded overflow-hidden">
              <div className="max-h-80 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="bg-gray-100 sticky top-0">
                    <tr>
                      <th className="p-1.5 text-left">Ligne</th>
                      <th className="p-1.5 text-left">Matricule</th>
                      <th className="p-1.5 text-left">Nom</th>
                      <th className="p-1.5 text-left">Prénoms</th>
                      <th className="p-1.5 text-left">Sexe</th>
                      <th className="p-1.5 text-left">Niveau</th>
                      <th className="p-1.5 text-left">Erreurs</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.slice(0, 10).map((p, i) => (
                      <tr key={i} className={p.errors.length > 0 ? "bg-red-50" : (i % 2 === 0 ? "bg-white" : "bg-gray-50")}>
                        <td className="p-1.5">{p.row}</td>
                        <td className="p-1.5 font-mono">{p.matricule || "—"}</td>
                        <td className="p-1.5">{p.last_name || <span className="text-red-500">(vide)</span>}</td>
                        <td className="p-1.5 truncate max-w-[180px]">{p.first_name || <span className="text-red-500">(vide)</span>}</td>
                        <td className="p-1.5">{p.gender_raw}</td>
                        <td className="p-1.5 font-medium">{p.class_name}</td>
                        <td className="p-1.5 text-red-600 text-[10px]">{p.errors.join(", ") || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {parsed.length > 10 && (
                <div className="bg-gray-100 p-2 text-center text-xs text-gray-500">
                  … et {parsed.length - 10} autres lignes (preview tronquée)
                </div>
              )}
            </div>
          )}

          {/* Résultat de l'import */}
          {result && (
            <div className="bg-emerald-50 border border-emerald-200 rounded p-4 space-y-2">
              <div className="flex items-center gap-2 text-emerald-700 font-semibold">
                <CheckCircle2 className="w-5 h-5" />
                Import terminé
              </div>
              <div className="grid grid-cols-4 gap-2 text-sm">
                <div className="text-center">
                  <div className="text-2xl font-bold text-emerald-700">{result.created}</div>
                  <div className="text-xs text-gray-600">Créés</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-amber-600">{result.skipped.length}</div>
                  <div className="text-xs text-gray-600">Ignorés (doublons)</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-red-600">{result.failed.length}</div>
                  <div className="text-xs text-gray-600">Échoués</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-gray-700">{result.total}</div>
                  <div className="text-xs text-gray-600">Total</div>
                </div>
              </div>
              {result.failed.length > 0 && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-red-600 font-medium">
                    {result.failed.length} échec(s) — cliquer pour détails
                  </summary>
                  <ul className="mt-1 space-y-0.5 max-h-32 overflow-y-auto">
                    {result.failed.slice(0, 50).map((f, i) => (
                      <li key={i} className="text-red-700">
                        Ligne {f.row} {f.matricule ? `(${f.matricule})` : ""} : {f.reason}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {result.skipped.length > 0 && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-amber-600 font-medium">
                    {result.skipped.length} ignoré(s) — cliquer pour détails
                  </summary>
                  <ul className="mt-1 space-y-0.5 max-h-32 overflow-y-auto">
                    {result.skipped.slice(0, 50).map((s, i) => (
                      <li key={i} className="text-amber-700">
                        Ligne {s.row} {s.matricule ? `(${s.matricule})` : ""} : {s.reason}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => { reset(); onOpenChange(false); }}>
            <X className="w-4 h-4 mr-1.5" />
            Fermer
          </Button>
          {!result && (
            <Button onClick={handleImport} disabled={!parsed || parsed.length === 0 || importing || !schoolId}>
              {importing ? (
                <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
              ) : (
                <Upload className="w-4 h-4 mr-1.5" />
              )}
              {importing ? "Import en cours…" : `Importer ${parsed?.length ?? 0} élèves`}
            </Button>
          )}
          {result && (
            <Button onClick={() => { reset(); onOpenChange(false); }}>
              <CheckCircle2 className="w-4 h-4 mr-1.5" />
              Terminé
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
