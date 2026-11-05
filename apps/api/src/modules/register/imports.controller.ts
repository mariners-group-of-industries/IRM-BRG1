import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { PERMISSIONS, type ImportDto, type ImportRowDto, type Paginated } from '@irm/shared';
import { Meta, Principal } from '../../common/decorators.js';
import type { AuthPrincipal, RequestMeta } from '../../common/request-context.js';
import { AccessService } from '../access/access.service.js';
import { ImportsService } from './imports.service.js';

export const MAX_REGISTER_FILE_BYTES = 25 * 1024 * 1024;

@ApiTags('register-imports')
@Controller('companies/:companyId/imports')
export class ImportsController {
  constructor(
    private readonly imports: ImportsService,
    private readonly access: AccessService,
  ) {}

  private async scope(p: AuthPrincipal, companyId: string, meta?: RequestMeta) {
    const c = await this.access.assertCompany(p, companyId, PERMISSIONS.SHAREHOLDER_IMPORT, meta);
    return { tenantId: c.tenantId, companyId: c.id };
  }

  @Get()
  async list(@Principal() p: AuthPrincipal, @Param('companyId', new ParseUUIDPipe()) companyId: string): Promise<ImportDto[]> {
    return this.imports.list(await this.scope(p, companyId));
  }

  @Post()
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_REGISTER_FILE_BYTES, files: 1 } }))
  async upload(
    @Principal() p: AuthPrincipal,
    @Param('companyId', new ParseUUIDPipe()) companyId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Meta() meta: RequestMeta,
  ): Promise<ImportDto> {
    const scope = await this.scope(p, companyId, meta);
    if (!file) throw new BadRequestException('Attach a CSV or Excel file in the "file" field');
    return this.imports.upload(p, scope, file, meta);
  }

  @Get(':id')
  async get(
    @Principal() p: AuthPrincipal,
    @Param('companyId', new ParseUUIDPipe()) companyId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ImportDto> {
    return this.imports.get(await this.scope(p, companyId), id);
  }

  @Post(':id/validate')
  @HttpCode(200)
  async validate(
    @Principal() p: AuthPrincipal,
    @Param('companyId', new ParseUUIDPipe()) companyId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Meta() meta: RequestMeta,
  ): Promise<ImportDto> {
    return this.imports.validate(p, await this.scope(p, companyId, meta), id, body, meta);
  }

  @Get(':id/rows')
  async rows(
    @Principal() p: AuthPrincipal,
    @Param('companyId', new ParseUUIDPipe()) companyId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('filter') filter?: string,
    @Query('page') page?: string,
  ): Promise<Paginated<ImportRowDto>> {
    const scope = await this.scope(p, companyId);
    const pii = this.access.can(p, PERMISSIONS.SHAREHOLDER_PII_READ, scope);
    return this.imports.rows(scope, id, filter, page, pii);
  }

  @Post(':id/commit')
  @HttpCode(200)
  async commit(
    @Principal() p: AuthPrincipal,
    @Param('companyId', new ParseUUIDPipe()) companyId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: { acceptErrors?: unknown },
    @Meta() meta: RequestMeta,
  ): Promise<ImportDto> {
    return this.imports.commit(p, await this.scope(p, companyId, meta), id, { acceptErrors: body?.acceptErrors === true }, meta);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  async cancel(
    @Principal() p: AuthPrincipal,
    @Param('companyId', new ParseUUIDPipe()) companyId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Meta() meta: RequestMeta,
  ): Promise<ImportDto> {
    return this.imports.cancel(p, await this.scope(p, companyId, meta), id, meta);
  }
}
