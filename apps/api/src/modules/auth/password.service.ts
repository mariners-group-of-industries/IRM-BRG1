import { Injectable } from '@nestjs/common';
import argon2 from 'argon2';

/** OWASP-recommended argon2id parameters (19 MiB, t=2, p=1). */
const OPTIONS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

@Injectable()
export class PasswordService {
  /** A real hash used to equalise timing when the account does not exist. */
  private dummyHash: Promise<string> | undefined;

  hash(plain: string): Promise<string> {
    return argon2.hash(plain, OPTIONS);
  }

  async verify(hash: string | null, plain: string): Promise<boolean> {
    if (!hash) {
      this.dummyHash ??= argon2.hash('timing-equaliser-not-a-password', OPTIONS);
      await argon2.verify(await this.dummyHash, plain).catch(() => false);
      return false;
    }
    try {
      return await argon2.verify(hash, plain);
    } catch {
      return false;
    }
  }

  needsRehash(hash: string): boolean {
    return argon2.needsRehash(hash, OPTIONS);
  }

  /** Minimum policy for staff passwords. Returns an error message or null. */
  policyError(plain: string): string | null {
    if (plain.length < 12) return 'Password must be at least 12 characters';
    if (plain.length > 256) return 'Password is too long';
    const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(plain)).length;
    if (classes < 3) return 'Use at least three of: lowercase, uppercase, numbers, symbols';
    return null;
  }
}
