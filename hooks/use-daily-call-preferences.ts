"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { workspaceRequest } from "@/lib/workspace/client";
import type { DailyCallPreferencePatch, DailyCallPreferences } from "@/lib/workspace/contracts";

type State = DailyCallPreferences & { loading: boolean; saving: boolean; error: string | null };
type Draft = { version: 1; id: string; patch: DailyCallPreferencePatch };
type Session = { userId: string; alive: boolean; loaded: boolean; saving: boolean; conflicts: number; storedDraftId: string | null; value: State; draft: Draft | null; load: () => void; flush: () => void };
const storageKey = (userId: string) => `daily-call-preferences:v1:${userId}`;
const initialState = (userId: string): State => ({ userId, viewMode: "today", columnsCollapsed: false, updatedAt: null, loading: true, saving: false, error: null });

function readDraft(userId: string): Draft | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey(userId)) ?? "null");
    if (!value || typeof value !== "object") return null;
    const draft = value as Draft;
    if (draft.version !== 1 || typeof draft.id !== "string" || !draft.patch || typeof draft.patch !== "object") return null;
    const { viewMode, columnsCollapsed } = draft.patch;
    if (viewMode !== undefined && viewMode !== "today" && viewMode !== "period") return null;
    if (columnsCollapsed !== undefined && typeof columnsCollapsed !== "boolean") return null;
    if (viewMode === undefined && columnsCollapsed === undefined) return null;
    return { version: 1, id: draft.id, patch: { ...(viewMode !== undefined && { viewMode }), ...(columnsCollapsed !== undefined && { columnsCollapsed }) } };
  } catch { return null; }
}
function writeDraft(userId: string, draft: Draft) {
  try { localStorage.setItem(storageKey(userId), JSON.stringify(draft)); return true; } catch { return false; }
}
function clearDraft(userId: string, draftId: string) {
  try { if (readDraft(userId)?.id === draftId) localStorage.removeItem(storageKey(userId)); } catch { /* Browser storage can be disabled. */ }
}
function checkedResult(value: DailyCallPreferences, userId: string) {
  if (!value || value.userId !== userId || !["today", "period"].includes(value.viewMode) || typeof value.columnsCollapsed !== "boolean") throw new Error("Preferências inválidas.");
  return value;
}

export function useDailyCallPreferences(userId: string) {
  const [state, setState] = useState<State>(() => initialState(userId));
  const sessionRef = useRef<Session | null>(null);

  useEffect(() => {
    const readAbort = new AbortController();
    const draft = readDraft(userId);
    const session: Session = {
      userId, alive: true, loaded: false, saving: false, conflicts: 0, storedDraftId: draft?.id ?? null, draft,
      value: { ...initialState(userId), ...draft?.patch }, load: () => {}, flush: () => {},
    };
    sessionRef.current = session;
    const publish = (patch: Partial<State>) => {
      session.value = { ...session.value, ...patch };
      if (session.alive) setState(session.value);
    };
    session.flush = () => {
      if (!session.alive || !session.loaded || session.saving || !session.draft) return;
      const savingDraft = session.draft;
      session.saving = true;
      publish({ saving: true, error: null });
      // Keep this small request alive across navigation. The identity guard in SQL
      // prevents it from being applied under a newly authenticated account.
      void workspaceRequest<DailyCallPreferences>("save_daily_call_preferences", { expectedUserId: userId, expectedUpdatedAt: session.value.updatedAt, ...savingDraft.patch }, undefined, { keepalive: true })
        .then(value => {
          const saved = checkedResult(value, userId);
          if (session.draft?.id === savingDraft.id) session.draft = null;
          clearDraft(userId, savingDraft.id);
          publish({ ...saved, ...session.draft?.patch, saving: false, error: null });
          session.saving = false;
          session.conflicts = 0;
          session.flush();
        })
        .catch((error: unknown) => {
          session.saving = false;
          if (session.alive && error && typeof error === "object" && "code" in error && error.code === "WORKSPACE_STALE" && session.conflicts < 3) {
            if (session.storedDraftId) {
              // Another tab may already have saved a newer choice. Never replay
              // this tab's obsolete draft after its version was rejected.
              const latestDraft = readDraft(userId);
              if (latestDraft?.id !== session.storedDraftId) {
                session.draft = latestDraft;
                session.storedDraftId = latestDraft?.id ?? null;
              }
            }
            session.conflicts += 1;
            session.loaded = false;
            session.load();
            return;
          }
          publish({ saving: false, error: "Não foi possível salvar sua visualização. Tente novamente." });
        });
    };
    session.load = () => {
      publish({ loading: true, saving: session.saving, error: null });
      void workspaceRequest<DailyCallPreferences>("daily_call_preferences", { expectedUserId: userId }, readAbort.signal)
        .then(value => {
          if (!session.alive) return;
          const saved = checkedResult(value, userId);
          session.loaded = true;
          publish({ ...saved, ...session.draft?.patch, loading: false });
          session.flush();
        })
        .catch(() => {
          if (!session.alive) return;
          session.loaded = true;
          publish({ loading: false, error: "Não foi possível carregar sua visualização salva. Tente novamente." });
          session.flush();
        });
    };
    void Promise.resolve().then(() => { if (session.alive) session.load(); });
    return () => { session.alive = false; readAbort.abort(); };
  }, [userId]);

  const update = useCallback((patch: DailyCallPreferencePatch) => {
    const session = sessionRef.current;
    if (!session?.alive || session.userId !== userId) return;
    session.conflicts = 0;
    session.draft = { version: 1, id: crypto.randomUUID(), patch: { ...session.draft?.patch, ...patch } };
    session.storedDraftId = writeDraft(userId, session.draft) ? session.draft.id : null;
    session.value = { ...session.value, ...patch };
    setState(session.value);
    session.flush();
  }, [userId]);
  const setViewMode = useCallback((viewMode: DailyCallPreferences["viewMode"]) => update({ viewMode }), [update]);
  const setColumnsCollapsed = useCallback((columnsCollapsed: boolean) => update({ columnsCollapsed }), [update]);
  const retry = useCallback(() => {
    const session = sessionRef.current;
    if (!session?.alive || session.userId !== userId) return;
    session.conflicts = 0;
    if (session.draft && session.loaded) session.flush();
    else session.load();
  }, [userId]);
  // Account changes never display the previous user's choices while the new read runs.
  return { ...(state.userId === userId ? state : initialState(userId)), setViewMode, setColumnsCollapsed, retry };
}
