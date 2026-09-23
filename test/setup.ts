import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
  document.body.style.removeProperty("pointer-events");
});

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

Object.defineProperty(window, "ResizeObserver", { writable: true, value: ResizeObserverMock });
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({ matches: false, media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false }),
});
Object.defineProperty(Element.prototype, "scrollIntoView", { writable: true, value: () => {} });
Object.defineProperty(Element.prototype, "hasPointerCapture", { writable: true, value: () => false });
Object.defineProperty(Element.prototype, "setPointerCapture", { writable: true, value: () => {} });
Object.defineProperty(Element.prototype, "releasePointerCapture", { writable: true, value: () => {} });
