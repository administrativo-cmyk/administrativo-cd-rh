import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EmployeeAvatar } from "./employee-avatar";
import { refreshEmployeePhotos } from "@/lib/monitoring/photo-refresh";

describe("foto protegida", () => {
  it("tenta novamente após atualização explícita, sem prender a falha anterior", () => {
    render(<EmployeeAvatar name="Pessoa Sintética" employeeId="synthetic-id" />);
    const previous = screen.getByRole("img", { name: "Foto de Pessoa Sintética" }).getAttribute("src");
    fireEvent.error(screen.getByRole("img", { name: "Foto de Pessoa Sintética" }));
    expect(screen.getByRole("img", { name: "Pessoa Sintética — foto indisponível" })).toHaveTextContent("PS");
    act(() => refreshEmployeePhotos());
    expect(screen.getByRole("img", { name: "Foto de Pessoa Sintética" }).getAttribute("src")).not.toBe(previous);
  });
  it("tenta após retomar a janela e mantém fallback se falhar outra vez", () => {
    render(<EmployeeAvatar name="Pessoa Sintética" ownProfile />);
    fireEvent.error(screen.getByRole("img", { name: "Foto de Pessoa Sintética" }));
    fireEvent.focus(window);
    const image = screen.getByRole("img", { name: "Foto de Pessoa Sintética" });
    expect(image).toHaveAttribute("src", expect.stringContaining("/api/monitoring/photo?revision="));
    fireEvent.error(image);
    expect(screen.getByRole("img", { name: "Pessoa Sintética — foto indisponível" })).toBeInTheDocument();
  });
  it("usa endpoint separado para revisão Defense e preserva zeros", () => {
    render(<EmployeeAvatar name="Cadastro Sintético" identity={{ sourceId: "defense-test", value: "000123" }} />);
    expect(screen.getByRole("img")).toHaveAttribute("src", expect.stringContaining("/api/monitoring/identity-photo?sourceId=defense-test&identityValue=000123"));
  });
});
