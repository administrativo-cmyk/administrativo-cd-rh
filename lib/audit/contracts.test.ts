import { describe, expect, it } from "vitest";
import { auditDifferences, auditQuerySchema, defaultAuditQuery } from "./contracts";
describe("consulta de auditoria", () => {
 it("limita período e paginação, rejeita data impossível e UUID inválido", () => {
  const valid = defaultAuditQuery("2026-10-17"); expect(valid.from).toBe("2026-09-17");
  for (const patch of [{ from: "2025-01-01" }, { to: "2026-02-30" }, { offset: -1 }, { limit: 101 }, { actor: "admin" }, { to: "2026-01-01" }]) expect(auditQuerySchema.safeParse({ ...valid, ...patch }).success).toBe(false);
 });
 it("mostra inclusão, remoção e valor alterado sem repetir campos iguais", () => {
  expect(auditDifferences({ nome: "A", antigo: 1, igual: 2 }, { nome: "B", novo: 3, igual: 2 })).toEqual([{ field: "antigo", before: 1, after: undefined }, { field: "nome", before: "A", after: "B" }, { field: "novo", before: undefined, after: 3 }]);
 });
});
