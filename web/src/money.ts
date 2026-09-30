// Amounts arrive as integer agorot. Format: "1,840.0 ₪"; hero and summary numbers are whole, signed.

const whole = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/** "1,840" and ".0" separately, so the decimal can be drawn smaller (DESIGN.md › Typography). */
export function splitAmount(agorot: number): { int: string; dec: string } {
  const inTenths = Math.round(Math.abs(agorot) / 10); // 99.99 → 100.0, not 99.9
  const shekels = Math.floor(inTenths / 10);
  const tenths = inTenths % 10;
  return { int: `${agorot < 0 && inTenths > 0 ? "-" : ""}${whole.format(shekels)}`, dec: `.${tenths}` };
}

/** "+2,340 ₪" / "-1,090 ₪" / "0 ₪". */
export function signedWhole(agorot: number): string {
  const n = Math.sign(agorot) * Math.round(Math.abs(agorot) / 100); // halves away from zero, both signs
  return `${n > 0 ? "+" : n < 0 ? "-" : ""}${whole.format(Math.abs(n))} ₪`;
}

/** "360 ₪" for status lines. */
export const plainWhole = (agorot: number) => `${whole.format(Math.round(Math.abs(agorot) / 100))} ₪`;

/** "12.9.26" from YYYY-MM-DD. */
export function shortDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${d}.${m}.${String(y).slice(2)}`;
}

/** Shekels typed by a person → integer agorot, or null. */
export function parseShekels(input: string): number | null {
  const s = input.replace(/[,\s₪]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}
