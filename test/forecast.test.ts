import { describe, expect, it } from "vitest";
import { categoryKey, monthSummary, ongoingForecast, projectForecast, type Envelope, type EnvelopeActual } from "../src/forecast";

// Synthetic data only; amounts in agorot.
const TODAY = "2026-09-20";
const acts = (entries: Record<string, EnvelopeActual>) => new Map(Object.entries(entries));

describe("fixed items", () => {
  const f = (id: string, plan: number, balanceDate: string): Envelope => ({ id, type: "fixed", plan, balanceDate });

  it("count what arrived, even below plan", () => {
    const r = ongoingForecast([f("rent", 500_000, "2026-09-10")], acts({ rent: { arrived: 1, amount: 480_000 } }), TODAY);
    expect(r.fixed).toEqual({ plan: 500_000, actual: 480_000, expected: 480_000 });
  });

  it("count the plan until the expected date, including the day itself, then drop it", () => {
    const envs = [f("a", 10_000, "2026-09-25"), f("b", 20_000, "2026-09-20"), f("c", 40_000, "2026-09-19")];
    expect(ongoingForecast(envs, acts({}), TODAY).fixed.expected).toBe(30_000);
  });

  it("treat a negative plan as income, with the same rules", () => {
    const envs = [f("salary", -1_000_000, "2026-09-01"), f("cheque", -300_000, "2026-10-04"), f("fee", -276, "2026-09-11")];
    const r = ongoingForecast(envs, acts({ salary: { arrived: 1, amount: 990_000 } }), TODAY);
    expect(r.income.expected).toBe(990_000 + 300_000);
    expect(r.fixed.expected).toBe(0);
  });

  it("stay 'arrived' when the arrived item was moved to a project, so the plan doesn't come back", () => {
    const r = ongoingForecast([f("insurance", 50_000, "2026-09-30")], acts({ insurance: { arrived: 1, amount: 0 } }), TODAY);
    expect(r.fixed.expected).toBe(0);
  });
});

describe("tracked categories", () => {
  const week = (n: number, plan: number): Envelope => ({ id: `2026-09#trackingCategory#super#${n}`, type: "trackingCategory", plan });

  it("merge weekly envelopes into one category: max(Σ plan, Σ actual), not Σ max per week", () => {
    const envs = [week(0, 150_000), week(1, 100_000), week(2, 100_000)];
    const a = acts({
      [envs[0].id]: { arrived: 3, amount: 235_800 },
      [envs[1].id]: { arrived: 2, amount: 88_370 },
      [envs[2].id]: { arrived: 2, amount: 75_570 },
    });
    const r = ongoingForecast(envs, a, TODAY);
    expect(r.tracked).toHaveLength(1);
    expect(r.tracked[0]).toMatchObject({ key: "2026-09#trackingCategory#super", plan: 350_000, actual: 399_740, expected: 399_740 });
  });

  it("forecast the plan while under it, the actual once over it", () => {
    const envs: Envelope[] = [
      { id: "pharma", type: "trackingCategory", plan: 19_900 },
      { id: "clothes", type: "trackingCategory", plan: 0 },
    ];
    const r = ongoingForecast(envs, acts({ pharma: { arrived: 2, amount: 11_450 }, clothes: { arrived: 9, amount: 193_070 } }), TODAY);
    expect(r.tracked.map((t) => t.expected)).toEqual([19_900, 193_070]);
  });

  it("keeps plain category ids unchanged", () => {
    expect(categoryKey("2026-09#trackingCategory#v2-default-il-expense-category-13")).toBe("2026-09#trackingCategory#v2-default-il-expense-category-13");
  });
});

describe("the month-end net (the hero)", () => {
  const envs: Envelope[] = [
    { id: "salary", type: "fixed", plan: -1_500_000, balanceDate: "2026-09-10" },
    { id: "vinc", type: "variableIncome", plan: 0 },
    { id: "rent", type: "fixed", plan: 600_000, balanceDate: "2026-09-05" },
    { id: "car", type: "trackingCategory", plan: 250_000 },
    { id: "var", type: "variable", plan: 0 },
    { id: "goal", type: "riseupGoal", plan: 0 },
  ];
  const base = { salary: { arrived: 1, amount: 1_470_000 }, vinc: { arrived: 1, amount: 50_000 }, rent: { arrived: 1, amount: 600_000 }, car: { arrived: 5, amount: 362_770 }, var: { arrived: 4, amount: 207_290 } };

  it("is income − fixed − tracked − variable − goal", () => {
    const r = ongoingForecast(envs, acts(base), TODAY);
    expect(r.net).toBe(1_520_000 - 600_000 - 362_770 - 207_290);
  });

  it("improves by exactly the amount moved out of an over-plan category", () => {
    const before = ongoingForecast(envs, acts(base), TODAY).net;
    const after = ongoingForecast(envs, acts({ ...base, car: { arrived: 5, amount: 362_770 - 30_000 } }), TODAY).net;
    expect(after - before).toBe(30_000);
  });

  it("doesn't change when the moved item leaves a category still under plan (RiseUp logic)", () => {
    const under = { ...base, car: { arrived: 5, amount: 200_000 } };
    const before = ongoingForecast(envs, acts(under), TODAY).net;
    const after = ongoingForecast(envs, acts({ ...under, car: { arrived: 5, amount: 170_000 } }), TODAY).net;
    expect(after).toBe(before);
  });

  it("counts the variable budget when one is known", () => {
    const r = ongoingForecast(envs, acts(base), TODAY, 300_000);
    expect(r.variable.expected).toBe(300_000);
  });

  it("counts the variable budget once across several variable envelopes", () => {
    const vars: Envelope[] = [
      { id: "v1", type: "variable", plan: 0 },
      { id: "v2", type: "variable", plan: 0 },
    ];
    const r = ongoingForecast(vars, acts({ v1: { arrived: 2, amount: 100_000 }, v2: { arrived: 1, amount: 50_000 } }), TODAY, 300_000);
    expect(r.variable).toEqual({ plan: 300_000, actual: 150_000, expected: 300_000 });
  });
});

describe("projects and the month summary", () => {
  it("forecast each project category as max(plan, actual); net = income − expenses", () => {
    const r = projectForecast([
      { id: 1, name: "Meat", kind: "expense", plan: 60_000, actual: 69_000 },
      { id: 2, name: "Drinks", kind: "expense", plan: 30_000, actual: 16_000 },
      { id: 3, name: "Refunds", kind: "income", plan: 60_000, actual: 45_000 },
    ]);
    expect(r.expenses.expected).toBe(99_000);
    expect(r.income.expected).toBe(60_000);
    expect(r.net).toBe(-39_000);
  });

  it("sums the ongoing and every project into the total", () => {
    const s = monthSummary(234_000, [
      { id: 1, name: "Trip", net: -215_000 },
      { id: 2, name: "Kitchen", net: -490_000 },
    ]);
    expect(s.total).toBe(234_000 - 215_000 - 490_000);
  });
});
