// === Formatage FRANÇAIS des notes / moyennes (documents imprimés) ===
// Demande utilisateur (Task 37) : « les nombres décimaux doivent
// s'écrire avec une virgule et deux chiffres après la virgule
// (exemple : 7,37) ».
//  - un nombre DÉCIMAL s'écrit avec une virgule et DEUX chiffres après
//    la virgule : 7,37 · 12,5 → 12,50 · 13,458 → 13,46 ;
//  - un ENTIER reste entier : 10 · 48 (les totaux/barèmes entiers ne
//    se transforment pas en « 10,00 »).

/** Note / moyenne au format français (virgule, 2 décimales si décimal). */
export function fmtNoteFr(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "";
  return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(".", ",");
}
