import { Global, Module } from '@nestjs/common';
import { loadEnv } from '@athlete/config';
import { AuthDatabase } from './auth.database';
import { createAuth } from './auth.factory';
import { AuthGateway } from './auth.gateway';
import { AuthSessionStore } from './auth-session.store';
import { AuthenticationGuard } from './authentication.guard';
import { MeController } from './me.controller';
import { MeService } from './me.service';
import { PrincipalRepository } from './principal.repository';

/**
 * Global because the authentication guard is registered application-wide in AppModule
 * and needs the gateway, the principal lookup and the session store injected into it.
 *
 * `AuthDatabase` is NOT exported: the `athlete_auth` pool stays inside this module, so
 * no feature module can be handed a connection that reads credentials.
 */
@Global()
@Module({
  controllers: [MeController],
  providers: [
    {
      provide: AuthDatabase,
      useFactory: () => new AuthDatabase(loadEnv().AUTH_DATABASE_URL),
    },
    {
      provide: AuthGateway,
      // Async because better-auth is an ES module loaded with `import()`; Nest awaits
      // the factory before anything that injects the gateway is constructed.
      useFactory: async (database: AuthDatabase) => {
        const env = loadEnv();
        const auth = await createAuth({
          pool: database.pool,
          secret: env.SESSION_SECRET,
          baseURL: env.APP_BASE_URL,
          // Accounts are created by the operator CLI (src/cli/create-user.ts), never
          // by a request.
          allowSignUp: false,
          trustedProxies: env.AUTH_TRUSTED_PROXIES,
        });
        return AuthGateway.create(auth);
      },
      inject: [AuthDatabase],
    },
    AuthSessionStore,
    PrincipalRepository,
    MeService,
    AuthenticationGuard,
  ],
  exports: [AuthGateway, AuthSessionStore, PrincipalRepository, AuthenticationGuard],
})
export class AuthModule {}
