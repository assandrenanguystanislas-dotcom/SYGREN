"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { GraduationCap, Loader2, Lock, User as UserIcon, ShieldCheck, KeyRound, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { useAuthStore } from "@/lib/auth-store";
import { authApi } from "@/lib/api";
import { RegisterAccessDialog } from "@/components/register-access-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";

const loginSchema = z.object({
  identifier: z
    .string()
    .min(1, "Identifiant requis"),
  password: z.string().min(1, "Mot de passe requis"),
});

type LoginValues = z.infer<typeof loginSchema>;

export function LoginView() {
  const login = useAuthStore((s) => s.login);
  const [submitting, setSubmitting] = useState(false);
  // Task 26 — ajout de l'onglet « Parent » : code ET mot de passe = numéro
  // de téléphone. Tout le reste est grisé pour le parent sauf le Portail
  // Parent (dashboard-shell + page.tsx).
  const [loginRole, setLoginRole] = useState<
    "admin" | "director" | "teacher" | "parent"
  >("director");

  // Config adaptative selon le rôle sélectionné.
  // Task 25/26 — Directeur ET Enseignant se connectent avec le CODE ÉCOLE
  // dédié à leur école (créé eux-mêmes via « Créer vos accès ») ; le mot
  // de passe standard est le numéro de téléphone (modifiable à tout
  // moment). Le PARENT saisit son numéro de téléphone comme code ET mot
  // de passe.
  const roleConfig = {
    admin: { label: "Email", placeholder: "admin@sygren.ci" },
    director: { label: "Code école", placeholder: "ex: EPPCP001" },
    teacher: { label: "Code école", placeholder: "ex: EPPCP001" },
    parent: { label: "Code (numéro de téléphone)", placeholder: "ex: 0701020304" },
  }[loginRole];

  // Task 25/26 — indice sous le champ mot de passe, adapté au rôle
  const passwordHint =
    loginRole === "director" || loginRole === "teacher"
      ? "Mot de passe standard : votre numéro de téléphone. À modifier à tout moment via « Modifier votre mot de passe » après connexion."
      : loginRole === "parent"
        ? "Votre code et votre mot de passe correspondent à votre numéro de téléphone."
        : null;

  // Task 26 — auto-inscription (fin de la phase pilote) : les directeurs
  // et enseignants créent leurs accès depuis cette interface.
  const isRegisterableRole = loginRole === "director" || loginRole === "teacher";
  const [registerOpen, setRegisterOpen] = useState(false);

  const roles = [
    { v: "admin" as const, l: "Admin" },
    { v: "director" as const, l: "Directeur" },
    { v: "teacher" as const, l: "Enseignant" },
    { v: "parent" as const, l: "Parent" },
  ];

  // === Reset password modal ===
  const [resetOpen, setResetOpen] = useState(false);
  const [resetRole, setResetRole] = useState<"admin" | "inspector" | "director" | "teacher" | "parent">("director");
  const [resetId, setResetId] = useState("");
  const [resetLoading, setResetLoading] = useState(false);
  const [resetDone, setResetDone] = useState(false);

  async function handleReset() {
    if (!resetId.trim()) return;
    setResetLoading(true);
    try {
      await authApi.resetRequest({ identifier: resetId.trim(), role_hint: resetRole });
      setResetDone(true);
      toast.success("Demande envoyée", { description: "L'administrateur va traiter votre demande." });
    } catch (e) {
      toast.error("Erreur", { description: e instanceof Error ? e.message : "Erreur inconnue" });
    } finally {
      setResetLoading(false);
    }
  }

  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { identifier: "", password: "" },
  });

  async function onSubmit(values: LoginValues) {
    setSubmitting(true);
    try {
      const user = await login(values.identifier, values.password);
      toast.success(`Bienvenue, ${user.full_name} !`, {
        description: `Connecté en tant que ${
          user.role === "admin"
            ? "Super-Administrateur"
            : user.role === "director"
              ? "Directeur"
              : user.role === "inspector"
                ? "Admin IEP"
                : user.role === "parent"
                  ? "Parent"
                  : "Instituteur"
        }`,
      });
    } catch (e) {
      toast.error("Échec de connexion", {
        description: e instanceof Error ? e.message : "Erreur inconnue",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative min-h-screen flex items-center justify-center bg-gradient-to-br from-white via-orange-50/40 to-green-50/30 p-4">
      {/* Bande tricolore décorative en haut */}
      <div className="absolute inset-x-0 top-0 h-1.5 ci-flag-stripe" />

      {/* Motif décoratif subtil */}
      <div
        className="absolute inset-0 opacity-[0.04] pointer-events-none"
        style={{
          backgroundImage:
            "radial-gradient(oklch(0.646 0.222 41.116) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      />

      <div className="relative w-full max-w-md animate-in-up">
        {/* En-tête de marque */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/30 mb-3">
            <GraduationCap className="w-9 h-9" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            SYGREN
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Système de Gestion de Relevé Électronique de Note
          </p>
        </div>

        <Card className="shadow-xl border-border/60 glass">
          <CardHeader className="space-y-1">
            <CardTitle className="text-xl">Connexion</CardTitle>
          </CardHeader>
          <CardContent>
            {/* Sélecteur de fonction (pills animées — 4 onglets depuis la Task 26) */}
            <div className="relative flex p-1 bg-muted rounded-full mb-5">
              {/* Fond coulissant animé — position calculée par index (générique) */}
              <div
                className="absolute top-1 bottom-1 rounded-full bg-primary transition-all duration-300 ease-out"
                style={(() => {
                  const idx = roles.findIndex((r) => r.v === loginRole);
                  const seg = 100 / roles.length; // 25 % par onglet
                  return {
                    left:
                      idx === 0
                        ? "4px"
                        : `calc(${idx * seg}% + 2px)`,
                    right:
                      idx === roles.length - 1
                        ? "4px"
                        : `calc(${(roles.length - 1 - idx) * seg}% + 2px)`,
                  };
                })()}
              />
              {roles.map(({ v, l }) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setLoginRole(v)}
                  className={`relative z-10 flex-1 py-1.5 text-xs font-medium rounded-full transition-colors duration-200 ${
                    loginRole === v ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {l}
                </button>
              ))}
            </div>

            <Form {...form}>
              <form
                onSubmit={form.handleSubmit(onSubmit)}
                className="space-y-4"
                noValidate
              >
                <FormField
                  control={form.control}
                  name="identifier"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{roleConfig.label}</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                          <Input
                            {...field}
                            type="text"
                            autoComplete="username"
                            placeholder={roleConfig.placeholder}
                            className="pl-9"
                            disabled={submitting}
                          />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Mot de passe</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                          <Input
                            {...field}
                            type="password"
                            autoComplete="current-password"
                            placeholder={
                              loginRole === "director" || loginRole === "teacher" || loginRole === "parent"
                                ? "Votre numéro de téléphone"
                                : "••••••••"
                            }
                            className="pl-9"
                            disabled={submitting}
                          />
                        </div>
                      </FormControl>
                      <FormMessage />
                      {passwordHint && (
                        <p className="text-[11px] text-muted-foreground">
                          {passwordHint}
                        </p>
                      )}
                    </FormItem>
                  )}
                />

                <Button
                  type="submit"
                  className="w-full h-11 text-base shadow-md shadow-primary/20"
                  disabled={submitting}
                >
                  {submitting ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Connexion en cours…
                    </>
                  ) : (
                    "Se connecter"
                  )}
                </Button>
              </form>
            </Form>

            {/* Task 26 — auto-inscription (directeur / enseignant uniquement) */}
            {isRegisterableRole && (
              <div className="text-center mt-3">
                <button
                  type="button"
                  onClick={() => setRegisterOpen(true)}
                  className="text-xs font-medium text-primary hover:underline inline-flex items-center gap-1.5"
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  Pas encore d&apos;accès ? Créer vos accès
                </button>
              </div>
            )}

            {/* Mot de passe oublié */}
            <div className="text-center mt-3">
              <button
                type="button"
                onClick={() => { setResetOpen(true); setResetDone(false); setResetId(""); }}
                className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
              >
                <KeyRound className="w-3 h-3" />
                Mot de passe oublié ?
              </button>
            </div>

            {/* === Task 26 — Modal auto-inscription === */}
            <RegisterAccessDialog
              open={registerOpen}
              onOpenChange={setRegisterOpen}
              role={loginRole === "teacher" ? "teacher" : "director"}
              onRegistered={(schoolCode, phone) => {
                // Pré-remplit la connexion : identifiant = code école,
                // mot de passe = numéro de téléphone (standard).
                form.setValue("identifier", schoolCode);
                form.setValue("password", phone);
              }}
            />

            {/* === Modal reset password === */}
            <Dialog open={resetOpen} onOpenChange={setResetOpen}>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <KeyRound className="w-5 h-5" />
                    Réinitialiser le mot de passe
                  </DialogTitle>
                  <DialogDescription>
                    Sélectionnez votre fonction + saisissez votre identifiant.
                    L'administrateur recevra votre demande.
                  </DialogDescription>
                </DialogHeader>
                {resetDone ? (
                  <div className="py-6 text-center space-y-3">
                    <p className="text-sm font-medium text-emerald-600">Demande envoyée</p>
                    <p className="text-xs text-muted-foreground">
                      L'administrateur va traiter votre demande et vous communiquer
                      votre nouveau mot de passe ou un lien de réinitialisation.
                    </p>
                    <Button onClick={() => setResetOpen(false)} size="sm">Fermer</Button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div>
                      <label className="text-xs font-medium mb-1.5 block">Votre fonction</label>
                      <div className="grid grid-cols-3 gap-2">
                        {([
                          { v: "admin" as const, l: "Admin" },
                          { v: "director" as const, l: "Directeur" },
                          { v: "teacher" as const, l: "Enseignant" },
                          { v: "parent" as const, l: "Parent" },
                        ]).map(({ v, l }) => (
                          <button key={v} type="button" onClick={() => setResetRole(v)}
                            className={`px-2 py-2 rounded text-xs border ${resetRole === v ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted"}`}>
                            {l}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="text-xs font-medium mb-1.5 block">
                        {resetRole === "admin" || resetRole === "inspector" ? "Email" : resetRole === "director" ? "Code école" : resetRole === "parent" ? "Téléphone ou email" : "Téléphone"}
                      </label>
                      <Input value={resetId} onChange={(e) => setResetId(e.target.value)}
                        placeholder={resetRole === "director" ? "ex: EPPCP001" : resetRole === "teacher" ? "ex: 0700000000" : "ex: email@sygren.ci"}
                        disabled={resetLoading} />
                    </div>
                    <Button onClick={handleReset} disabled={resetLoading || !resetId.trim()} className="w-full">
                      {resetLoading ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : <KeyRound className="w-4 h-4 mr-1.5" />}
                      Envoyer la demande
                    </Button>
                  </div>
                )}
              </DialogContent>
            </Dialog>

            {/* Identifiants de démonstration */}
            <div className="mt-5 rounded-lg border border-border/60 bg-muted/40 p-3 text-xs space-y-1.5">
              <div className="flex items-center gap-1.5 font-medium text-foreground">
                <ShieldCheck className="w-3.5 h-3.5 text-[var(--success)]" />
                Compte de démonstration
              </div>
              <div className="text-muted-foreground font-mono">
                <span className="text-foreground">Email :</span>{" "}
                admin@sygren.ci
                <br />
                <span className="text-foreground">Mot de passe :</span>{" "}
                admin123
              </div>
            </div>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground mt-4">
          © {new Date().getFullYear()} SYGREN — Direction de l'Enseignement
          Primaire, Côte d'Ivoire
        </p>
      </div>
    </div>
  );
}
