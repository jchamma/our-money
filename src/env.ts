// Worker bindings and the app's Hono types.
import type { AuthConfig } from "./auth/config";

export type Env = {
  DB: D1Database;
  /** How the couple logs in; chosen at setup. */
  AUTH_MODE?: string; // 'passkey' | 'google' | 'email'
  /** 1–2 comma-separated emails (google and email modes). */
  ALLOWED_EMAILS?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string; // secret
  BREVO_API_KEY?: string; // secret
  EMAIL_FROM?: string;
  EMAIL_FROM_NAME?: string;
  /** AES-GCM key for the stored RiseUp token and pepper for email codes (32 bytes, base64). Secret. */
  TOKEN_KEY?: string;
  /** Phase 1 secret; read only until a token is saved in the app. */
  RISEUP_PAT?: string;
};

export type Member = { id: number; name: string; nameConfirmed: boolean };

export type AppEnv = { Bindings: Env; Variables: { member: Member; auth: AuthConfig } };
