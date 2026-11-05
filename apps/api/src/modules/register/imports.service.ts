import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  importMappingSchema,
  suggestMapping,
  type ImportDto,
  type ImportFieldKey,
  type ImportRowDto,
  type Paginated,
} from '@irm/shared';
import type { AuthPrincipal, RequestMeta } from '../../common/request-context.js';
import { parseBody } from '../../common/zod.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';
import { StorageService, sniffFileType, MIME } from '../storage/storage.service.js';
import { validateRegister, type NormalizedRow, type RegisterState } from './import-engine.js';
import { parseRegisterFile } from './parse.js';

type Tx = Prisma.TransactionClient;
interface Scope {
  tenantId: string;
  companyId: string;
}

const CHUNK = 2000;
const chunks = <T>(arr: T[], n = CHUNK): T[][] => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

const importInclude = {
  file: { select: { originalName: true, sizeBytes: true } },
} as const;

@Injectable()
export class ImportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  // ─── Upload ──────────────────────────────────────────────────────────

  async upload(p: AuthPrincipal, scope: Scope, file: { buffer: Buffer; originalname: string }, meta: RequestMeta): Promise<ImportDto> {
    const type = sniffFileType(file.buffer);
    if (type !== 'xlsx' && type !== 'text') throw new BadRequestException('Upload a CSV (UTF-8) or Excel .xlsx file');
    const sheet = await parseRegisterFile(file.buffer, type);
    const stored = await this.storage.put(file.buffer, `registers/${scope.companyId}`);
    const name = file.originalname.replace(/[^\w.\- ()]/g, '_').slice(0, 255) || 'register';

    const imp = await this.prisma.scoped([scope.companyId], async (tx) => {
      const f = await tx.storedFile.create({
        data: {
          ...scope,
          kind: 'REGISTER_IMPORT',
          storageKey: stored.key,
          originalName: name,
          mimeType: MIME[type]!,
          sizeBytes: stored.sizeBytes,
          sha256: stored.sha256,
          uploadedById: p.userId,
        },
      });
      const i = await tx.registerImport.create({
        data: { ...scope, fileId: f.id, headers: sheet.headers, totalRows: sheet.rows.length, createdById: p.userId },
        include: importInclude,
      });
      await this.audit.record(
        {
          action: 'register_import.upload',
          outcome: 'SUCCESS',
          actorUserId: p.userId,
          actorEmail: p.email,
          ...scope,
          targetType: 'register_import',
          targetId: i.id,
          metadata: { fileName: name, rows: sheet.rows.length, sha256: stored.sha256 },
          meta,
        },
        tx,
      );
      return i;
    });
    const [dto] = await this.withUserNames([this.toDto(imp, sheet.rows.slice(0, 5).map((r) => Object.fromEntries(sheet.headers.map((h, c) => [h, r[c] ?? '']))))]);
    return dto!;
  }

  // ─── Validate (preview) ─────────────────────────────────────────────

  async validate(p: AuthPrincipal, scope: Scope, importId: string, body: unknown, meta: RequestMeta): Promise<ImportDto> {
    const input = parseBody(importMappingSchema, body);
    const imp = await this.getRow(scope, importId);
    if (imp.status !== 'UPLOADED' && imp.status !== 'VALIDATED') {
      throw new ConflictException(`This import is ${imp.status.toLowerCase()} and can no longer be changed`);
    }
    for (const [field, header] of Object.entries(input.mapping)) {
      if (!imp.headers.includes(header)) throw new BadRequestException(`Column "${header}" mapped to ${field} is not in the file`);
    }

    const file = await this.prisma.scoped([scope.companyId], (tx) => tx.storedFile.findUniqueOrThrow({ where: { id: imp.fileId } }));
    const buf = await this.storage.get(file.storageKey);
    const sheet = await parseRegisterFile(buf, sniffFileType(buf) === 'xlsx' ? 'xlsx' : 'text');

    const row = await this.prisma.scoped(
      [scope.companyId],
      async (tx) => {
        const state = await this.loadState(tx, scope.companyId);
        const result = validateRegister(sheet, input.mapping as Partial<Record<ImportFieldKey, string>>, input.mode, state);

        await tx.registerImportRow.deleteMany({ where: { importId } });
        const rowData: Prisma.RegisterImportRowCreateManyInput[] = result.rows.map((r) => ({
          ...scope,
          importId,
          rowNumber: r.rowNumber,
          raw: r.raw,
          normalized: (r.normalized ?? undefined) as Prisma.InputJsonValue | undefined,
          status: r.status,
          action: r.action,
          errors: r.errors,
        }));
        // Closed holdings are stored as synthetic rows after the data rows so the preview can list them.
        result.closed.forEach((c, i) =>
          rowData.push({
            ...scope,
            importId,
            rowNumber: 1_000_000 + i,
            raw: {},
            normalized: { closed: c } as unknown as Prisma.InputJsonValue,
            status: 'VALID',
            action: 'CLOSED',
            errors: [],
          }),
        );
        for (const part of chunks(rowData)) await tx.registerImportRow.createMany({ data: part });

        const updated = await tx.registerImport.update({
          where: { id: importId },
          data: {
            status: 'VALIDATED',
            mode: input.mode,
            asOfDate: new Date(`${input.asOfDate}T00:00:00Z`),
            mapping: input.mapping,
            totalRows: result.rows.length,
            validRows: result.validRows,
            errorRows: result.errorRows,
            summary: { ...result.summary, autoCreateClasses: result.autoCreateClasses },
            validatedAt: new Date(),
          },
          include: importInclude,
        });
        await this.audit.record(
          {
            action: 'register_import.validate',
            outcome: 'SUCCESS',
            actorUserId: p.userId,
            actorEmail: p.email,
            ...scope,
            targetType: 'register_import',
            targetId: importId,
            metadata: { mode: input.mode, ...result.summary, errorRows: result.errorRows },
            meta,
          },
          tx,
        );
        return updated;
      },
      { timeoutMs: 120_000 },
    );
    return this.named(row);
  }

  private async loadState(tx: Tx, companyId: string): Promise<RegisterState> {
    const [identities, corporates, classes] = await Promise.all([
      tx.shareholderIdentity.findMany({
        where: { companyId },
        select: {
          id: true,
          kind: true,
          value: true,
          shareholder: { select: { id: true, name: true, type: true } },
          holdings: { where: { validTo: null }, select: { id: true, quantity: true, shareClass: { select: { code: true } } } },
        },
      }),
      tx.shareholder.findMany({ where: { companyId, type: 'CORPORATE' }, select: { id: true, name: true } }),
      tx.shareClass.findMany({ where: { companyId }, select: { code: true } }),
    ]);
    return {
      identities: new Map(
        identities.map((i) => [
          `${i.kind}:${i.value}`,
          {
            identityId: i.id,
            shareholderId: i.shareholder.id,
            shareholderName: i.shareholder.name,
            holderType: i.shareholder.type,
            holdings: new Map(i.holdings.map((h) => [h.shareClass.code, { holdingId: h.id, quantity: h.quantity }])),
          },
        ]),
      ),
      corporateByName: new Map(corporates.map((c) => [c.name.trim().replace(/\s+/g, ' ').toLowerCase(), c.id])),
      shareClassCodes: new Set(classes.map((c) => c.code)),
    };
  }

  // ─── Rows ────────────────────────────────────────────────────────────

  async rows(scope: Scope, importId: string, filter: string | undefined, pageRaw: string | undefined, pii: boolean): Promise<Paginated<ImportRowDto>> {
    const imp = await this.getRow(scope, importId);
    const map = (imp.mapping ?? {}) as Partial<Record<ImportFieldKey, string>>;
    const page = Math.max(1, Number(pageRaw) || 1);
    const pageSize = 50;
    const where: Prisma.RegisterImportRowWhereInput = {
      importId,
      ...(filter === 'ERROR' ? { status: 'ERROR' } : {}),
      ...(filter && ['NEW', 'CHANGED', 'UNCHANGED', 'CLOSED'].includes(filter) ? { action: filter as 'NEW' } : {}),
    };
    return this.prisma.scoped([scope.companyId], async (tx) => {
      const [total, rows] = await Promise.all([
        tx.registerImportRow.count({ where }),
        tx.registerImportRow.findMany({ where, orderBy: { rowNumber: 'asc' }, skip: (page - 1) * pageSize, take: pageSize }),
      ]);
      const mask = (v: string) => (pii ? v : `${v.slice(0, 4)}••••${v.slice(-4)}`);
      return {
        items: rows.map((r) => {
          const n = r.normalized as (NormalizedRow & { closed?: undefined }) | { closed: { identityKey: string; shareholderName: string; previousShares: string; shareClass: string } } | null;
          if (n && 'closed' in n && n.closed) {
            return {
              rowNumber: r.rowNumber,
              status: r.status,
              action: r.action,
              errors: [],
              warnings: [`Not in the file: ${n.closed.shareClass} holding will be closed`],
              identifier: mask(n.closed.identityKey.split(':')[1]!),
              name: n.closed.shareholderName,
              shares: '0',
              previousShares: n.closed.previousShares,
            };
          }
          const norm = n as NormalizedRow | null;
          const raw = r.raw as Record<string, string>;
          return {
            rowNumber: r.rowNumber,
            status: r.status,
            action: r.action,
            errors: r.errors,
            warnings: norm?.warnings ?? [],
            // Error rows show what the file contained, so the user can find and fix the row.
            identifier: norm ? mask(norm.value) : ((v) => (v ? mask(v) : null))(raw[map.boId ?? ''] || raw[map.folio ?? '']),
            name: norm?.name ?? (raw[map.name ?? ''] || null),
            shares: norm?.shares ?? (raw[map.shares ?? ''] || null),
            previousShares: norm?.existing?.previousShares ?? null,
          };
        }),
        total,
        page,
        pageSize,
      };
    });
  }

  // ─── Commit ─────────────────────────────────────────────────────────

  async commit(p: AuthPrincipal, scope: Scope, importId: string, body: { acceptErrors?: boolean }, meta: RequestMeta): Promise<ImportDto> {
    const row = await this.prisma.scoped(
      [scope.companyId],
      async (tx) => {
        // Lock the import row so two commits cannot run at once.
        const locked = await tx.$queryRaw<{ status: string }[]>`SELECT status FROM register_imports WHERE id = ${importId}::uuid FOR UPDATE`;
        if (locked.length === 0) throw new NotFoundException('Import not found');
        const imp = await tx.registerImport.findUniqueOrThrow({ where: { id: importId } });
        if (imp.status !== 'VALIDATED') throw new ConflictException('Validate the import before committing it');
        if (imp.errorRows > 0 && imp.mode === 'FULL') {
          throw new BadRequestException('A full register import must have no error rows. Fix the file and upload it again.');
        }
        if (imp.errorRows > 0 && !body.acceptErrors) {
          throw new BadRequestException(`${imp.errorRows} rows have errors. Confirm that they should be skipped.`);
        }
        const newer = await tx.registerImport.findFirst({
          where: { companyId: scope.companyId, status: 'COMMITTED', committedAt: { gt: imp.validatedAt! } },
          select: { id: true },
        });
        if (newer) throw new ConflictException('The register changed after this preview. Validate again before committing.');

        const now = new Date();
        const asOfDate = imp.asOfDate!;
        const rows = await tx.registerImportRow.findMany({ where: { importId, status: 'VALID' }, orderBy: { rowNumber: 'asc' } });

        // Share classes: create ORD automatically when the file relies on the default.
        const summary = imp.summary as { autoCreateClasses?: string[] } | null;
        for (const code of summary?.autoCreateClasses ?? []) {
          await tx.shareClass.upsert({
            where: { companyId_code: { companyId: scope.companyId, code } },
            create: { ...scope, code, name: 'Ordinary shares', votesPerShare: 1 },
            update: {},
          });
        }
        const classId = new Map((await tx.shareClass.findMany({ where: { companyId: scope.companyId } })).map((c) => [c.code, c.id]));

        const newShareholders: Prisma.ShareholderCreateManyInput[] = [];
        const newIdentities: Prisma.ShareholderIdentityCreateManyInput[] = [];
        const newHoldings: Prisma.ShareholdingCreateManyInput[] = [];
        const closeHoldingIds: string[] = [];
        const nameUpdates = new Map<string, { name: string; nameBn: string | null }>();
        const contactsWanted: { shareholderId: string; kind: 'PHONE' | 'EMAIL'; value: string }[] = [];
        const groupShareholder = new Map<string, string>();
        const identityIdByKey = new Map<string, string>();

        for (const r of rows) {
          if (r.action === 'CLOSED') {
            closeHoldingIds.push((r.normalized as { closed: { holdingId: string } }).closed.holdingId);
            continue;
          }
          const n = r.normalized as unknown as NormalizedRow;
          let shareholderId: string;
          let identityId: string;
          const key = `${n.kind}:${n.value}`;

          if (n.existing) {
            shareholderId = n.existing.shareholderId;
            identityId = n.existing.identityId;
            if (n.nameChanged) nameUpdates.set(shareholderId, { name: n.name, nameBn: n.nameBn });
          } else if (identityIdByKey.has(key)) {
            // Same account appears again with another share class.
            identityId = identityIdByKey.get(key)!;
            shareholderId = newIdentities.find((i) => i.id === identityId)!.shareholderId;
          } else {
            if (n.linkShareholderId) shareholderId = n.linkShareholderId;
            else if (n.groupKey && groupShareholder.has(n.groupKey)) shareholderId = groupShareholder.get(n.groupKey)!;
            else {
              shareholderId = randomUUID();
              newShareholders.push({ id: shareholderId, ...scope, type: n.holderType, name: n.name, nameBn: n.nameBn });
              if (n.groupKey) groupShareholder.set(n.groupKey, shareholderId);
            }
            identityId = randomUUID();
            identityIdByKey.set(key, identityId);
            newIdentities.push({ id: identityId, ...scope, shareholderId, kind: n.kind, value: n.value });
          }

          if (r.action === 'NEW' || r.action === 'CHANGED') {
            if (n.existing?.holdingId && n.existing.previousShares !== n.shares) closeHoldingIds.push(n.existing.holdingId);
            if (!n.existing?.holdingId || n.existing.previousShares !== n.shares) {
              newHoldings.push({ ...scope, identityId, shareClassId: classId.get(n.shareClass)!, quantity: BigInt(n.shares), asOfDate, validFrom: now, importId });
            }
          }
          if (n.phone) contactsWanted.push({ shareholderId, kind: 'PHONE', value: n.phone });
          if (n.email) contactsWanted.push({ shareholderId, kind: 'EMAIL', value: n.email });
        }

        for (const part of chunks(newShareholders)) await tx.shareholder.createMany({ data: part });
        for (const part of chunks(newIdentities)) await tx.shareholderIdentity.createMany({ data: part });
        for (const part of chunks(closeHoldingIds)) await tx.shareholding.updateMany({ where: { id: { in: part }, validTo: null }, data: { validTo: now } });
        for (const part of chunks(newHoldings)) await tx.shareholding.createMany({ data: part });
        for (const [id, v] of nameUpdates) await tx.shareholder.update({ where: { id }, data: v });
        const contactChanges = await this.applyContacts(tx, scope, contactsWanted, now);

        const done = await tx.registerImport.update({
          where: { id: importId },
          data: { status: 'COMMITTED', committedAt: now, committedById: p.userId },
          include: importInclude,
        });
        await this.audit.record(
          {
            action: 'register_import.commit',
            outcome: 'SUCCESS',
            actorUserId: p.userId,
            actorEmail: p.email,
            ...scope,
            targetType: 'register_import',
            targetId: importId,
            metadata: {
              shareholdersCreated: newShareholders.length,
              identitiesCreated: newIdentities.length,
              holdingsWritten: newHoldings.length,
              holdingsClosed: closeHoldingIds.length,
              namesUpdated: nameUpdates.size,
              contactsChanged: contactChanges,
              skippedErrorRows: imp.errorRows,
            },
            meta,
          },
          tx,
        );
        return done;
      },
      { timeoutMs: 300_000 },
    );
    return this.named(row);
  }

  /** Replaces register-sourced contacts when the file has a different value. Manual contacts are left alone. */
  private async applyContacts(
    tx: Tx,
    scope: Scope,
    wanted: { shareholderId: string; kind: 'PHONE' | 'EMAIL'; value: string }[],
    now: Date,
  ): Promise<number> {
    if (wanted.length === 0) return 0;
    const ids = [...new Set(wanted.map((w) => w.shareholderId))];
    const current = await tx.shareholderContact.findMany({
      where: { companyId: scope.companyId, shareholderId: { in: ids }, retiredAt: null, source: 'REGISTER' },
    });
    const byKey = new Map<string, typeof current>();
    for (const c of current) (byKey.get(`${c.shareholderId}|${c.kind}`) ?? byKey.set(`${c.shareholderId}|${c.kind}`, []).get(`${c.shareholderId}|${c.kind}`)!).push(c);

    const desired = new Map<string, string>();
    for (const w of wanted) desired.set(`${w.shareholderId}|${w.kind}`, w.value);

    const retire: string[] = [];
    const create: Prisma.ShareholderContactCreateManyInput[] = [];
    for (const [key, value] of desired) {
      const existing = byKey.get(key) ?? [];
      if (existing.some((c) => c.value === value)) continue;
      retire.push(...existing.map((c) => c.id));
      const [shareholderId, kind] = key.split('|') as [string, 'PHONE' | 'EMAIL'];
      create.push({ ...scope, shareholderId, kind, value, source: 'REGISTER', verifiedAt: now });
    }
    for (const part of chunks(retire)) await tx.shareholderContact.updateMany({ where: { id: { in: part } }, data: { retiredAt: now } });
    for (const part of chunks(create)) await tx.shareholderContact.createMany({ data: part });
    return create.length;
  }

  // ─── Cancel, list, get ──────────────────────────────────────────────

  async cancel(p: AuthPrincipal, scope: Scope, importId: string, meta: RequestMeta): Promise<ImportDto> {
    const row = await this.prisma.scoped([scope.companyId], async (tx) => {
      const imp = await tx.registerImport.findFirst({ where: { id: importId, companyId: scope.companyId } });
      if (!imp) throw new NotFoundException('Import not found');
      if (imp.status === 'COMMITTED') throw new ConflictException('A committed import cannot be cancelled');
      const done = await tx.registerImport.update({ where: { id: importId }, data: { status: 'CANCELLED' }, include: importInclude });
      await this.audit.record(
        { action: 'register_import.cancel', outcome: 'SUCCESS', actorUserId: p.userId, actorEmail: p.email, ...scope, targetType: 'register_import', targetId: importId, meta },
        tx,
      );
      return done;
    });
    return this.named(row);
  }

  async list(scope: Scope): Promise<ImportDto[]> {
    return this.prisma.scoped([scope.companyId], async (tx) => {
      const rows = await tx.registerImport.findMany({
        where: { companyId: scope.companyId },
        include: importInclude,
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
      return this.withUserNames(rows.map((r) => this.toDto(r, [])));
    });
  }

  async get(scope: Scope, importId: string): Promise<ImportDto> {
    const imp = await this.prisma.scoped([scope.companyId], (tx) =>
      tx.registerImport.findFirst({ where: { id: importId, companyId: scope.companyId }, include: importInclude }),
    );
    if (!imp) throw new NotFoundException('Import not found');
    let sample: Record<string, string>[] = [];
    if (imp.status === 'UPLOADED' || imp.status === 'VALIDATED') {
      const file = await this.prisma.scoped([scope.companyId], (tx) => tx.storedFile.findUniqueOrThrow({ where: { id: imp.fileId } }));
      const buf = await this.storage.get(file.storageKey);
      const sheet = await parseRegisterFile(buf, sniffFileType(buf) === 'xlsx' ? 'xlsx' : 'text');
      sample = sheet.rows.slice(0, 5).map((r) => Object.fromEntries(sheet.headers.map((h, c) => [h, r[c] ?? ''])));
    }
    const [dto] = await this.withUserNames([this.toDto(imp, sample)]);
    return dto!;
  }

  private async getRow(scope: Scope, importId: string) {
    const imp = await this.prisma.scoped([scope.companyId], (tx) =>
      tx.registerImport.findFirst({ where: { id: importId, companyId: scope.companyId } }),
    );
    if (!imp) throw new NotFoundException('Import not found');
    return imp;
  }

  private async named(row: Parameters<ImportsService['toDto']>[0]): Promise<ImportDto> {
    const [dto] = await this.withUserNames([this.toDto(row, [])]);
    return dto!;
  }

  private async withUserNames(items: ImportDto[]): Promise<ImportDto[]> {
    const ids = [...new Set(items.flatMap((i) => [i.createdBy, i.committedBy]).filter((x): x is string => !!x))];
    if (ids.length === 0) return items;
    const users = new Map((await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
    return items.map((i) => ({
      ...i,
      createdBy: i.createdBy ? (users.get(i.createdBy) ?? null) : null,
      committedBy: i.committedBy ? (users.get(i.committedBy) ?? null) : null,
    }));
  }

  private toDto(
    i: {
      id: string;
      status: ImportDto['status'];
      mode: 'FULL' | 'DELTA' | null;
      asOfDate: Date | null;
      headers: string[];
      mapping: Prisma.JsonValue;
      totalRows: number;
      validRows: number;
      errorRows: number;
      summary: Prisma.JsonValue;
      createdById: string;
      createdAt: Date;
      validatedAt: Date | null;
      committedById: string | null;
      committedAt: Date | null;
      failureMessage: string | null;
      file: { originalName: string; sizeBytes: number };
    },
    sampleRows: Record<string, string>[],
  ): ImportDto {
    const s = i.summary as ImportDto['summary'];
    return {
      id: i.id,
      status: i.status,
      fileName: i.file.originalName,
      fileSize: i.file.sizeBytes,
      mode: i.mode,
      asOfDate: i.asOfDate?.toISOString().slice(0, 10) ?? null,
      headers: i.headers,
      mapping: (i.mapping as ImportDto['mapping']) ?? null,
      suggestedMapping: suggestMapping(i.headers),
      sampleRows,
      totalRows: i.totalRows,
      validRows: i.validRows,
      errorRows: i.errorRows,
      summary: s ? { new: s.new, changed: s.changed, unchanged: s.unchanged, closed: s.closed } : null,
      createdBy: i.createdById,
      createdAt: i.createdAt.toISOString(),
      validatedAt: i.validatedAt?.toISOString() ?? null,
      committedBy: i.committedById,
      committedAt: i.committedAt?.toISOString() ?? null,
      failureMessage: i.failureMessage,
    };
  }
}
