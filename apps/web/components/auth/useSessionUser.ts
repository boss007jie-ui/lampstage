"use client";

import { useEffect, useState } from "react";
import { SESSION_CHANGE_EVENT, SESSION_LOGOUT_STORAGE_KEY } from "./session-events";

type SessionUser = { id: string; name: string | null; email: string | null; phone: string | null };

// undefined means the session has not been verified; null means signed out.
export function useSessionUser() {
  const [user, setUser] = useState<SessionUser | null | undefined>(undefined);

  useEffect(() => {
    let epoch = 0;
    let request: AbortController | undefined;
    const invalidate = () => {
      epoch += 1;
      request?.abort();
    };
    const refresh = async () => {
      invalidate();
      const currentEpoch = epoch;
      const controller = new AbortController();
      request = controller;
      const timeout = window.setTimeout(() => controller.abort(), 10_000);
      try {
        const response = await fetch("/api/me", {
          cache: "no-store", credentials: "same-origin", signal: controller.signal,
        });
        if (currentEpoch !== epoch) return;
        if (response.status === 401) { setUser(null); return; }
        if (!response.ok) throw new Error("session_unavailable");
        const data: unknown = await response.json();
        if (currentEpoch !== epoch) return;
        if (!data || typeof data !== "object" || !("id" in data) || typeof data.id !== "string") {
          throw new Error("invalid_session_response");
        }
        const profile = data as Record<string, unknown>;
        setUser({
          id: data.id,
          name: typeof profile.name === "string" ? profile.name.trim() || null : null,
          email: typeof profile.email === "string" ? profile.email.trim() || null : null,
          phone: typeof profile.phone === "string" ? profile.phone.trim() || null : null,
        });
      } catch {
        if (currentEpoch === epoch) setUser(undefined);
      } finally {
        window.clearTimeout(timeout);
      }
    };
    const onSessionChange = (event: Event) => {
      if ((event as CustomEvent).detail === "expired") {
        invalidate();
        setUser(null);
      } else {
        setUser(undefined);
        void refresh();
      }
    };
    const onReturn = () => { if (document.visibilityState === "visible") void refresh(); };
    const onStorage = (event: StorageEvent) => {
      if (event.key === SESSION_LOGOUT_STORAGE_KEY && event.newValue) {
        invalidate();
        setUser(null);
      }
    };
    window.addEventListener(SESSION_CHANGE_EVENT, onSessionChange);
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", onReturn);
    window.addEventListener("pageshow", onReturn);
    document.addEventListener("visibilitychange", onReturn);
    void refresh();
    return () => {
      invalidate();
      window.removeEventListener(SESSION_CHANGE_EVENT, onSessionChange);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", onReturn);
      window.removeEventListener("pageshow", onReturn);
      document.removeEventListener("visibilitychange", onReturn);
    };
  }, []);

  return user;
}
