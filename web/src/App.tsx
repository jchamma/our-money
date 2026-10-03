import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, SIGNED_OUT, type Me } from "./api";
import { currentMonth, navigate, usePath } from "./router";
import { ConfirmName, EmailLogin, GoogleLogin, Invite, NoAccess, PasskeyLogin, RenewToken } from "./screens/Auth";
import { Home } from "./screens/Home";
import { ProjectPage } from "./screens/ProjectPage";
import { t } from "./strings";

type Session = { state: "loading" } | { state: "error" } | { state: "out"; mode: Me["mode"] } | { state: "in"; me: Me };

function useSession() {
  const [session, setSession] = useState<Session>({ state: "loading" });
  const refresh = useCallback(async () => {
    try {
      setSession({ state: "in", me: await api.get<Me>("/api/me") });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        try {
          const { mode } = await api.get<{ mode: Me["mode"] }>("/auth/mode");
          setSession({ state: "out", mode });
          return;
        } catch {
          /* falls through to the error state */
        }
      }
      setSession({ state: "error" });
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  /** Updates `me` in the background; a failed call keeps what's on screen. */
  const softRefresh = useCallback(() => {
    api.get<Me>("/api/me").then((me) => setSession({ state: "in", me }), () => undefined);
  }, []);
  // A session that expires while the app is open: back to login (only from signed in, or it would loop).
  const signedIn = useRef(false);
  signedIn.current = session.state === "in";
  useEffect(() => {
    const out = () => signedIn.current && void refresh();
    window.addEventListener(SIGNED_OUT, out);
    return () => window.removeEventListener(SIGNED_OUT, out);
  }, [refresh]);
  return { session, refresh, softRefresh };
}

const monthParam = (search: string) => {
  const m = new URLSearchParams(search).get("month");
  return m && /^\d{4}-(0[1-9]|1[0-2])$/.test(m) && m <= currentMonth() ? m : currentMonth();
};

export function App() {
  const path = usePath();
  const { session, refresh, softRefresh } = useSession();
  const [pathname, search = ""] = path.split("?");

  // The invite link works signed out; it's the only way in with passkeys.
  const invite = /^\/invite\/([^/]+)$/.exec(pathname);
  if (invite) return <Invite token={decodeURIComponent(invite[1])} onIn={refresh} />;

  if (session.state === "loading") return <p className="foot">{t.loading}</p>;
  if (session.state === "error") return <p className="foot">{t.genericError}</p>;

  if (session.state === "out") {
    if (pathname === "/no-access") return <NoAccess />;
    if (session.mode === "google") return <GoogleLogin />;
    if (session.mode === "email") return <EmailLogin onIn={refresh} />;
    return <PasskeyLogin onIn={refresh} />;
  }

  const { me } = session;
  if (!me.me.nameConfirmed) return <ConfirmName me={me} onDone={refresh} />;

  const logout = async () => {
    await api.post("/auth/logout").catch(() => undefined);
    navigate("/", true);
    await refresh();
  };
  const month = monthParam(`?${search}`);
  const project = /^\/projects\/(\d+)$/.exec(pathname);
  if (project) return <ProjectPage id={Number(project[1])} month={month} />;
  if (pathname === "/renew-token") return <RenewToken me={me} onDone={refresh} />;
  return <Home me={me} month={month} onLogout={logout} onSynced={softRefresh} />;
}
