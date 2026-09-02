// Constantes partagées pour les sessions de saisie

export const MONTHS_FR = [
  "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
];

export const MONTHS_SHORT_FR = [
  "Jan", "Fév", "Mar", "Avr", "Mai", "Juin",
  "Juil", "Aoû", "Sep", "Oct", "Nov", "Déc",
];

export function monthLabel(month: number): string {
  if (month >= 1 && month <= 12) return MONTHS_FR[month - 1];
  return "—";
}

export function monthShortLabel(month: number): string {
  if (month >= 1 && month <= 12) return MONTHS_SHORT_FR[month - 1];
  return "—";
}

// Couleurs et labels par statut de session
//
// Les statuts "actifs" (draft, open, closed, validated) suivent le cycle
// normal de saisie. Les statuts "terminaux" (cancelled, archived) sont des
// états finaux lecture seule :
//   - cancelled : session annulée (raison obligatoire). N'apparaît pas dans
//     la liste active par défaut (filtre include_cancelled=false côté API).
//   - archived  : session validée puis archivée (manuel ou cron fin d'année).
//     Les notes sont conservées pour le bilan annuel + comparaison inter-annuelle.
//     Masquée de la liste active par défaut (include_archived=false).
export const SESSION_STATUS_CONFIG = {
  draft: {
    label: "Brouillon",
    color: "bg-slate-100 text-slate-700 border-slate-200",
    description: "Session créée, saisie pas encore ouverte",
  },
  open: {
    label: "Saisie ouverte",
    color: "bg-emerald-100 text-emerald-700 border-emerald-200",
    description: "Les enseignants peuvent saisir les notes",
  },
  closed: {
    label: "Saisie fermée",
    color: "bg-amber-100 text-amber-700 border-amber-200",
    description: "Saisie close, en attente de validation",
  },
  validated: {
    label: "Validée",
    color: "bg-primary/15 text-primary border-primary/30",
    description: "Verrouillée, calculs des moyennes disponibles",
  },
  cancelled: {
    label: "Annulée",
    color: "bg-rose-100 text-rose-700 border-rose-200",
    description:
      "Session annulée — l'évaluation n'a pas eu lieu. Les notes ont été supprimées.",
  },
  archived: {
    label: "Archivée",
    color: "bg-zinc-100 text-zinc-600 border-zinc-200",
    description:
      "Session validée puis archivée. Notes conservées pour le bilan annuel.",
  },
} as const;

// Type union des clés de SESSION_STATUS_CONFIG (utile pour le typage strict)
export type SessionStatusKey = keyof typeof SESSION_STATUS_CONFIG;

// Prochaine transition possible pour un statut donné.
// Retourne null pour les statuts terminaux (cancelled, archived) — aucune
// transition n'est possible via UpdateSessionStatus (ils passent par des
// endpoints dédiés : CancelSession / ArchiveSession).
export function nextStatus(status: string): {
  status: "open" | "closed" | "validated" | null;
  label: string;
} {
  switch (status) {
    case "draft":
      return { status: "open", label: "Ouvrir la saisie" };
    case "open":
      return { status: "closed", label: "Fermer la saisie" };
    case "closed":
      return { status: "validated", label: "Valider les notes" };
    // "validated" : la transition suivante est l'archivage, gérée par un
    // endpoint dédié (ArchiveSession), pas par UpdateSessionStatus.
    // "cancelled" / "archived" : statuts terminaux, aucune transition.
    default:
      return { status: null, label: "" };
  }
}

// Libellé d'un type d'évaluation (« Composition », « Examen Blanc »,
// « Composition de passage ») — affichages du formulaire « {type} N°x ».
// « composition_passage » = Composition de passage : évaluation de fin
// d'année qui alimente la « Moyenne de la composition de passage » du
// document « RESULTATS DE FIN D'ANNEE » (moyenne annuelle).
export function evalTypeLabel(evalType: string): string {
  if (evalType === "exam_blanc") return "Examen Blanc";
  if (evalType === "composition_passage") return "Composition de passage";
  return "Composition";
}
