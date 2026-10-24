import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  it("carrega miniatura na lista e foto inteira no zoom, sem esticar além da resolução original", async () => {
    render(<EmployeeAvatar name="Pessoa Sintética" employeeId="synthetic-id" />);
    const thumbnail = screen.getByRole("img", { name: "Foto de Pessoa Sintética" });
    expect(thumbnail).toHaveAttribute("src", expect.stringContaining("&size=avatar"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ampliar foto de Pessoa Sintética" }));
    const preview = screen.getByRole("img", { name: "Foto ampliada de Pessoa Sintética" });
    expect(preview.getAttribute("src")).not.toContain("size=avatar");
    Object.defineProperties(preview, { naturalWidth: { value: 300 }, naturalHeight: { value: 400 } });
    fireEvent.load(preview);
    await waitFor(() => expect(preview.style.width).toBe("min(70vw, 52.5dvh, 300px)"));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
