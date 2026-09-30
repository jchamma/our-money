// Home (frames 6a–6b, 7a, 7h, 7l, 7m): the ongoing forecast, RiseUp's sections, and the month summary.
import { useEffect, useState } from "react";
import { api, useLoad, type Home as HomeData, type Me, type Tx } from "../api";
import { InstallCard } from "../install";
import { shortDate } from "../money";
import { currentMonth, navigate } from "../router";
import { t } from "../strings";
import { LoadFailed, MonthSwitcher, Net, SectionCard, spendStatus, TxRows } from "../ui";
import { AssignFlow } from "./AssignFlow";

const DAY = 86_400_000;
/** Once per app load, even if Home remounts before `me` shows the first sync. */
let firstSyncTried = false;

function TokenBanner({ token }: { token: Me["token"] }) {
  if (token.status === "missing" || !token.expiresAt) return null;
  const expiresAt = new Date(token.expiresAt);
  const days = Math.ceil((expiresAt.getTime() - Date.now()) / DAY);
  const expired = token.status === "expired" || days <= 0;
  if (!expired && days > 5) return null;
  return (
    <div className={`banner ${expired ? "stopped" : ""}`}>
      <div>
        <div className="bt">{expired ? t.tokenExpired(shortDate(token.expiresAt)) : t.tokenExpiring(days)}</div>
        <div className="bd">{expired ? t.tokenExpiredSub : t.tokenExpiringSub}</div>
      </div>
      <button type="button" className="go" onClick={() => navigate("/renew-token")}>
        {t.renew} <span className="arr">‹</span>
      </button>
    </div>
  );
}

function Footer({ me, onLogout }: { me: Me; onLogout: () => void }) {
  const names = me.members.map((m) => m.name).filter(Boolean);
  const synced = me.lastSync?.finished_at ? new Date(me.lastSync.finished_at) : null;
  const when = synced
    ? new Intl.DateTimeFormat("he-IL", { timeZone: "Asia/Jerusalem", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" }).format(synced)
    : null;
  return (
    <footer className="foot">
      {names.length > 0 && <div>{t.accessFor(names)}</div>}
      <div className="lbl">
        {when && t.lastSync(when)}
        {when && me.token.expiresAt && " · "}
        {me.token.expiresAt && t.tokenValidUntil(shortDate(me.token.expiresAt))}
      </div>
      <button type="button" className="out" onClick={onLogout}>
        {t.logout}
      </button>
    </footer>
  );
}

export function Home({ me, month, onLogout }: { me: Me; month: string; onLogout: () => void }) {
  const { data, failed, reload } = useLoad<HomeData>(`/api/months/${month}`);
  const [moving, setMoving] = useState<Tx | null>(null);
  // A fresh installation has never synced (the nightly run is at 03:00 UTC): sync once on first open.
  const neverSynced = !me.lastSync && me.token.status === "ok";
  useEffect(() => {
    if (!neverSynced || firstSyncTried) return;
    firstSyncTried = true;
    void api.post("/api/sync").then(reload, () => undefined);
  }, [neverSynced, reload]);

  const names = me.members.map((m) => m.name).filter(Boolean);
  const move = { label: t.moveToProject, onPick: setMoving };
  const setMonth = (m: string) => navigate(m === currentMonth() ? "/" : `/?month=${m}`);

  return (
    <main>
      <header className="appbar">
        <span className="wm">{t.appName}</span>
      </header>
      <InstallCard />
      <TokenBanner token={me.token} />
      <MonthSwitcher month={month} max={currentMonth()} onChange={setMonth} />

      <section className="card">
        {names.length > 0 && <div className="greet">{t.greeting(names)}</div>}
        <p className="hero-q">{t.heroQuestion(month)}</p>
        <div className="hero-n">{data ? <Net agorot={data.net} /> : " "}</div>
        {data && !data.hasBudget && <div className="lbl">{t.noBudgetYet}</div>}
      </section>

      {data && (
        <>
          <SectionCard
            title={t.variable}
            tone="variable"
            actual={data.variable.actual}
            expected={data.variable.plan}
            endLabel={t.recommendedUpTo}
            detailLabel={t.weeklyDetail}
            rows={<TxRows items={data.variable.transactions} action={move} />}
          />
          {data.tracked.map((c) => (
            <SectionCard
              key={c.key}
              title={c.name ?? "—"}
              tone="tracked"
              actual={c.actual}
              expected={c.plan}
              status={spendStatus(c.actual, c.plan)}
              detailLabel={t.monthlyDetail}
              rows={<TxRows items={c.transactions} action={move} />}
            />
          ))}
          <SectionCard
            title={t.fixed}
            tone="fixed"
            actual={data.fixed.actual}
            expected={data.fixed.expected}
            detailLabel={t.monthlyDetail}
            rows={<TxRows items={data.fixed.transactions} action={move} />}
          />
          <SectionCard
            title={t.income}
            tone="income"
            income
            actual={data.income.actual}
            expected={data.income.expected}
            status={spendStatus(data.income.actual, data.income.expected, true) || undefined}
            detailLabel={t.incomeDetail}
            rows={<TxRows items={data.income.transactions} action={move} />}
          />
          <NotInCashflow items={data.notInCashflow} move={move} />

          <section className="card">
            <h2 className="ttl">{t.summaryTitle(month)}</h2>
            <div className="lbl">{t.summarySub}</div>
            <div style={{ marginTop: 6 }}>
              <div className="line first">
                <span className="pname">{t.ongoing}</span>
                <Net agorot={data.summary.ongoing} />
              </div>
              {data.summary.projects.map((p) => (
                <button key={p.id} type="button" className="line" onClick={() => navigate(`/projects/${p.id}?month=${month}`)}>
                  <span className="pname c-project">
                    {p.name} <span className="arr">‹</span>
                  </span>
                  <Net agorot={p.net} />
                </button>
              ))}
              <div className="line total">
                <span>{t.total}</span>
                <Net agorot={data.summary.total} />
              </div>
            </div>
          </section>
        </>
      )}

      {failed && <LoadFailed onRetry={reload} />}
      <Footer me={me} onLogout={onLogout} />
      {moving && (
        <AssignFlow
          tx={moving}
          onClose={() => setMoving(null)}
          onDone={() => {
            setMoving(null);
            reload();
          }}
        />
      )}
    </main>
  );
}

function NotInCashflow({ items, move }: { items: Tx[]; move: { label: string; onPick: (tx: Tx) => void } }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="card muted">
      <h2 className="ttl" style={{ color: "#666" }}>
        {t.notInCashflow}
      </h2>
      <button type="button" className="acc" aria-expanded={open} style={{ borderColor: "#e6e1d6" }} onClick={() => setOpen(!open)}>
        <span>{t.notInCashflowDetail}</span>
        <span aria-hidden>{open ? "⌃" : "⌄"}</span>
      </button>
      {open && (
        <div className="rows">
          <TxRows items={items} action={move} />
        </div>
      )}
    </section>
  );
}
