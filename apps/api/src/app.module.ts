import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { CommonModule } from './common/common.module';
import { AuthorizationGuard } from './common/authz/authorization.guard';
import { TenantTransactionInterceptor } from './common/tenancy/tenant-transaction.interceptor';
import { AuthModule } from './modules/auth/auth.module';
import { AuthenticationGuard } from './modules/auth/authentication.guard';
import { AthletesModule } from './modules/athletes/athletes.module';
import { TeamsModule } from './modules/teams/teams.module';
import { SessionsModule } from './modules/sessions/sessions.module';
import { HealthController } from './health/health.controller';
import { ErrorResponder } from './common/errors/error-responder';
import { AllExceptionsFilter } from './common/errors/filters/all-exceptions.filter';
import { ApiErrorFilter } from './common/errors/filters/api-error.filter';
import { HttpExceptionFilter } from './common/errors/filters/http-exception.filter';

/**
 * Every controller is mounted under this prefix. A constant rather than a literal in
 * `main.ts` so the route manifest prints the paths a client actually calls.
 */
export const API_GLOBAL_PREFIX = 'api/v1';

@Module({
  imports: [CommonModule, AuthModule, AthletesModule, TeamsModule, SessionsModule],
  controllers: [HealthController],
  providers: [
    // Global guards run in registration order: identify first, then decide.
    { provide: APP_GUARD, useClass: AuthenticationGuard },
    // Deny by default: a route without @Permission or @Public is refused.
    { provide: APP_GUARD, useClass: AuthorizationGuard },
    // Every authenticated request runs inside a tenant-scoped transaction.
    { provide: APP_INTERCEPTOR, useClass: TenantTransactionInterceptor },

    // One error contract, three normalisers. Nest REVERSES the global filter list and
    // takes the first @Catch metadata match, so the LAST registered filter is tried
    // FIRST: the catch-all goes first and the most specific goes last. All three live
    // in this one array precisely so that order is visible and deterministic -- an
    // APP_FILTER registered in a feature module would silently reorder them.
    ErrorResponder,
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_FILTER, useClass: ApiErrorFilter },
  ],
})
export class AppModule {}
