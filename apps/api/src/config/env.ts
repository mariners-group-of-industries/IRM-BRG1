import 'dotenv/config';
import { z } from 'zod';

const bool = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().url(),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  SESSION_TTL_HOURS: z.coerce.number().positive().default(12),
  SESSION_IDLE_MINUTES: z.coerce.number().positive().default(60),
  WEB_ORIGIN: z.string().url().default('http://localhost:3100'),
  COOKIE_SECURE: bool,
  LOGIN_MAX_FAILURES: z.coerce.number().int().positive().default(5),
  LOGIN_LOCK_MINUTES: z.coerce.number().int().positive().default(15),
  /** Private file storage root for the local-disk driver. Never served directly. */
  STORAGE_DIR: z.string().default('../../.data/storage'),
  /** How one-time codes are delivered. dev-outbox writes to a database table and is refused in production. */
  OTP_DELIVERY: z.enum(['dev-outbox']).default('dev-outbox'),
  OTP_TTL_MINUTES: z.coerce.number().int().min(1).max(30).default(5),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(5),
  /** 32 bytes, base64. Encrypts TOTP secrets at rest. */
  MFA_ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, 'base64').length === 32, 'MFA_ENCRYPTION_KEY must be 32 bytes, base64-encoded'),
  /** When true, platform and company admins must enrol in MFA before using the app. */
  MFA_ENFORCE_FOR_ADMINS: bool,
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/** Validated environment. Fails fast at boot with a readable message. */
export function env(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  if (parsed.data.NODE_ENV === 'production' && !parsed.data.COOKIE_SECURE) {
    throw new Error('COOKIE_SECURE must be true in production');
  }
  if (parsed.data.NODE_ENV === 'production' && parsed.data.OTP_DELIVERY === 'dev-outbox') {
    throw new Error('OTP_DELIVERY=dev-outbox is not allowed in production. Configure an SMS or email provider.');
  }
  cached = parsed.data;
  return cached;
}

/** Test helper: re-read process.env on next access. */
export function resetEnvCache(): void {
  cached = undefined;
}
