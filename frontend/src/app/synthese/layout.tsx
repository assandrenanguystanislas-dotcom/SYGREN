import { Suspense } from "react";

export const dynamic = "force-dynamic";

export default function SynthesePageLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <Suspense fallback={<div>Chargement...</div>}>{children}</Suspense>;
}
