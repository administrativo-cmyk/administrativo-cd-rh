"use client";

import { useEffect, useState } from "react";
import { groupCatalogSchema, type GroupCatalog } from "@/lib/monitoring/group-catalog";
import { requestJson } from "./shared";

export function useGroupCatalog(scope: "admin" | "query" = "admin") {
  const [catalog, setCatalog] = useState<GroupCatalog | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let disposed = false;
    let pending: AbortController | null = null;
    const refresh = async () => {
      if (pending || document.visibilityState !== "visible") return;
      const controller = new AbortController();
      pending = controller;
      try {
        const result = groupCatalogSchema.parse(await requestJson(scope === "query" ? "/api/monitoring/groups?scope=query" : "/api/monitoring/groups", { signal: controller.signal }));
        if (!disposed) { setCatalog(result); setError(""); }
      } catch (cause) {
        if (!disposed && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Não foi possível carregar os grupos.");
      } finally { if (pending === controller) pending = null; }
    };
    void refresh();
    const interval = window.setInterval(() => { void refresh(); }, 30000);
    const onVisible = () => { void refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      disposed = true; pending?.abort(); window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible); window.removeEventListener("focus", onVisible);
    };
  }, [scope, revision]);
  return { catalog, error, retry: () => setRevision(previous => previous + 1) };
}
