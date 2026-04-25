"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type SessionState = {
  loading: boolean;
  loggedIn: boolean;
  isAdmin: boolean;
  isTrainer: boolean;
  refresh: () => Promise<void>;
};

const SessionContext = createContext<SessionState>({
  loading: true,
  loggedIn: false,
  isAdmin: false,
  isTrainer: false,
  refresh: async () => {},
});

/**
 * Single source of truth for "who am I + what can I do" across the app. Wrap
 * the app in {@link SessionGate} once at the layout level and read state via
 * {@link useSession} from any child. Eliminates the dozens of duplicated
 * `/api/auth/session` + role-status fetches sprinkled across components.
 */
export function SessionGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Omit<SessionState, "refresh">>({
    loading: true,
    loggedIn: false,
    isAdmin: false,
    isTrainer: false,
  });

  async function load() {
    try {
      const sessionRes = await fetch("/api/auth/session", {
        cache: "no-store",
      });
      const sessionData = await sessionRes.json().catch(() => ({}));
      const loggedIn = !!sessionData?.user;
      if (!loggedIn) {
        setState({
          loading: false,
          loggedIn: false,
          isAdmin: false,
          isTrainer: false,
        });
        return;
      }
      const [adminRes, trainerRes] = await Promise.all([
        fetch("/api/admin/status", { cache: "no-store" })
          .then((r) => r.json())
          .catch(() => ({ isAdmin: false })),
        fetch("/api/trainer/status", { cache: "no-store" })
          .then((r) => r.json())
          .catch(() => ({ isTrainer: false })),
      ]);
      setState({
        loading: false,
        loggedIn: true,
        isAdmin: !!adminRes?.isAdmin,
        isTrainer: !!trainerRes?.isTrainer,
      });
    } catch {
      setState({
        loading: false,
        loggedIn: false,
        isAdmin: false,
        isTrainer: false,
      });
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const value = useMemo<SessionState>(
    () => ({ ...state, refresh: load }),
    [state],
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

/** Read the cached session/role state. Returns sensible defaults during SSR. */
export function useSession(): SessionState {
  return useContext(SessionContext);
}
