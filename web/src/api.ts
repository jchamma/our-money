// Same-origin JSON calls. The session is an HttpOnly cookie; nothing secret lives in JS.
import { useCallback, useEffect, useState } from "react";

/** Fired when an /api call answers 401 (the session expired): the app goes back to login. */
export const SIGNED_OUT = "ff:signed-out";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401 && path.startsWith("/api/")) window.dispatchEvent(new Event(SIGNED_OUT));
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? "error");
  return data as T;
}

export const api = {
  get: <T>(path: string) => call<T>("GET", path),
  post: <T>(path: string, body?: unknown) => call<T>("POST", path, body ?? {}),
  put: <T>(path: string, body: unknown) => call<T>("PUT", path, body),
};

/**
 * GET `path` for a screen. A response for an earlier path (say, the month before a quick
 * switch) is dropped; the data resets when the path changes and stays on screen during `reload`.
 */
export function useLoad<T>(path: string) {
  const [state, setState] = useState<{ path: string; data?: T; failed?: boolean }>({ path });
  const [round, setRound] = useState(0);
  useEffect(() => {
    let live = true;
    setState((s) => (s.path === path ? { ...s, failed: false } : { path }));
    api.get<T>(path).then(
      (data) => live && setState({ path, data }),
      () => live && setState((s) => ({ ...s, path, failed: true })),
    );
    return () => {
      live = false;
    };
  }, [path, round]);
  const reload = useCallback(() => setRound((r) => r + 1), []);
  const current = state.path === path;
  return { data: current ? state.data : undefined, failed: current && !!state.failed, reload };
}

// Response shapes (mirrors src/months.ts and src/index.ts).
export type Tx = {
  id: string;
  date: string;
  merchant: string;
  amount: number;
  income: boolean;
  category: string | null;
  account: string | null;
  projectId: number | null;
  projectCategoryId: number | null;
};
export type Line = { plan: number; actual: number; expected: number };
export type Home = {
  month: string;
  syncedAt: string | null;
  hasBudget: boolean;
  net: number;
  variable: Line & { transactions: Tx[] };
  tracked: (Line & { key: string; name: string | null; transactions: Tx[] })[];
  fixed: Line & { transactions: Tx[] };
  income: Line & { transactions: Tx[] };
  notInCashflow: Tx[];
  summary: { ongoing: number; projects: { id: number; name: string; net: number }[]; total: number };
};
export type ProjectMonth = {
  project: { id: number; name: string; status: string };
  month: string;
  net: number;
  expenses: Line;
  income: Line;
  categories: (Line & { id: number; name: string; kind: "expense" | "income"; transactions: Tx[] })[];
};
export type Me = {
  me: { id: number; name: string; nameConfirmed: boolean };
  members: { id: number; name: string }[];
  lastSync: { finished_at: string; status: string } | null;
  token: { status: "ok" | "expired" | "missing"; expiresAt: string | null };
  mode: "passkey" | "google" | "email";
};
export type Project = { id: number; name: string; status: string };
