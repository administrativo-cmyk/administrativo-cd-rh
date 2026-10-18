import { notFound } from "next/navigation";
import { AdministrationApp } from "@/components/administration/administration-app";
import { requireApprovedProfile } from "@/lib/auth/server-authorization";
import type { AdministrationEntity } from "@/lib/administration/contracts";

const entities: Record<string, AdministrationEntity> = { unidades: "unit", gestores: "manager", colaboradores: "employee", setores: "department", cargos: "job", categorias: "category" };
export default async function AdministrationPage({ params }: { params: Promise<{ entity: string }> }) {
  const { entity: route } = await params;
  if (!Object.hasOwn(entities, route)) notFound();
  const profile = await requireApprovedProfile(["ADMIN", "RH"]);
  return <AdministrationApp key={route} profile={profile} entity={entities[route]} />;
}
