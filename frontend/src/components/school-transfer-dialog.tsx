"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { SchoolCombobox } from "@/components/school-combobox";
import { ClassCombobox } from "@/components/class-combobox";
import {
  ApiException,
  classesApi,
  directorsApi,
  schoolsApi,
  studentsApi,
  teachersApi,
} from "@/lib/api";
import type { ClassWithDetails, SchoolWithStats } from "@/lib/types";

/**
 * Changement d'école (Task 53) — l'enseignant ou l'élève a changé
 * d'établissement ? Ce dialogue guidé transfère son dossier vers la
 * nouvelle école :
 *
 *  - ADJOINT(E) AU DIRECTEUR  : nouvelle école (l'école cible doit avoir
 *    un directeur rattaché — règle backend existante). Ses cours sont
 *    détachés de l'ancienne école côté serveur.
 *  - DIRECTEUR                : nouvelle école (elle ne doit pas avoir
 *    d'autre directeur actif — règle backend existante).
 *  - ÉLÈVE                    : nouvelle école PUIS classe cible dans
 *    cette école (le matricule et le dossier restent attachés à l'élève).
 *
 * La section « Changement d'école » (school-transfer-section.tsx) et les
 * boutons « Changer d'école » des listes ouvrent ce dialogue.
 */
export interface TransferPerson {
  kind: "teacher" | "director" | "student";
  id: string;
  name: string;
  currentSchoolId?: string | null;
  currentSchoolName?: string | null;
  /** Élève : classe actuelle (affichage). */
  currentClassName?: string | null;
}

const KIND_LABELS: Record<TransferPerson["kind"], string> = {
  teacher: "Adjoint(e) au directeur",
  director: "Directeur d'école",
  student: "Élève",
};

export function SchoolTransferDialog({
  person,
  open,
  onOpenChange,
}: {
  person: TransferPerson | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [targetSchoolId, setTargetSchoolId] = useState("");
  const [targetClassId, setTargetClassId] = useState("");

  // Réinitialisation à chaque ouverture / changement de personne.
  useEffect(() => {
    if (open) {
      setTargetSchoolId("");
      setTargetClassId("");
    }
  }, [open, person?.id]);

  // Écoles accessibles selon le rôle (scope backend ListSchools) :
  // admin = toutes, inspecteur = toutes, conseiller = SON secteur.
  const { data: schoolsData, isLoading: schoolsLoading } = useQuery({
    queryKey: ["schools"],
    queryFn: () => schoolsApi.list(),
    enabled: open,
  });

  const isStudent = person?.kind === "student";

  // Élève : classes de l'école CIBLE (chargées à la sélection de l'école).
  const { data: targetClassesData, isLoading: classesLoading } = useQuery({
    queryKey: ["classes", "school-transfer", targetSchoolId],
    queryFn: () => classesApi.list({ schoolId: targetSchoolId }),
    enabled: open && !!isStudent && targetSchoolId !== "",
  });

  const schools: SchoolWithStats[] = schoolsData?.schools ?? [];
  // On exclut l'école ACTUELLE (le transfert vise un autre établissement ;
  // un changement de classe interne passe par le formulaire d'édition).
  const targetSchools = person?.currentSchoolId
    ? schools.filter((s) => s.id !== person.currentSchoolId)
    : schools;
  const targetClasses: ClassWithDetails[] = targetClassesData?.classes ?? [];
  const targetSchoolName = schools.find((s) => s.id === targetSchoolId)?.name;
  const targetClassName = targetClasses.find((c) => c.id === targetClassId)
    ?.name;

  const queryClient = useQueryClient();
  const transferMut = useMutation({
    mutationFn: async () => {
      if (!person) throw new Error("Aucune personne sélectionnée");
      if (isStudent) {
        return studentsApi.update(person.id, { class_id: targetClassId });
      }
      const payload = { school_id: targetSchoolId };
      return person.kind === "director"
        ? directorsApi.update(person.id, payload)
        : teachersApi.update(person.id, payload);
    },
    onSuccess: async () => {
      toast.success("Changement d'école enregistré", {
        description: `${person?.name ?? ""} a été transféré(e) vers sa nouvelle école.`,
      });
      await Promise.all(
        [
          ["teachers"],
          ["directors"],
          ["students"],
          ["classes"],
          ["schools"],
          ["audit"],
        ].map((key) => queryClient.invalidateQueries({ queryKey: key })),
      );
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast.error("Transfert échoué", {
        description:
          error instanceof ApiException
            ? error.message
            : "Erreur inattendue",
      });
    },
  });

  // Bloque la confirmation tant que le transfert n'est pas complètement
  // défini (école cible ; pour l'élève : école + classe cible).
  const ready = person
    ? isStudent
      ? targetSchoolId !== "" && targetClassId !== ""
      : targetSchoolId !== ""
    : false;

  async function onConfirm() {
    try {
      await transferMut.mutateAsync();
      onOpenChange(false);
    } catch {
      /* toastée par useCrudMutation */
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowLeftRight className="w-5 h-5 text-primary" aria-hidden />
            Changement d&apos;école
          </DialogTitle>
          <DialogDescription>
            {person
              ? `${KIND_LABELS[person.kind]} — ${person.name}`
              : "Transférer vers un autre établissement"}
          </DialogDescription>
        </DialogHeader>

        {person && (
          <div className="space-y-4 pt-1">
            {/* Situation actuelle */}
            <div className="rounded-md border bg-muted/40 p-3 text-sm space-y-1">
              <p className="font-medium">Situation actuelle</p>
              <p className="text-muted-foreground">
                École : {person.currentSchoolName || "—"}
                {isStudent && person.currentClassName
                  ? ` · Classe : ${person.currentClassName}`
                  : ""}
              </p>
            </div>

            {/* École cible */}
            <div className="space-y-1.5">
              <Label>Nouvelle école</Label>
              {schoolsLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                  <Loader2 className="w-4 h-4 animate-spin" /> Chargement des
                  écoles…
                </div>
              ) : (
                <SchoolCombobox
                  schools={targetSchools}
                  value={targetSchoolId}
                  onChange={(v) => {
                    setTargetSchoolId(v);
                    setTargetClassId(""); // reset classe quand l'école change
                  }}
                  placeholder="Choisir la nouvelle école…"
                />
              )}
              {targetSchools.length === 0 && !schoolsLoading && (
                <p className="text-xs text-muted-foreground">
                  Aucune école cible disponible dans votre périmètre.
                </p>
              )}
            </div>

            {/* Élève : classe cible dans la nouvelle école */}
            {isStudent && targetSchoolId !== "" && (
              <div className="space-y-1.5">
                <Label>Classe d&apos;affectation dans la nouvelle école</Label>
                {classesLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                    <Loader2 className="w-4 h-4 animate-spin" /> Chargement
                    des classes…
                  </div>
                ) : (
                  <ClassCombobox
                    classes={targetClasses}
                    value={targetClassId}
                    onChange={setTargetClassId}
                    placeholder="Choisir la classe…"
                    emptyText="Aucune classe dans cette école."
                  />
                )}
                {targetClasses.length === 0 && !classesLoading && (
                  <p className="text-xs text-destructive">
                    Cette école n&apos;a aucune classe — créez-en une d&apos;abord
                    dans le module Classes.
                  </p>
                )}
              </div>
            )}

            {/* Résumé du transfert */}
            {targetSchoolId !== "" && (!isStudent || targetClassId !== "") && (
              <p className="rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">
                <span className="font-semibold">{person.name}</span> passera
                de <span className="font-semibold">{person.currentSchoolName || "—"}</span>{" "}
                à{" "}
                <span className="font-semibold">
                  {targetSchoolName}
                  {isStudent && targetClassName ? ` · classe ${targetClassName}` : ""}
                </span>
                .
              </p>
            )}

            {/* Règles de gestion rappelées */}
            <p className="text-xs text-muted-foreground">
              {person.kind === "teacher" &&
                "L'école cible doit avoir un directeur rattaché. Les cours tenus par l'agent dans son ancienne école seront détachés."}
              {person.kind === "director" &&
                "L'école cible ne doit pas avoir d'autre directeur actif."}
              {isStudent &&
                "L'élève conserve son matricule et son dossier ; il rejoindra la classe choisie dans la nouvelle école."}
            </p>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Annuler
          </Button>
          <Button
            onClick={onConfirm}
            disabled={!ready || transferMut.isPending}
          >
            {transferMut.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                Transfert…
              </>
            ) : (
              <>
                <ArrowLeftRight className="w-4 h-4 mr-1.5" />
                Confirmer le changement
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
