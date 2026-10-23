/**
 * Agents BÉNÉVOLES — identification par le MATRICULE du dossier
 * personnel (« tous les conseillers doivent connaître le nombre de
 * bénévoles de leurs secteurs respectifs — ils doivent être en bleu »).
 *
 * Un agent est BÉNÉVOLE quand son matricule vaut « Bénévole » /
 * « BÉNÉVOLE » / « BENEVOLE » — accents, casse et espaces tolérés ;
 * la typo « BBENEVOLE » d'une saisie de terrain est comprise aussi.
 * Même règle de normalisation que le backend
 * (backend/handlers/sectors.go — unaccentUpper + isBenevoleMatricule).
 */

/** Bleu officiel des bénévoles — noms des bénévoles EN BLEU dans les
 *  documents et vues (même force que le rouge #e00000 des femmes). */
export const BENEVOLE_INK = "#1d4ed8";

/** Matricule bénévole ? (null/undefined/vide → non) */
export function isBenevoleMatricule(m: string | null | undefined): boolean {
  if (!m) return false;
  const norm = m
    .normalize("NFD") // décompose les accents (É → E + ◌́)
    .replace(/[\u0300-\u036f]/g, "") // retire les signes diacritiques
    .toUpperCase()
    .trim();
  return norm.includes("BENEVOLE");
}
