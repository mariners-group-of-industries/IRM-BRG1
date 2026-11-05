import { dateOnly } from './register.mappers.js';

/** True when an approved authorization is inside its validity window today (Asia/Dhaka date). */
export function isEffective(a: { status: string; validFrom: Date; validUntil: Date }, now = new Date()): boolean {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(now);
  return a.status === 'APPROVED' && dateOnly(a.validFrom) <= today && today <= dateOnly(a.validUntil);
}
