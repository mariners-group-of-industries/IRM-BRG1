import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { HttpExceptionFilter } from './common/http-exception.filter.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { AccessService } from './modules/access/access.service.js';
import { AuditService } from './modules/audit/audit.service.js';
import { AuthController } from './modules/auth/auth.controller.js';
import { AuthGuard } from './modules/auth/auth.guard.js';
import { AuthService } from './modules/auth/auth.service.js';
import { PasswordService } from './modules/auth/password.service.js';
import { SessionService } from './modules/auth/session.service.js';
import { DashboardController } from './modules/dashboard/dashboard.controller.js';
import { HealthController } from './modules/health/health.controller.js';
import { IdentityController } from './modules/identity/identity.controller.js';
import { CompaniesController } from './modules/tenancy/companies.controller.js';
import { TenantsController } from './modules/tenancy/tenants.controller.js';

/**
 * Modular monolith root. Phase A wires the platform core. Later phases add
 * ShareholdersModule, MeetingsModule, VotingModule and CommunicationModule
 * under src/modules with their own controllers and services.
 */
@Module({
  imports: [
    PrismaModule,
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'default', ttl: 60_000, limit: process.env.NODE_ENV === 'test' ? 10_000 : 300 }],
    }),
  ],
  controllers: [
    HealthController,
    AuthController,
    TenantsController,
    CompaniesController,
    IdentityController,
    DashboardController,
  ],
  providers: [
    AuditService,
    AccessService,
    PasswordService,
    SessionService,
    AuthService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule {}
