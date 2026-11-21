import { Global, Module } from '@nestjs/common';
import { loadEnv } from '@athlete/config';
import { AuthenticationGuard } from './authentication.guard';
import { SessionService } from './session.service';

/**
 * Global because the authentication guard is registered application-wide in
 * AppModule and needs SessionService injected into it.
 */
@Global()
@Module({
  providers: [
    {
      provide: SessionService,
      useFactory: () => new SessionService(loadEnv().SESSION_SECRET),
    },
    AuthenticationGuard,
  ],
  exports: [SessionService, AuthenticationGuard],
})
export class AuthModule {}
