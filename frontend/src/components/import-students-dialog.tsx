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
import { Loader2, FileSpreadsheet, CheckCircle2, AlertCircle, X, UserPlus, Users } from "lucide-react";
import { studentsApi } from "@/lib/api";

// === Types ===
// Exporté : students-view.tsx construit le formulaire « Inscrire un élève »
// pré-rempli à partir d'une ligne parsée (saisie assistée depuis le fichier).
export interface ParsedStudent {
  row: number; // 1-based, ligne Excel (hors en-tête)
  matricule: string;
  last_name: string;
  first_name: string;
  gender_raw: string; // "MASCULIN"/"FEMININ" tel que lu
  class_name: string; // "CP2"
  // État civil facultatif (colonnes supplémentaires, vide = non renseigné)
  nationality: string; // nationalité
  birth_place: string; // lieu de naissance
  father_name: string; // nom et prénoms du père
  mother_name: string; // nom et prénoms de la mère
  acte_number: string; // n° de l'acte de naissance
  acte_date: string; // date de l'acte (jj/mm/aaaa)
  acte_place: string; // lieu d'établissement de l'acte
  // Naissance — colonnes « jour », « mois », « annee » (séparées) OU
  // colonne unique « date de naissance » (jj/mm/aaaa). 0 = non renseigné.
  // RÉPERCUSSION (demande utilisateur) : ces valeurs alimentent ensuite le
  // formulaire « Modifier l'élève » (pré-remplissage openEdit).
  birth_day: number; // 1..31 — 0 = absent/vide
  birth_month: number; // 1..12 — 0 = absent/vide
  birth_year: number; // ex: 2016 — 0 = absent/vide
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
  // Saisie assistée (demande utilisateur : « le fichier importé doit aider à
  // compléter le formulaire Inscrire un élève ») : le bouton « Inscrire »
  // d'une ligne du preview passe la main au formulaire « Inscrire un élève »
  // pré-rempli avec CETTE ligne. Le parent reçoit la liste complète des
  // lignes parsées + l'index de départ : après chaque inscription réussie,
  // le formulaire avance automatiquement à la ligne suivante.
  onRegisterRow?: (rows: ParsedStudent[], index: number) => void;
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
// Exporté : réutilisé par students-view (pré-remplissage du formulaire).
export function convertGender(s: string): "M" | "F" | "" {
  const n = s.toUpperCase().trim();
  if (["MASCULIN", "M", "MALE", "G"].includes(n)) return "M";
  if (["FEMININ", "F", "FEMALE"].includes(n)) return "F";
  return "";
}

// Cellule → chaîne propre. Les dates Excel (cellules au format date, ex :
// "date acte") sont converties en jj/mm/aaaa au lieu de "Mon Jan 05 2016…".
function cellToString(c: unknown): string {
  if (c === null || c === undefined) return "";
  if (c instanceof Date) {
    return dateToStr(c);
  }
  return String(c).trim();
}

function dateToStr(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

// Noms de mois français (texte libre « janv. », « janvier »…) → 1..12.
// Certaines feuilles saisissent le mois en toutes lettres dans « mois ».
const MONTHS_MAP: Record<string, number> = {
  jan: 1, janv: 1, janvier: 1,
  fev: 2, fevr: 2, fevrier: 2,
  mar: 3, mars: 3,
  avr: 4, avril: 4,
  mai: 5,
  jun: 6, juin: 6,
  jul: 7, juillet: 7,
  au: 8, aou: 8, aug: 8, aout: 8,
  sep: 9, sept: 9, septembre: 9,
  oct: 10, octobre: 10,
  nov: 11, novembre: 11,
  dec: 12, decembre: 12,
};

// Cellule → entier (jour / mois / année). Retourne 0 si vide/absent.
// Accepte : nombre Excel (5), texte "5", "05", texte avec espaces.
// Pour le mois : accepte aussi les noms français ("janvier" → 1).
// Retourne -1 si la cellule est NON vide mais illisible (→ erreur preview).
function cellToInt(c: unknown, isMonth = false): number {
  if (c === null || c === undefined || c === "") return 0;
  if (typeof c === "number" && Number.isFinite(c)) {
    return Math.trunc(c);
  }
  const s = String(c).trim();
  if (s === "") return 0;
  if (/^\d{1,4}$/.test(s)) return parseInt(s, 10);
  if (isMonth) {
    const m = MONTHS_MAP[s.toLowerCase().replace(/[^a-zà-ÿ]/g, "")];
    if (m) return m;
  }
  return -1; // non vide mais illisible
}

// Colonne « date de naissance » combinée → { d, m, y }. Accepte :
//  - Date SheetJS (cellDates:true) ou numéro de série Excel (ex : 43174) ;
//  - texte "05/03/2016", "5-3-2016", "5.3.2016" ;
//  - année seule "2016" (jour/mois restent 0).
// Retourne null si la cellule est non vide mais inexploitable.
function parseBirthDateCombined(c: unknown): { d: number; m: number; y: number } | null {
  if (c === null || c === undefined || c === "") return { d: 0, m: 0, y: 0 };
  if (c instanceof Date) {
    return { d: c.getDate(), m: c.getMonth() + 1, y: c.getFullYear() };
  }
  if (typeof c === "number" && c > 25568 && c < 100000) {
    const dt = new Date(Math.round((c - 25569) * 86400000));
    return { d: dt.getDate(), m: dt.getMonth() + 1, y: dt.getFullYear() };
  }
  const s = String(c).trim();
  if (s === "") return { d: 0, m: 0, y: 0 };
  // jj/mm/aaaa (ou jj-mm-aaaa, jj.mm.aaaa)
  const full = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (full) {
    return { d: parseInt(full[1], 10), m: parseInt(full[2], 10), y: parseInt(full[3], 10) };
  }
  // jj/mm/aa (2 chiffres → 19xx si >= 30 sinon 20xx, comme Excel)
  const short = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2})$/);
  if (short) {
    const yy = parseInt(short[3], 10);
    return { d: parseInt(short[1], 10), m: parseInt(short[2], 10), y: yy >= 30 ? 1900 + yy : 2000 + yy };
  }
  // année seule
  const yOnly = s.match(/^(\d{4})$/);
  if (yOnly) return { d: 0, m: 0, y: parseInt(yOnly[1], 10) };
  return null; // illisible
}

// Colonne « date acte » : Date SheetJS (cellDates:true) OU numéro de série Excel
// brut (cellule numérique non formatée, ex : 43174 = 15/03/2018) OU texte libre.
function cellToDateStr(c: unknown): string {
  if (c === null || c === undefined || c === "") return "";
  if (c instanceof Date) return dateToStr(c);
  if (typeof c === "number" && c > 25568 && c < 100000) {
    // Série Excel → Date (25569 = série du 1970-01-01, base 1900)
    const d = new Date(Math.round((c - 25569) * 86400000));
    return dateToStr(d);
  }
  return String(c).trim();
}

// Parse le fichier Excel (.xls/.xlsx) via SheetJS → tableau d'élèves + validation.
async function parseExcel(file: File): Promise<ParsedStudent[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
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
  // État civil facultatif — synonymes larges (en-têtes normalisés sans accents).
  const idxNationality = findCol(["nationalite", "nationality", "nation"]);
  const idxBirthPlace = findCol([
    "lieu de naissance", "lieu de naiss", "lieu naissance", "lieunaissance",
    "lieu de naissance de l'eleve", "birthplace", "birth place", "birth_place",
  ]);
  const idxFather = findCol([
    "pere", "nom du pere", "nom et prenoms du pere", "noms du pere", "pere (nom)",
    "father", "father_name",
  ]);
  const idxMother = findCol([
    "mere", "nom de la mere", "nom et prenoms de la mere", "noms de la mere", "mere (nom)",
    "mother", "mother_name",
  ]);
  const idxActeNumber = findCol([
    "n° acte", "n°acte", "no acte", "num acte", "numero acte", "n° de l'acte",
    "n° de l'acte de naissance", "numero de l'acte", "numero d'acte", "acte n°", "acte no",
    // variantes collées (en-têtes réels du fichier utilisateur) :
    "nacte", "n acte", "numeroacte",
  ]);
  const idxActeDate = findCol([
    "date acte", "date de l'acte", "date de l'acte de naissance", "date acte de naissance", "acte date",
  ]);
  const idxActePlace = findCol([
    "lieu acte", "lieu de l'acte", "lieu de l'acte de naissance", "acte lieu",
    "lieu d'etablissement de l'acte", "lieu etablissement de l'acte",
    // variante collée (en-têtes réels du fichier utilisateur) :
    "lieuacte", "lieunacte",
  ]);
  const idxJour = findCol(["jour", "jour naissance", "jour de naissance", "day"]);
  const idxMois = findCol(["mois", "mois naissance", "mois de naissance", "month"]);
  const idxAnnee = findCol(["annee", "annee naissance", "annee de naissance", "annee de naiss", "year"]);
  const idxBirthDate = findCol([
    "date de naissance", "date naissance", "datenaissance", "date de naiss",
    "date naiss", "birthdate", "birth date", "date de naissance de l'eleve",
  ]);

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

    const matricule = idxMatricule >= 0 ? cellToString(row[idxMatricule]) : "";
    const last_name = cellToString(row[idxNom]);
    const first_name = cellToString(row[idxPrenoms]);
    const gender_raw = idxSexe >= 0 ? cellToString(row[idxSexe]) : "";
    const class_name = idxNiveau >= 0 ? cellToString(row[idxNiveau]) : "";
    // État civil facultatif (chaîne vide si colonne absente ou cellule vide)
    const nationality = idxNationality >= 0 ? cellToString(row[idxNationality]) : "";
    const birth_place = idxBirthPlace >= 0 ? cellToString(row[idxBirthPlace]) : "";
    const father_name = idxFather >= 0 ? cellToString(row[idxFather]) : "";
    const mother_name = idxMother >= 0 ? cellToString(row[idxMother]) : "";
    const acte_number = idxActeNumber >= 0 ? cellToString(row[idxActeNumber]) : "";
    const acte_date = idxActeDate >= 0 ? cellToDateStr(row[idxActeDate]) : "";
    const acte_place = idxActePlace >= 0 ? cellToString(row[idxActePlace]) : "";

    // Naissance (répercussion « Modifier l'élève ») : colonnes séparées
    // jour/mois/annee prioritaires, complétées par la colonne combinée
    // « date de naissance » pour les champs encore vides. -1 = illisible.
    let birth_day = idxJour >= 0 ? cellToInt(row[idxJour]) : 0;
    let birth_month = idxMois >= 0 ? cellToInt(row[idxMois], true) : 0;
    let birth_year = idxAnnee >= 0 ? cellToInt(row[idxAnnee]) : 0;
    if (idxBirthDate >= 0) {
      const combined = parseBirthDateCombined(row[idxBirthDate]);
      if (combined) {
        if (birth_day === 0) birth_day = combined.d;
        if (birth_month === 0) birth_month = combined.m;
        if (birth_year === 0) birth_year = combined.y;
      }
    }

    // Validation côté frontend (erreurs potentielles, flaggées dans le preview)
    const errors: string[] = [];
    if (!last_name) errors.push("nom vide");
    if (!first_name) errors.push("prénoms vides");
    if (!class_name) errors.push("niveau vide");
    if (convertGender(gender_raw) === "") errors.push(`genre invalide : "${gender_raw}"`);
    // Naissance : mêmes règles que le backend (validateBirthDay/Month/Year)
    if (birth_day === -1) errors.push("jour de naissance illisible");
    else if (birth_day > 31) errors.push(`jour de naissance invalide : ${birth_day}`);
    if (birth_month === -1) errors.push("mois de naissance illisible");
    else if (birth_month > 12) errors.push(`mois de naissance invalide : ${birth_month}`);
    if (birth_year === -1) errors.push("année de naissance illisible");
    else if (birth_year !== 0 && (birth_year < 1900 || birth_year > new Date().getFullYear()))
      errors.push(`année de naissance invalide : ${birth_year}`);

    students.push({
      row: i + 1, // 1-based ligne Excel (ligne 1 = en-tête, donc i+1 = ligne réelle)
      matricule,
      last_name,
      first_name,
      gender_raw,
      class_name,
      nationality,
      birth_place,
      father_name,
      mother_name,
      acte_number,
      acte_date,
      acte_place,
      // -1 (illisible) → 0 : la ligne est déjà flaggée en erreur, on n'envoie
      // pas de valeur aberrante au backend.
      birth_day: birth_day > 0 ? birth_day : 0,
      birth_month: birth_month > 0 ? birth_month : 0,
      birth_year: birth_year > 0 ? birth_year : 0,
      errors,
    });
  }
  return students;
}

// === Composant ===
export function ImportStudentsDialog({ open, onOpenChange, schoolId, onImported, onRegisterRow }: ImportStudentsDialogProps) {
  const [fileName, setFileName] = useState("");
  const [parsed, setParsed] = useState<ParsedStudent[] | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  // Preview : 10 premières lignes, extensible (« Afficher plus ») pour laisser
  // l'utilisateur choisir n'importe quelle ligne en saisie assistée.
  const [previewLimit, setPreviewLimit] = useState(10);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reset = useCallback(() => {
    setFileName("");
    setParsed(null);
    setParseError(null);
    setParsing(false);
    setImporting(false);
    setResult(null);
    setPreviewLimit(10);
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
          // État civil facultatif — vide → undefined (NULL en base)
          nationality: p.nationality || undefined,
          birth_place: p.birth_place || undefined,
          father_name: p.father_name || undefined,
          mother_name: p.mother_name || undefined,
          acte_number: p.acte_number || undefined,
          acte_date: p.acte_date || undefined,
          acte_place: p.acte_place || undefined,
          // Naissance — alimente les champs du formulaire « Modifier l'élève »
          birth_day: p.birth_day || undefined,
          birth_month: p.birth_month || undefined,
          birth_year: p.birth_year || undefined,
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
            Colonnes facultatives reconnues :
            <span className="font-mono text-xs"> jour, mois, annee</span> ou
            <span className="font-mono text-xs"> date de naissance</span>,
            <span className="font-mono text-xs"> nationalité, lieu de naissance, père, mère, n° acte, date acte, lieu acte</span>.
            <span className="block mt-1.5 font-medium text-orange-700">
              Inscription automatique : appuyez sur le bouton orange en bas de l&apos;aperçu —
              tous les élèves du fichier sont inscrits d&apos;un coup, jusqu&apos;à la dernière
              ligne (matricule, classe auto-trouvée, naissance, père, mère, acte…).
            </span>
            {onRegisterRow && (
              <span className="block mt-1">
                Pour vérifier élève par élève : le bouton
                <span className="font-semibold"> « Inscrire » </span>d&apos;une ligne ouvre le
                formulaire « Inscrire un élève » pré-rempli — après validation, il passe
                automatiquement à la ligne suivante.
              </span>
            )}
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
              <div className="max-h-80 overflow-y-auto overflow-x-auto">
                <table className="w-full text-xs min-w-[1000px]">
                  <thead className="bg-gray-100 sticky top-0">
                    <tr>
                      <th className="p-1.5 text-left">Ligne</th>
                      <th className="p-1.5 text-left">Matricule</th>
                      <th className="p-1.5 text-left">Nom</th>
                      <th className="p-1.5 text-left">Prénoms</th>
                      <th className="p-1.5 text-left">Sexe</th>
                      <th className="p-1.5 text-left">Niveau</th>
                      <th className="p-1.5 text-left" title="Date de naissance (jour/mois/année)">Naissance</th>
                      <th className="p-1.5 text-left" title="Nationalité">Nat.</th>
                      <th className="p-1.5 text-left" title="Lieu de naissance">Lieu naiss.</th>
                      <th className="p-1.5 text-left" title="Nom et prénoms du père">Père</th>
                      <th className="p-1.5 text-left" title="Nom et prénoms de la mère">Mère</th>
                      <th className="p-1.5 text-left" title="N° de l'acte de naissance">N° acte</th>
                      <th className="p-1.5 text-left" title="Date de l'acte de naissance">Date acte</th>
                      <th className="p-1.5 text-left" title="Lieu d'établissement de l'acte">Lieu acte</th>
                      <th className="p-1.5 text-left">Erreurs</th>
                      {onRegisterRow && (
                        <th className="p-1.5 text-left" title="Ouvrir le formulaire « Inscrire un élève » pré-rempli avec cette ligne">Actions</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.slice(0, previewLimit).map((p, i) => (
                      <tr key={i} className={p.errors.length > 0 ? "bg-red-50" : (i % 2 === 0 ? "bg-white" : "bg-gray-50")}>
                        <td className="p-1.5">{p.row}</td>
                        <td className="p-1.5 font-mono">{p.matricule || "—"}</td>
                        <td className="p-1.5">{p.last_name || <span className="text-red-500">(vide)</span>}</td>
                        <td className="p-1.5 truncate max-w-[140px]">{p.first_name || <span className="text-red-500">(vide)</span>}</td>
                        <td className="p-1.5">{p.gender_raw}</td>
                        <td className="p-1.5 font-medium">{p.class_name}</td>
                        <td className="p-1.5 whitespace-nowrap">
                          {p.birth_day || p.birth_month || p.birth_year
                            ? `${p.birth_day || "?"}/${p.birth_month || "?"}/${p.birth_year || "?"}`
                            : <span className="text-gray-400">—</span>}
                        </td>
                        <td className="p-1.5 text-gray-600">{p.nationality || "—"}</td>
                        <td className="p-1.5 text-gray-600 truncate max-w-[100px]">{p.birth_place || "—"}</td>
                        <td className="p-1.5 text-gray-600 truncate max-w-[110px]">{p.father_name || "—"}</td>
                        <td className="p-1.5 text-gray-600 truncate max-w-[110px]">{p.mother_name || "—"}</td>
                        <td className="p-1.5 text-gray-600">{p.acte_number || "—"}</td>
                        <td className="p-1.5 text-gray-600 whitespace-nowrap">{p.acte_date || "—"}</td>
                        <td className="p-1.5 text-gray-600 truncate max-w-[100px]">{p.acte_place || "—"}</td>
                        <td className="p-1.5 text-red-600 text-[10px]">{p.errors.join(", ") || "—"}</td>
                        {onRegisterRow && (
                          <td className="p-1.5">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-6 px-2 text-[11px] gap-1"
                              title="Ouvrir le formulaire « Inscrire un élève » pré-rempli avec cette ligne (puis avance automatique ligne par ligne)"
                              onClick={() => onRegisterRow(parsed, i)}
                              disabled={importing}
                            >
                              <UserPlus className="w-3 h-3" />
                              Inscrire
                            </Button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {parsed.length > previewLimit && (
                <div className="bg-gray-100 p-2 text-center">
                  <button
                    type="button"
                    className="text-xs text-primary font-medium hover:underline"
                    onClick={() => setPreviewLimit((l) => l + 50)}
                  >
                    Afficher plus de lignes ({parsed.length - previewLimit} restantes)
                  </button>
                </div>
              )}
            </div>
          )}

          {/* INSCRIPTION AUTOMATIQUE (demande utilisateur : « l'inscription ne
              doit pas se faire élève après élève mais appuyer directement sur
              le bouton orange du bas pour que tout soit inscrit
              automatiquement ») — un clic = POST /api/students/bulk avec TOUTES
              les lignes : classes résolues par nom, matricules déjà en base
              ignorés, état civil + naissance enregistrés, rapport détaillé. */}
          {parsed && parsed.length > 0 && !result && (
            <div className="rounded-lg border-2 border-orange-200 bg-orange-50 p-3 space-y-2">
              <Button
                type="button"
                onClick={handleImport}
                disabled={importing || !schoolId}
                title={schoolId ? undefined : "Sélectionnez d'abord une école"}
                className="w-full h-11 bg-orange-600 hover:bg-orange-700 text-white text-sm font-semibold shadow-sm"
              >
                {importing ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    Inscription automatique en cours… ({parsed.length} élèves)
                  </>
                ) : (
                  <>
                    <Users className="w-5 h-5 mr-2" />
                    Inscrire automatiquement les {parsed.length} élèves
                  </>
                )}
              </Button>
              <p className="text-[11px] leading-snug text-orange-800/80 text-center">
                Un seul clic : toutes les lignes du fichier sont inscrites jusqu&apos;à la
                dernière — matricule, classe auto-trouvée, naissance, père, mère, acte…
                Les matricules déjà en base sont ignorés ; le rapport détaillé
                s&apos;affiche à la fin.
              </p>
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
                  <div className="text-2xl font-bold text-amber-600">{result.skipped?.length ?? 0}</div>
                  <div className="text-xs text-gray-600">Ignorés (doublons)</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-red-600">{result.failed?.length ?? 0}</div>
                  <div className="text-xs text-gray-600">Échoués</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-gray-700">{result.total}</div>
                  <div className="text-xs text-gray-600">Total</div>
                </div>
              </div>
              {(result.failed?.length ?? 0) > 0 && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-red-600 font-medium">
                    {result.failed.length} échec(s) — cliquer pour détails
                  </summary>
                  <ul className="mt-1 space-y-0.5 max-h-32 overflow-y-auto">
                    {result.failed?.slice(0, 50).map((f, i) => (
                      <li key={i} className="text-red-700">
                        Ligne {f.row} {f.matricule ? `(${f.matricule})` : ""} : {f.reason}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {(result.skipped?.length ?? 0) > 0 && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-amber-600 font-medium">
                    {result.skipped.length} ignoré(s) — cliquer pour détails
                  </summary>
                  <ul className="mt-1 space-y-0.5 max-h-32 overflow-y-auto">
                    {result.skipped?.slice(0, 50).map((s, i) => (
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
