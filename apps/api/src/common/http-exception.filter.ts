import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Response } from 'express';
import type { AppRequest } from './request-context.js';

/**
 * Normalises every error to { statusCode, message, errors? }.
 * Unknown errors are logged server-side with the request id and returned as a
 * generic 500, so stack traces and SQL never reach the client.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HTTP');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<AppRequest>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'object' && body !== null) {
        const b = body as Record<string, unknown>;
        res.status(status).json({
          statusCode: status,
          message: typeof b.message === 'string' ? b.message : Array.isArray(b.message) ? b.message.join(', ') : exception.message,
          ...(b.errors ? { errors: b.errors } : {}),
          ...(typeof b.code === 'string' ? { code: b.code } : {}),
        });
      } else {
        res.status(status).json({ statusCode: status, message: String(body) });
      }
      return;
    }

    const prismaCode = (exception as { code?: string } | null)?.code;
    if (prismaCode === 'P2002') {
      res.status(HttpStatus.CONFLICT).json({ statusCode: 409, message: 'A record with these details already exists' });
      return;
    }
    if (prismaCode === 'P2025') {
      res.status(HttpStatus.NOT_FOUND).json({ statusCode: 404, message: 'Not found' });
      return;
    }

    this.logger.error(
      `Unhandled error on ${req.method} ${req.path} [request ${req.requestId ?? '-'}]`,
      exception instanceof Error ? exception.stack : String(exception),
    );
    res.status(500).json({ statusCode: 500, message: 'An unexpected error occurred' });
  }
}
