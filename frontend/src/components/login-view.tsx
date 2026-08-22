"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { GraduationCap, Loader2, Lock, User as UserIcon, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { useAuthStore } from "@/lib/auth-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
                ? "Inspecteur"
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
            <CardDescription>
              Admin/IEP : email · Directeur : code école · Enseignant : téléphone
            </CardDescription>
          </CardHeader>
          <CardContent>
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
                      <FormLabel>Email, téléphone ou code école</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                          <Input
                            {...field}
                            type="text"
                            autoComplete="username"
                            placeholder="email, téléphone ou code école (ex: EPPCP001)"
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
                            placeholder="••••••••"
                            className="pl-9"
                            disabled={submitting}
                          />
                        </div>
                      </FormControl>
                      <FormMessage />
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
