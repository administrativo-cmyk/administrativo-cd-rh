import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DailyCallObservation } from "./daily-call-observation";

describe("rascunho de observação", () => {
  it.each(["conflict", "network"])("preserva texto após %s e permite tentar novamente", async (failure) => {
    const onSave = vi.fn().mockImplementationOnce(async () => {
      if (failure === "network") throw new Error("offline");
      return false;
    }).mockResolvedValueOnce(true);
    const { rerender } = render(<DailyCallObservation label="Observação" value="Original" status="P" readOnly={false} saving={false} onSave={onSave} />);
    const input = screen.getByRole("textbox", { name: "Observação" });
    fireEvent.change(input, { target: { value: "Rascunho" } });
    fireEvent.blur(input);
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(input).toHaveValue("Rascunho");
    fireEvent.blur(input);
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
    rerender(<DailyCallObservation label="Observação" value="Rascunho" status="P" readOnly={false} saving={false} onSave={onSave} />);
    expect(input).toHaveValue("Rascunho");
  });
});
