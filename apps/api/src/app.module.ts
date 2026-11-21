import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { CommonModule } from './common/common.module';
import { AuthorizationGuard } from './common/authz/authorization.guard';
import { TenantTransactionInterceptor } from './common/tenancy/tenant-transaction.interceptor';
import { AuthModule } from './modules/auth/auth.module';
import { AuthenticationGuard } from './modules/auth/authentication.guard';
import { AthletesModule } from './modules/athletes/athletes.module';
import { TeamsModule } from './modules/teams/teams.module';
import { SessionsModule } from './modules/sessions/sessions.module';
import { HealthController } from './health/health.controller';

@Module({
  imports: [CommonModule, AuthModule, AthletesModule, TeamsModule, SessionsModule],
  controllers: [HealthController],
  providers: [
    // Global guards run in registration order: identify first, then decide.
    { provide: APP_GUARD, useClass: AuthenticationGuard },
    // Deny by default: a route without @Authorize or @Public is refused.
    { provide: APP_GUARD, useClass: AuthorizationGuard },
    // Every authenticated request runs inside a tenant-scoped transaction.
    { provide: APP_INTERCEPTOR, useClass: TenantTransactionInterceptor },
  ],
})
export class AppModule {}
