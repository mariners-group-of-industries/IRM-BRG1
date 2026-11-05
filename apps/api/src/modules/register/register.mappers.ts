import { maskEmail, maskIdentifier, maskPhone, type ContactDto, type HoldingDto, type IdentityDto } from '@irm/shared';

export function toIdentityDto(i: { id: string; kind: 'BO' | 'FOLIO'; value: string }, pii: boolean): IdentityDto {
  return { id: i.id, kind: i.kind, value: pii ? i.value : maskIdentifier(i.value), masked: !pii };
}

export function toContactDto(
  c: { id: string; kind: 'PHONE' | 'EMAIL'; value: string; source: string },
  pii: boolean,
): ContactDto {
  const masked = c.kind === 'PHONE' ? maskPhone(c.value) : maskEmail(c.value);
  return { id: c.id, kind: c.kind, value: pii ? c.value : masked, source: c.source, masked: !pii };
}

export function toHoldingDto(
  h: {
    id: string;
    identityId: string;
    quantity: bigint;
    asOfDate: Date;
    validFrom: Date;
    validTo: Date | null;
    importId: string | null;
    identity: { kind: 'BO' | 'FOLIO'; value: string };
    shareClass: { code: string };
  },
  pii: boolean,
): HoldingDto {
  return {
    id: h.id,
    identityId: h.identityId,
    identity: `${h.identity.kind === 'BO' ? 'BO' : 'Folio'} ${pii ? h.identity.value : maskIdentifier(h.identity.value)}`,
    shareClass: h.shareClass.code,
    quantity: h.quantity.toString(),
    asOfDate: h.asOfDate.toISOString().slice(0, 10),
    validFrom: h.validFrom.toISOString(),
    validTo: h.validTo?.toISOString() ?? null,
    importId: h.importId,
  };
}

export const dateOnly = (d: Date) => d.toISOString().slice(0, 10);
