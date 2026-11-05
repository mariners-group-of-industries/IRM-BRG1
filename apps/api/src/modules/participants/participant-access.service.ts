import { Injectable } from '@nestjs/common';
import { maskIdentifier, type ParticipantKind, type ParticipantMe, type ParticipantRepresentation } from '@irm/shared';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';
import { SessionService } from '../auth/session.service.js';
import { isEffective } from '../register/authorization-rules.js';
import { dateOnly } from '../register/register.mappers.js';

type Tx = Prisma.TransactionClient;

/** What a verified one-time code proves the person may act as. */
export type ParticipantSubject =
  | { kind: 'SHAREHOLDER'; companyId: string; tenantId: string; shareholderId: string }
  | { kind: 'CORPORATE_REPRESENTATIVE'; companyId: string; tenantId: string; email: string; repIds: string[] }
  | { kind: 'PROXY_REPRESENTATIVE'; companyId: string; tenantId: string; email: string; proxyIds: string[] };

@Injectable()
export class ParticipantAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Re-checks the subject against current data, then finds or creates the participant
   * user, its links and its role assignment. Returns null when nothing is valid any more
   * (for example, an authorization was revoked after the code was sent).
   */
  async ensureParticipant(subject: ParticipantSubject): Promise<{ userId: string } | null> {
    return this.prisma.scoped([subject.companyId], async (tx) => {
      const { companyId, tenantId } = subject;
      let userId: string;

      if (subject.kind === 'SHAREHOLDER') {
        const holder = await tx.shareholder.findFirst({ where: { id: subject.shareholderId, companyId, status: 'ACTIVE' } });
        if (!holder) return null;
        const link = await tx.participantLink.findFirst({ where: { companyId, kind: 'SHAREHOLDER', shareholderId: holder.id } });
        if (link) userId = link.userId;
        else {
          const user = await tx.user.create({ data: { kind: 'PARTICIPANT', fullName: holder.name } });
          await tx.participantLink.create({ data: { tenantId, companyId, userId: user.id, kind: 'SHAREHOLDER', shareholderId: holder.id } });
          userId = user.id;
        }
      } else {
        const isRep = subject.kind === 'CORPORATE_REPRESENTATIVE';
        const ids = isRep ? subject.repIds : subject.proxyIds;
        const records = isRep
          ? await tx.corporateRepresentative.findMany({ where: { id: { in: ids }, companyId, email: subject.email } })
          : await tx.proxyAuthorization.findMany({ where: { id: { in: ids }, companyId, email: subject.email } });
        const effective = records.filter((r) => isEffective(r));
        if (effective.length === 0) return null;
        const first = effective[0]!;
        const existing = await tx.user.findUnique({ where: { email: subject.email } });
        const user = existing ?? (await tx.user.create({ data: { kind: 'PARTICIPANT', email: subject.email, fullName: first.fullName, phone: first.phone } }));
        if (user.status !== 'ACTIVE') return null;
        userId = user.id;
        for (const r of effective) {
          const where = isRep ? { userId, corporateRepId: r.id } : { userId, proxyId: r.id };
          const has = await tx.participantLink.findFirst({ where });
          if (!has) {
            await tx.participantLink.create({
              data: { tenantId, companyId, userId, kind: subject.kind, ...(isRep ? { corporateRepId: r.id } : { proxyId: r.id }) },
            });
          }
        }
      }

      await this.ensureRole(tx, userId, subject.kind, tenantId, companyId);
      return { userId };
    });
  }

  private async ensureRole(tx: Tx, userId: string, kind: ParticipantKind, tenantId: string, companyId: string) {
    const role = await tx.role.findUniqueOrThrow({ where: { key: kind } });
    const active = await tx.userRoleAssignment.findFirst({ where: { userId, roleId: role.id, companyId, revokedAt: null } });
    if (!active) await tx.userRoleAssignment.create({ data: { userId, roleId: role.id, scope: 'COMPANY', tenantId, companyId } });
  }

  /** Called when a corporate representative or proxy is revoked: remove the role and end sessions now. */
  async revokeLinkedAccess(companyId: string, ref: { corporateRepId: string } | { proxyId: string }): Promise<void> {
    const kind: ParticipantKind = 'corporateRepId' in ref ? 'CORPORATE_REPRESENTATIVE' : 'PROXY_REPRESENTATIVE';
    const affected = await this.prisma.scoped([companyId], async (tx) => {
      const links = await tx.participantLink.findMany({ where: { companyId, ...ref } });
      const users: string[] = [];
      for (const link of links) {
        // Keep the role only if the user still has another effective authorization of this kind here.
        const others = await tx.participantLink.findMany({ where: { companyId, userId: link.userId, kind, NOT: { id: link.id } } });
        let stillValid = false;
        for (const o of others) {
          const rec = o.corporateRepId
            ? await tx.corporateRepresentative.findUnique({ where: { id: o.corporateRepId } })
            : o.proxyId
              ? await tx.proxyAuthorization.findUnique({ where: { id: o.proxyId } })
              : null;
          if (rec && isEffective(rec)) stillValid = true;
        }
        if (!stillValid) {
          const role = await tx.role.findUniqueOrThrow({ where: { key: kind } });
          await tx.userRoleAssignment.updateMany({ where: { userId: link.userId, roleId: role.id, companyId, revokedAt: null }, data: { revokedAt: new Date() } });
        }
        users.push(link.userId);
      }
      return users;
    });
    for (const userId of new Set(affected)) {
      await this.sessions.revokeAllForUser(userId);
      await this.audit.record({ action: 'participant.access_revoked', outcome: 'SUCCESS', companyId, targetType: 'user', targetId: userId, metadata: { reason: `${kind.toLowerCase()}_revoked` } });
    }
  }

  /** What the signed-in participant represents, per company. Only currently effective authorizations are shown. */
  async describe(userId: string): Promise<ParticipantMe[]> {
    const companies = await this.prisma.participantLink.findMany({ where: { userId }, select: { companyId: true }, distinct: ['companyId'] });
    if (companies.length === 0) return [];
    const companyIds = companies.map((c) => c.companyId);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { fullName: true } });
    return this.prisma.scoped(companyIds, async (tx) => {
      const out: ParticipantMe[] = [];
      for (const companyId of companyIds) {
        const company = await tx.company.findUniqueOrThrow({ where: { id: companyId }, select: { id: true, legalName: true, shortName: true } });
        const links = await tx.participantLink.findMany({ where: { userId, companyId } });
        const reps: ParticipantRepresentation[] = [];
        for (const l of links) {
          if (l.kind === 'SHAREHOLDER' && l.shareholderId) {
            const s = await tx.shareholder.findUnique({ where: { id: l.shareholderId } });
            if (s) reps.push(await this.representation(tx, 'SHAREHOLDER', 'Shareholder', s, undefined));
          } else if (l.corporateRepId) {
            const r = await tx.corporateRepresentative.findUnique({ where: { id: l.corporateRepId }, include: { shareholder: true } });
            if (r && isEffective(r)) reps.push({ ...(await this.representation(tx, 'CORPORATE_REPRESENTATIVE', 'Corporate representative', r.shareholder, r.identityIds)), validUntil: dateOnly(r.validUntil) });
          } else if (l.proxyId) {
            const r = await tx.proxyAuthorization.findUnique({ where: { id: l.proxyId }, include: { grantor: true } });
            if (r && isEffective(r)) {
              reps.push({ ...(await this.representation(tx, 'PROXY_REPRESENTATIVE', 'Proxy', r.grantor, undefined)), scope: r.scope, meetingReference: r.meetingReference, validUntil: dateOnly(r.validUntil) });
            }
          }
        }
        out.push({ company, fullName: user.fullName, representations: reps });
      }
      return out;
    });
  }

  private async representation(
    tx: Tx,
    kind: ParticipantKind,
    label: string,
    holder: { id: string; name: string; type: 'INDIVIDUAL' | 'CORPORATE' },
    onlyIdentityIds: string[] | undefined,
  ): Promise<ParticipantRepresentation> {
    const identities = await tx.shareholderIdentity.findMany({
      where: { shareholderId: holder.id, ...(onlyIdentityIds ? { id: { in: onlyIdentityIds } } : {}) },
      include: { holdings: { where: { validTo: null }, include: { shareClass: true } } },
      orderBy: { value: 'asc' },
    });
    const total = identities.flatMap((i) => i.holdings).reduce((sum, h) => sum + h.quantity, 0n);
    return {
      kind,
      label,
      shareholderName: holder.name,
      holderType: holder.type,
      identities: identities.map((i) => ({
        kind: i.kind,
        value: maskIdentifier(i.value),
        shares: i.holdings.map((h) => ({ shareClass: h.shareClass.code, quantity: h.quantity.toString() })),
      })),
      totalShares: total.toString(),
    };
  }
}
