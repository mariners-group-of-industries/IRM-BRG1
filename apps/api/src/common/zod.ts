import { BadRequestException } from '@nestjs/common';
import type { z } from 'zod';

/**
 * Parse untrusted input with a shared Zod schema. Throws a 400 with
 * field-level messages the web forms can display.
 */
export function parseBody<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const errors: Record<string, string[]> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join('.') || '_';
    (errors[key] ??= []).push(issue.message);
  }
  throw new BadRequestException({ statusCode: 400, message: 'Validation failed', errors });
}

/** Turn '' into null for optional text columns. */
export function blankToNull(v: string | undefined | null): string | null {
  if (v === undefined || v === null) return null;
  const t = v.trim();
  return t === '' ? null : t;
}
