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
} as const;

// Prochaine transition possible pour un statut donné
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
    default:
      return { status: null, label: "" };
  }
}
