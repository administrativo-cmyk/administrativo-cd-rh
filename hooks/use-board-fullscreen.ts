"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Keep the same table mounted so drafts, selection and scroll survive expansion. */
export function useBoardFullscreen() {
  const [expanded, setExpanded] = useState(false);
  const region = useRef<HTMLElement | null>(null);
  const ownsFullscreen = useRef(false);
  const close = useCallback(() => {
    setExpanded(false);
    if (ownsFullscreen.current && document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    ownsFullscreen.current = false;
  }, []);
  const toggle = useCallback(() => {
    if (expanded) { close(); return; }
    setExpanded(true);
    // The document root keeps menus and employee drawers inside native fullscreen.
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
      ownsFullscreen.current = true;
      void document.documentElement.requestFullscreen().then(() => {
        if (!ownsFullscreen.current && document.fullscreenElement === document.documentElement) void document.exitFullscreen().catch(() => {});
      }).catch(() => { ownsFullscreen.current = false; });
    }
  }, [expanded, close]);

  useEffect(() => {
    if (!expanded || !region.current) return;
    const board = region.current;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    const siblings = new Map<HTMLElement, boolean>();
    // Only the board and subsequently opened portals remain interactive.
    for (let node: HTMLElement | null = board; node?.parentElement && node !== document.body; node = node.parentElement) {
      for (const sibling of node.parentElement.children) if (sibling !== node && sibling instanceof HTMLElement) {
        siblings.set(sibling, Boolean(sibling.inert)); sibling.inert = true;
      }
    }
    document.body.style.overflow = "hidden";
    const onFullscreen = () => { if (!document.fullscreenElement) close(); };
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || (event.target instanceof Node && !board.contains(event.target))) return;
      const overlayOpen = [...document.querySelectorAll('[role="dialog"], [role="menu"], [role="listbox"]')].some(node => node.getClientRects().length > 0);
      if (overlayOpen) return;
      if (event.key === "Escape") { event.preventDefault(); close(); return; }
      if (event.key !== "Tab") return;
      const elements = [...board.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter(node => node.getClientRects().length > 0);
      const first = elements[0]; const last = elements.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("fullscreenchange", onFullscreen);
    return () => {
      window.removeEventListener("keydown", onKey); document.removeEventListener("fullscreenchange", onFullscreen);
      siblings.forEach((inert, node) => { node.inert = inert; }); document.body.style.overflow = overflow;
      trigger?.focus({ preventScroll: true });
      const shouldExit = ownsFullscreen.current;
      ownsFullscreen.current = false;
      if (shouldExit && document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    };
  }, [expanded, close]);
  return { expanded, region, toggle };
}
