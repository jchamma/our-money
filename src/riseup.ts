// Read-only client for RiseUp's public API.
// Shapes follow github.com/riseup-oss/mcp (src/tools/*.ts); fields may be absent.

const API_BASE = "https://input.riseup.co.il";

export type RiseupTransaction = {
  transactionId: string;
  transactionDate: string;
  billingDate?: string;
  cashflowDate: string;
  businessName: string;
  isIncome: boolean;
  amount: number;
  accountNickname?: string | null;
  accountNumberHash?: string | null;
  isInstallment?: boolean;
  installmentNumber?: number;
  totalNumberOfInstallments?: number;
  totalNumberOfPayments?: number;
  isPostponed?: boolean;
  sourceType?: string;
  source?: string;
  actualType?: "fixed" | "variable";
  categoryLabel?: string;
  categoryType?: "default" | "custom" | "other";
};

export type RiseupActual = { transactionId: string };

export type RiseupBudget = {
  budgetDate: string;
  lastUpdatedAt?: string;
  cashflowHash?: string;
  envelopes: { id: string; type: string; actuals?: RiseupActual[] }[];
  excluded?: RiseupActual[];
};

export interface RiseupClient {
  budget(month: string): Promise<RiseupBudget>;
  transactions(month: string): Promise<RiseupTransaction[]>;
}

export class RiseupHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export function riseupClient(pat: string): RiseupClient {
  async function get<T>(path: string): Promise<T> {
    // redirect: "manual" so the token can never follow a redirect to another host.
    const res = await fetch(`${API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${pat}`, Accept: "application/json" },
      redirect: "manual",
    });
    // Never include the token or response body in errors: they end up in logs.
    if (res.status >= 300 && res.status < 400) throw new RiseupHttpError(res.status, `RiseUp API redirected (${res.status}); refusing to follow`);
    if (res.status === 401) throw new RiseupHttpError(401, "RiseUp token rejected (expired or revoked)");
    if (!res.ok) throw new RiseupHttpError(res.status, `RiseUp API ${res.status} on ${path.split("?")[0]}`);
    return res.json<T>();
  }
  return {
    budget: (month) => get<RiseupBudget>(`/api/external/budget/${month}`),
    transactions: async (month) =>
      (await get<{ transactions: RiseupTransaction[] }>(`/api/external/transactions?cashflowMonth=${month}`)).transactions,
  };
}
