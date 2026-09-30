// RiseUp's month-end forecast, reproduced exactly (verified against the app, September 2026;
// see .claude/context/architecture.md). Pure functions: amounts are integer agorot, dates YYYY-MM-DD.

export type EnvelopeType = "fixed" | "trackingCategory" | "variable" | "variableIncome" | "riseupGoal" | (string & {});

export type Envelope = {
  id: string;
  type: EnvelopeType;
  /** RiseUp's originalAmount in agorot. Fixed: negative = income, positive = expense. */
  plan: number;
  /** YYYY-MM-DD: the day a planned fixed item is expected by. */
  balanceDate?: string;
};

/** What arrived in one envelope. `arrived` counts every matched transaction, including ones
 *  moved to a project; `amount` sums only those still in the ongoing. */
export type EnvelopeActual = { arrived: number; amount: number };

export type Line = { plan: number; actual: number; expected: number };
export type TrackedLine = Line & { key: string; envelopeIds: string[] };

export type OngoingForecast = {
  income: Line;
  fixed: Line;
  tracked: TrackedLine[];
  variable: Line;
  goal: Line;
  /** Month-end result of the ongoing: income − all expected expenses. */
  net: number;
};

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const line = (lines: Line[]): Line => ({
  plan: sum(lines.map((l) => l.plan)),
  actual: sum(lines.map((l) => l.actual)),
  expected: sum(lines.map((l) => l.expected)),
});

/** Weekly categories arrive as one envelope per week (`…#0` … `#4`); they forecast as one category. */
export const categoryKey = (envelopeId: string) => envelopeId.replace(/#\d+$/, "");

export const isIncomeEnvelope = (e: Envelope) => e.type === "variableIncome" || (e.type === "fixed" && e.plan < 0);

/**
 * A fixed item: what actually arrived, once anything arrived (even below plan);
 * before that, the plan while its expected date hasn't passed; after that, nothing.
 */
function fixedLine(e: Envelope, a: EnvelopeActual, today: string): Line {
  const plan = Math.abs(e.plan);
  const expected = a.arrived > 0 ? a.amount : e.balanceDate && e.balanceDate.slice(0, 10) >= today ? plan : 0;
  return { plan, actual: a.amount, expected };
}

/**
 * @param actuals ongoing actuals per envelope id (project items already removed from `amount`)
 * @param today YYYY-MM-DD in Asia/Jerusalem
 * @param variableBudget RiseUp's variable budget ("מומלץ להוציא עד"), which the API doesn't expose; 0 until known
 */
export function ongoingForecast(
  envelopes: Envelope[],
  actuals: ReadonlyMap<string, EnvelopeActual>,
  today: string,
  variableBudget = 0,
): OngoingForecast {
  const none: EnvelopeActual = { arrived: 0, amount: 0 };
  const act = (e: Envelope) => actuals.get(e.id) ?? none;

  const income: Line[] = [];
  const fixed: Line[] = [];
  const variable: Line[] = [];
  const goal: Line[] = [];
  const tracked = new Map<string, TrackedLine>();

  for (const e of envelopes) {
    const a = act(e);
    switch (e.type) {
      case "fixed":
        (isIncomeEnvelope(e) ? income : fixed).push(fixedLine(e, a, today));
        break;
      case "variableIncome":
        income.push({ plan: 0, actual: a.amount, expected: a.amount });
        break;
      case "variable":
        variable.push({ plan: 0, actual: a.amount, expected: a.amount });
        break;
      case "riseupGoal":
        goal.push({ plan: e.plan, actual: a.amount, expected: Math.max(e.plan, a.amount) });
        break;
      case "trackingCategory": {
        const key = categoryKey(e.id);
        const t = tracked.get(key) ?? { key, envelopeIds: [], plan: 0, actual: 0, expected: 0 };
        t.envelopeIds.push(e.id);
        t.plan += e.plan;
        t.actual += a.amount;
        tracked.set(key, t);
        break;
      }
    }
  }
  const trackedLines = [...tracked.values()].map((t) => ({ ...t, expected: Math.max(t.plan, t.actual) }));

  // The variable budget covers all variable envelopes together, so it's added once, not per envelope.
  const spent = line(variable).actual;
  const variableLine = variable.length ? { plan: variableBudget, actual: spent, expected: Math.max(variableBudget, spent) } : line([]);
  const result = { income: line(income), fixed: line(fixed), tracked: trackedLines, variable: variableLine, goal: line(goal) };
  const net =
    result.income.expected -
    result.fixed.expected -
    sum(trackedLines.map((t) => t.expected)) -
    result.variable.expected -
    result.goal.expected;
  return { ...result, net };
}

export type ProjectCategoryInput = { id: number; name: string; kind: "expense" | "income"; plan: number; actual: number };
export type ProjectCategoryLine = ProjectCategoryInput & { expected: number };
export type ProjectForecast = { expenses: Line; income: Line; categories: ProjectCategoryLine[]; net: number };

/** A project in one month: every category forecasts max(plan, actual); net = income − expenses. */
export function projectForecast(categories: ProjectCategoryInput[]): ProjectForecast {
  const lines = categories.map((c) => ({ ...c, expected: Math.max(c.plan, c.actual) }));
  const expenses = line(lines.filter((c) => c.kind === "expense"));
  const income = line(lines.filter((c) => c.kind === "income"));
  return { expenses, income, categories: lines, net: income.expected - expenses.expected };
}

export type MonthSummary = { ongoing: number; projects: { id: number; name: string; net: number }[]; total: number };

/** The summary card: the ongoing, one line per project, and the total. */
export function monthSummary(ongoing: number, projects: { id: number; name: string; net: number }[]): MonthSummary {
  return { ongoing, projects, total: ongoing + sum(projects.map((p) => p.net)) };
}
