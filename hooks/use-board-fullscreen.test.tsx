import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useBoardFullscreen } from "./use-board-fullscreen";

function Board() {
  const { expanded, region, toggle } = useBoardFullscreen();
  return <main><button data-testid="outside">Filtros</button><section ref={region} data-testid="board" data-expanded={expanded}>
    <button aria-pressed={expanded} onClick={toggle}>{expanded ? "Sair da tela cheia" : "Tela cheia"}</button>
    <input aria-label="Rascunho da observação" defaultValue="" />
  </section></main>;
}
const originalRequest = Object.getOwnPropertyDescriptor(document.documentElement, "requestFullscreen");
const originalFullscreen = Object.getOwnPropertyDescriptor(document, "fullscreenElement");
const originalExit = Object.getOwnPropertyDescriptor(document, "exitFullscreen");
afterEach(() => {
  vi.restoreAllMocks(); document.body.style.overflow = "";
  for (const [target, key, descriptor] of [[document.documentElement, "requestFullscreen", originalRequest], [document, "fullscreenElement", originalFullscreen], [document, "exitFullscreen", originalExit]] as const) {
    if (descriptor) Object.defineProperty(target, key, descriptor); else Reflect.deleteProperty(target, key);
  }
});

describe("ampliação do quadro", () => {
  it("preserva rascunho e devolve foco e interação ao sair por Esc", async () => {
    const user = userEvent.setup(); render(<Board />);
    await user.type(screen.getByLabelText("Rascunho da observação"), "Conferência em andamento");
    await user.click(screen.getByRole("button", { name: "Tela cheia" }));
    expect(screen.getByTestId("board")).toHaveAttribute("data-expanded", "true");
    expect(screen.getByTestId("outside").inert).toBe(true); expect(document.body.style.overflow).toBe("hidden");
    await user.keyboard("{Escape}");
    expect(screen.getByLabelText("Rascunho da observação")).toHaveValue("Conferência em andamento");
    expect(screen.getByTestId("outside").inert).toBe(false); expect(document.body.style.overflow).toBe("");
    expect(screen.getByRole("button", { name: "Tela cheia" })).toHaveFocus();
  });
  it("mantém quadro ampliado quando navegador recusa fullscreen nativo", async () => {
    const request = vi.fn().mockRejectedValue(new Error("Not allowed"));
    Object.defineProperty(document.documentElement, "requestFullscreen", { value: request, configurable: true });
    const user = userEvent.setup(); render(<Board />);
    await user.click(screen.getByRole("button", { name: "Tela cheia" }));
    await waitFor(() => expect(request).toHaveBeenCalledOnce());
    expect(screen.getByTestId("board")).toHaveAttribute("data-expanded", "true");
    await user.click(screen.getByRole("button", { name: "Sair da tela cheia" }));
    expect(screen.getByTestId("outside").inert).toBe(false);
  });
  it("acompanha saída nativa e remove bloqueios ao desmontar", async () => {
    const user = userEvent.setup(); const view = render(<Board />);
    await user.click(screen.getByRole("button", { name: "Tela cheia" }));
    fireEvent(document, new Event("fullscreenchange"));
    expect(screen.getByTestId("board")).toHaveAttribute("data-expanded", "false");
    await user.click(screen.getByRole("button", { name: "Tela cheia" }));
    view.unmount(); expect(document.body.style.overflow).toBe("");
  });
  it("sai do fullscreen se a autorização nativa chegar depois de desmontar", async () => {
    let finish!: () => void;
    const request = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const exit = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(document.documentElement, "requestFullscreen", { value: request, configurable: true });
    Object.defineProperty(document, "exitFullscreen", { value: exit, configurable: true });
    const user = userEvent.setup(); const view = render(<Board />);
    await user.click(screen.getByRole("button", { name: "Tela cheia" }));
    view.unmount();
    Object.defineProperty(document, "fullscreenElement", { value: document.documentElement, configurable: true });
    finish(); await waitFor(() => expect(exit).toHaveBeenCalledOnce());
  });
});
