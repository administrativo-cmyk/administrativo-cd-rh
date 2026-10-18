import { describe, expect, it, vi } from "vitest";
import { reportOperationalError } from "./operational-error";

describe("logs operacionais", () => {
  it("mantém código e correlação sem mensagem, stack ou dados pessoais", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const correlationId = reportOperationalError("daily-call.write", { code: "PT409", message: "CPF PIS foto conteúdo privado", details: "dados privados" });
    expect(JSON.parse(log.mock.calls[0][0])).toEqual({ operation: "daily-call.write", correlationId, code: "PT409" });
    expect(log.mock.calls[0][0]).not.toContain("privado");
    log.mockRestore();
  });
});
