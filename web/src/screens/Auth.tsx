// Login screens (frames 7b–7g, 7j–7k) and the RiseUp token renewal (7n).
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { api, ApiError, type Me } from "../api";
import { shortDate } from "../money";
import { currentMonth, navigate } from "../router";
import { t } from "../strings";

const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent);

function Brand() {
  return (
    <div className="brand">
      <div className="mark" aria-hidden>
        ₪
      </div>
      <span className="wm">{t.appName}</span>
    </div>
  );
}

function Screen({ title, sub, children, fine }: { title: string; sub?: string; children?: ReactNode; fine?: ReactNode }) {
  return (
    <main className="login">
      <Brand />
      <h1 className="lh">{title}</h1>
      {sub && <p className="lsub">{sub}</p>}
      {children}
      {fine && <div className="fine">{fine}</div>}
    </main>
  );
}

const errorText = (e: unknown) => (e instanceof ApiError && e.status === 429 ? t.tooMany : t.genericError);

function FaceIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
      <path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3" />
      <path d="M9 9v1.5M15 9v1.5M12 9v4h-1M9 16c1.8 1.3 4.2 1.3 6 0" />
    </svg>
  );
}

function FingerprintIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden>
      <path d="M6.5 18.5c1-1.8 1.5-3.8 1.5-6a4 4 0 0 1 8 0c0 1.2-.1 2.4-.3 3.5" />
      <path d="M12 12.5c0 3-.8 5.8-2.3 8" />
      <path d="M4.5 15c.3-.8.5-1.6.5-2.5a7 7 0 0 1 12.2-4.7" />
      <path d="M19 10.5c.3.6.5 1.3.6 2 .1 2.2-.2 4.4-.9 6.5" />
      <path d="M14.8 17.5c-.3 1.2-.8 2.4-1.4 3.5" />
    </svg>
  );
}

/** 7c / 7c′: one tap, labelled for the phone. */
export function PasskeyLogin({ onIn }: { onIn: () => void }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const login = async () => {
    setBusy(true);
    setError("");
    try {
      const options = await api.post<Parameters<typeof startAuthentication>[0]["optionsJSON"]>("/auth/passkey/login/options");
      const response = await startAuthentication({ optionsJSON: options });
      await api.post("/auth/passkey/login/verify", response);
      onIn();
    } catch (e) {
      if ((e as Error)?.name !== "NotAllowedError") setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen title={t.welcomeBack} sub={t.biometricSub} fine={t.newPhone}>
      <button type="button" className="btn" style={{ marginTop: 32 }} disabled={busy} onClick={login}>
        {isIos() ? <FaceIcon /> : <FingerprintIcon />}
        {isIos() ? t.loginFaceId : t.loginFingerprint}
      </button>
      {error && <div className="error">{error}</div>}
    </Screen>
  );
}

/** 7b → 7b′, or 7g when the link is used or expired. */
export function Invite({ token, onIn }: { token: string; onIn: () => void }) {
  const [valid, setValid] = useState<boolean | null>(null);
  const [name, setName] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.post<{ valid: boolean }>("/auth/passkey/invite", { invite: token }).then((r) => setValid(r.valid), () => setValid(false));
  }, [token]);

  if (valid === null) return null;
  if (!valid) {
    return (
      <Screen
        title={t.inviteInvalid}
        sub={t.inviteInvalidSub}
        fine={
          <>
            {t.alreadyHaveAccess}{" "}
            <button type="button" onClick={() => navigate("/", true)}>
              {t.login}
            </button>
          </>
        }
      />
    );
  }
  if (done) {
    return (
      <main className="login">
        <div className="ok" aria-hidden>
          ✓
        </div>
        <h1 className="lh" style={{ marginTop: 22 }}>
          {t.allSet(name.trim())}
        </h1>
        <p className="lsub">{t.allSetSub}</p>
        <button
          type="button"
          className="btn"
          onClick={() => {
            navigate("/", true);
            onIn();
          }}
        >
          {t.toCashflow(currentMonth())}
        </button>
      </main>
    );
  }
  const enrol = async () => {
    setBusy(true);
    setError("");
    try {
      const options = await api.post<Parameters<typeof startRegistration>[0]["optionsJSON"]>("/auth/passkey/register/options", { invite: token, name: name.trim() });
      const response = await startRegistration({ optionsJSON: options });
      await api.post("/auth/passkey/register/verify", response);
      setDone(true);
    } catch (e) {
      if (e instanceof ApiError && e.status === 410) setValid(false);
      else if ((e as Error)?.name !== "NotAllowedError") setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen title={t.welcome} sub={t.inviteSub} fine={t.inviteFine}>
      <div className="lcard">
        <label className="flabel first" htmlFor="name">
          {t.yourName}
        </label>
        <div className="inp txt">
          <input id="name" autoComplete="given-name" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="help">{t.nameHelp}</div>
        {error && <div className="error">{error}</div>}
        <button type="button" className="btn" disabled={!name.trim() || busy} onClick={enrol}>
          <FaceIcon />
          {t.enableBiometric}
        </button>
      </div>
    </Screen>
  );
}

/** 7d. */
export function GoogleLogin() {
  const error = new URLSearchParams(location.search).get("error");
  return (
    <Screen title={t.welcomeBack} sub={t.googleSub} fine={t.onlySetUpAccounts}>
      <a className="btn plain" style={{ marginTop: 32, textDecoration: "none" }} href="/auth/google/start">
        <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden>
          <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
          <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
          <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
          <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
        </svg>
        {t.continueWithGoogle}
      </a>
      {error && <div className="error">{error === "rate" ? t.tooMany : t.genericError}</div>}
    </Screen>
  );
}

/** 7f (Google, an account that isn't allowed). */
export function NoAccess() {
  return (
    <Screen title={t.noAccessTitle} sub={t.noAccessSub} fine={t.needAccess}>
      <a className="btn plain" style={{ marginTop: 32, textDecoration: "none" }} href="/auth/google/start">
        {t.otherAccount}
      </a>
    </Screen>
  );
}

/** 7j → 7k. */
export function EmailLogin({ onIn }: { onIn: () => void }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [digits, setDigits] = useState(["", "", "", "", "", ""]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const boxes = useRef<(HTMLInputElement | null)[]>([]);

  const send = async () => {
    setBusy(true);
    setError("");
    try {
      await api.post("/auth/email/start", { email: email.trim() });
      setSent(true);
      setDigits(["", "", "", "", "", ""]);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const verify = async (code: string) => {
    setBusy(true);
    setError("");
    try {
      await api.post("/auth/email/verify", { email: email.trim(), code });
      onIn();
    } catch (e) {
      setError(e instanceof ApiError && e.status === 400 ? t.wrongCode : errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const type = (i: number, v: string) => {
    const clean = v.replace(/\D/g, "");
    const next = [...digits];
    if (clean.length > 1) clean.slice(0, 6).split("").forEach((d, k) => (next[k] = d)); // pasted code
    else next[i] = clean;
    setDigits(next);
    if (clean && i < 5) boxes.current[Math.min(5, clean.length > 1 ? clean.length : i + 1)]?.focus();
    if (next.every(Boolean)) void verify(next.join(""));
  };

  if (!sent) {
    return (
      <Screen title={t.welcomeBack} sub={t.emailSub} fine={t.onlySetUpEmails}>
        <div className="lcard">
          <label className="flabel first" htmlFor="email">
            {t.emailLabel}
          </label>
          <div className="inp ltr">
            <input id="email" type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          {error && <div className="error">{error}</div>}
          <button type="button" className="btn" disabled={!email.includes("@") || busy} onClick={send}>
            {t.sendCode}
          </button>
        </div>
      </Screen>
    );
  }
  return (
    <Screen title={t.checkEmail} sub={`${t.codeSentTo}${email.trim()}`} fine={t.codeFine}>
      <div className="lcard">
        <div className="code">
          {digits.map((d, i) => (
            <input
              key={i}
              ref={(el) => {
                boxes.current[i] = el;
              }}
              aria-label={`${i + 1}`}
              inputMode="numeric"
              autoComplete={i === 0 ? "one-time-code" : "off"}
              maxLength={i === 0 ? 6 : 1}
              value={d}
              onChange={(e) => type(i, e.target.value)}
              onKeyDown={(e) => e.key === "Backspace" && !digits[i] && i > 0 && boxes.current[i - 1]?.focus()}
            />
          ))}
        </div>
        {error && <div className="error">{error}</div>}
        <button type="button" className="btn" disabled={!digits.every(Boolean) || busy} onClick={() => verify(digits.join(""))}>
          {t.login}
        </button>
        <button type="button" className="ghost" disabled={busy} onClick={send}>
          {t.resendCode}
        </button>
      </div>
    </Screen>
  );
}

/** 7e: first login with Google or email. */
export function ConfirmName({ me, onDone }: { me: Me; onDone: () => void }) {
  const [name, setName] = useState(me.me.name);
  const [error, setError] = useState("");
  const save = async () => {
    try {
      await api.put("/api/me/name", { name: name.trim() });
      onDone();
    } catch {
      setError(t.genericError);
    }
  };
  return (
    <Screen title={t.almostThere} sub={t.nameSub}>
      <div className="lcard">
        <div className="who">
          <div className="avatar" aria-hidden>
            {(name.trim() || "?").slice(0, 1)}
          </div>
          <div className="n">{me.mode === "google" ? t.signedInWithGoogle : t.signedInWithEmail}</div>
        </div>
        <label className="flabel first" htmlFor="me-name">
          {t.whatToCallYou}
        </label>
        <div className="inp txt">
          <input id="me-name" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="help">{t.nameHelp}</div>
        {error && <div className="error">{error}</div>}
        <button type="button" className="btn" disabled={!name.trim()} onClick={save}>
          {t.continue}
        </button>
      </div>
    </Screen>
  );
}

/** 7n. */
export function RenewToken({ me, onDone }: { me: Me; onDone: () => void }) {
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      await api.put("/api/riseup-token", { token: token.trim() });
      setToken("");
      onDone();
      navigate("/", true);
    } catch (e) {
      setError(e instanceof ApiError && e.status === 400 ? t.tokenRejected : errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <main>
      <header className="topnav">
        <button type="button" className="back" aria-label={t.back} onClick={() => navigate("/")}>
          <span className="arr">›</span>
        </button>
        <h1 className="ptitle">{t.renewTitle}</h1>
        <span style={{ width: 44 }} />
      </header>
      <section className="card" style={{ marginTop: 12 }}>
        <p className="hero-q">{t.renewHow}</p>
        <ol className="steps">
          <li>{t.renewStep1}</li>
          <li>{t.renewStep2}</li>
          <li>{t.renewStep3}</li>
        </ol>
        <label className="flabel" htmlFor="token">
          {t.newToken}
        </label>
        <div className="inp ltr">
          <input id="token" type="password" autoComplete="off" spellCheck={false} value={token} onChange={(e) => setToken(e.target.value)} />
        </div>
        <div className="help">{t.tokenHelp}</div>
        {error && <div className="error">{error}</div>}
        <button type="button" className="btn" disabled={token.trim().length < 16 || busy} onClick={save}>
          {t.saveAndSync}
        </button>
      </section>
      {me.token.expiresAt && <div className="foot">{t.currentTokenUntil(shortDate(me.token.expiresAt))}</div>}
    </main>
  );
}
