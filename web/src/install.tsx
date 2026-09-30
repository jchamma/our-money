// The one-time "add to home screen" card (frame 7l). Android gets the browser's install prompt;
// iPhone has none, so the card explains the two taps. Gone once installed or dismissed.
import { useEffect, useState } from "react";
import { t } from "./strings";

type PromptEvent = Event & { prompt: () => Promise<void> };
let deferred: PromptEvent | null = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferred = e as PromptEvent;
});

const KEY = "install-card-dismissed";
const standalone = () => window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
const ios = () => /iPhone|iPad|iPod/.test(navigator.userAgent);

function dismissedBefore() {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function InstallCard() {
  const [hidden, setHidden] = useState(() => standalone() || dismissedBefore());
  const [canPrompt, setCanPrompt] = useState(deferred !== null);
  useEffect(() => {
    const on = () => setCanPrompt(true);
    window.addEventListener("beforeinstallprompt", on);
    return () => window.removeEventListener("beforeinstallprompt", on);
  }, []);
  if (hidden || (!canPrompt && !ios())) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      /* private mode: just hide for now */
    }
    setHidden(true);
  };
  return (
    <section className="install" aria-label={t.installTitle}>
      <div className="it">{t.installTitle}</div>
      <div className="id">
        {t.installBody}
        {ios() && (
          <>
            <br />
            {t.installIos}
          </>
        )}
      </div>
      <div className="row">
        {canPrompt && (
          <button
            type="button"
            className="btn"
            onClick={async () => {
              await deferred?.prompt();
              deferred = null;
              dismiss();
            }}
          >
            {t.install}
          </button>
        )}
        <button type="button" className="later" onClick={dismiss}>
          {t.notNow}
        </button>
      </div>
    </section>
  );
}
