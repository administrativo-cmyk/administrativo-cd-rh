import { z } from "zod";
import type { AdministrativeUser } from "@/lib/auth/types";
const role = z.enum(["ADMIN", "RH", "GESTOR", "LEITURA"]);
export type VersionedAdministrativeUser = AdministrativeUser & { updated_at: string };
export const userEditSchema = z.object({
  id: z.string().uuid(), expectedUpdatedAt: z.string().datetime({ offset: true }), name: z.string().trim().min(2).max(200),
  role, managerId: z.string().uuid().nullable(), reason: z.string().trim().min(5).max(1000),
}).strict().refine(value => value.role === "GESTOR" ? !!value.managerId : value.managerId === null, "Vínculo obrigatório apenas para GESTOR.");
export const userListSchema = z.object({ status: z.enum(["PENDENTE", "APROVADO", "BLOQUEADO"]).nullable(), role: role.nullable(), search: z.string().trim().max(200) }).strict();
export type UserEditInput = z.infer<typeof userEditSchema>;
