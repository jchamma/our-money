// Shared UI pieces (DESIGN.md › Components). Colours come from the section: one colour per section.
import { useEffect, useId, useState, type ReactNode } from "react";
import type { Tx } from "./api";
import { plainWhole, shortDate, signedWhole, splitAmount } from "./money";
import { shiftMonth } from "./router";
import { t } from "./strings";

export type Tone = "variable" | "tracked" | "fixed" | "income" | "project";

/** "1,840.0 ₪" with a smaller decimal. */
export function Money({ agorot, className }: { agorot: number; className?: string }) {
  const { int, dec } = splitAmount(agorot);
  // Only the number is isolated LTR; in RTL flow the ₪ then sits to its left, as in RiseUp.
  return (
    <span className={className}>
      <span className="num">
        {int}
        <span className="dec">{dec}</span>
      </span>{" "}
      ₪
    </span>
  );
}

/** Signed whole shekels, green / red-orange / neutral (hero and summary). */
export function Net({ agorot, className }: { agorot: number; className?: string }) {
  const tone = agorot > 0 ? "c-income" : agorot < 0 ? "c-negative" : "";
  return <span className={`num ${tone} ${className ?? ""}`}>{signedWhole(agorot)}</span>;
}

export function MonthSwitcher({ month, max, onChange }: { month: string; max: string; onChange: (m: string) => void }) {
  return (
    <div className="month">
      <button type="button" aria-label={t.prevMonth} onClick={() => onChange(shiftMonth(month, -1))}>
        <span className="arr">›</span>
      </button>
      <span>{t.monthLabel(month)}</span>
      <button type="button" aria-label={t.nextMonth} disabled={month >= max} onClick={() => onChange(shiftMonth(month, 1))}>
        <span className="arr">‹</span>
      </button>
    </div>
  );
}

type SectionProps = {
  title: string;
  tone: Tone;
  income?: boolean;
  actual: number;
  expected: number;
  endLabel?: string;
  status?: ReactNode;
  menu?: ReactNode;
  detailLabel: string;
  rows: ReactNode;
  muted?: boolean;
};

/** A section card: title, the two-number header, the bar, the status line, and the expandable rows. */
export function SectionCard({ title, tone, income, actual, expected, endLabel, status, menu, detailLabel, rows, muted }: SectionProps) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const over = !income && actual > expected;
  const pct = expected > 0 ? Math.min(100, Math.round((actual / expected) * 100)) : actual > 0 ? 100 : 0;
  const start = income ? t.received : t.spent;
  const end = endLabel ?? (income ? t.expectedIn : over ? t.wasExpectedOut : t.expectedOut);
  return (
    <section className={`card ${muted ? "muted" : ""}`}>
      <div className="ctop">
        <h2 className="ttl">{title}</h2>
        {menu}
      </div>
      <div className="two">
        <div>
          <div className="lbl">{start}</div>
          <div className={`amt c-${tone}`}>
            <Money agorot={actual} />
          </div>
        </div>
        <div className="end">
          <div className="lbl">{end}</div>
          <div className="amt2">
            <Money agorot={expected} />
          </div>
        </div>
      </div>
      <div className={`prog t-${tone}`} role="presentation">
        <i className={`b-${tone}`} style={{ width: `${pct}%` }} />
      </div>
      {status !== undefined && <div className="status">{status}</div>}
      <button type="button" className="acc" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        <span>{detailLabel}</span>
        <span aria-hidden>{open ? "⌃" : "⌄"}</span>
      </button>
      {open && (
        <div id={id} className="rows">
          {rows}
        </div>
      )}
    </section>
  );
}

/** "נשאר להוציא X ₪" or "חריגה של X ₪!" (an overspend keeps the section colour). */
export function spendStatus(actual: number, expected: number, income = false): string {
  if (income) return expected > actual ? t.moreExpectedIn(plainWhole(expected - actual)) : "";
  return actual > expected ? t.overspend(plainWhole(actual - expected)) : t.leftToSpend(plainWhole(expected - actual));
}

/** Transaction rows; tapping one reveals its single action bar underneath. */
export function TxRows({ items, action, tone = "tracked" }: { items: Tx[]; action?: { label: string; onPick: (tx: Tx) => void }; tone?: "tracked" | "project" }) {
  const [selected, setSelected] = useState<string | null>(null);
  if (items.length === 0) return <div className="empty">{t.noItems}</div>;
  return (
    <>
      {items.map((tx) => {
        const sel = selected === tx.id;
        return (
          <div key={tx.id}>
            <button
              type="button"
              className={`tx ${sel ? "sel" : ""} ${tone === "project" ? "project" : ""}`}
              aria-expanded={action ? sel : undefined}
              onClick={() => action && setSelected(sel ? null : tx.id)}
            >
              <span className="m">{tx.merchant}</span>
              <span className={`a ${tx.income ? "c-income" : ""}`}>
                <Money agorot={tx.amount} />
              </span>
              <span className="d">
                {shortDate(tx.date)}
                {tx.account ? ` · ${tx.account}` : ""}
              </span>
              <span />
            </button>
            {sel && action && (
              <button type="button" className={`imenu b-${tone}`} onClick={() => action.onPick(tx)}>
                <span>{action.label}</span>
                <span className="arr" aria-hidden>
                  ‹
                </span>
              </button>
            )}
          </div>
        );
      })}
    </>
  );
}

/** Shown when a screen's data didn't load. */
export function LoadFailed({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="foot" role="alert">
      <div>{t.loadFailed}</div>
      <button type="button" className="out" onClick={onRetry}>
        {t.retry}
      </button>
    </div>
  );
}

/** A bottom sheet over a scrim; Escape or a tap on the scrim closes it. */
export function Sheet({ onClose, children, label }: { onClose: () => void; children: ReactNode; label: string }) {
  useEscape(onClose);
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={label}>
        {children}
      </div>
    </>
  );
}

export function Modal({ onClose, children, label }: { onClose: () => void; children: ReactNode; label: string }) {
  useEscape(onClose);
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="modal" role="dialog" aria-modal="true" aria-label={label}>
        {children}
      </div>
    </>
  );
}

function useEscape(onClose: () => void) {
  useEffect(() => {
    const on = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [onClose]);
}

/** A navy toast pinned to the top; disappears after a few seconds. */
export function Toast({ text, onClose }: { text: string; onClose: () => void }) {
  useEffect(() => {
    const id = setTimeout(onClose, 4000);
    return () => clearTimeout(id);
  }, [onClose]);
  return (
    <div className="toast" role="status">
      <span>{text}</span>
      <button type="button" aria-label="סגירה" onClick={onClose}>
        ✕
      </button>
    </div>
  );
}

/** Radio-style option rows. */
export function Option({ checked, onSelect, children }: { checked: boolean; onSelect: () => void; children: ReactNode }) {
  return (
    <button type="button" role="radio" aria-checked={checked} className="opt" onClick={onSelect}>
      <span className="radio" aria-hidden />
      {children}
    </button>
  );
}

/** Shekel amount input (the plan editor, 6g/6h). */
export function AmountInput({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <div className="inp">
      <input inputMode="decimal" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} dir="ltr" />
      <span className="cur">₪</span>
    </div>
  );
}
