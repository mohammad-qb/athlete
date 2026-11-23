import { Global, Module } from '@nestjs/common';
import { loadEnv } from '@athlete/config';
import { DatabaseService } from './tenancy/database.service';
import { PrincipalScopeRepository } from './authz/principal-scope.repository';

/**
 * Global so feature modules get the database and scope-resolution services without re-declaring
 * them. Note what is NOT global: repositories. Each module owns its own, which is what
 * the dependency-cruiser boundary rules enforce.
 */
@Global()
@Module({
  providers: [
    {
      provide: DatabaseService,
      useFactory: () => {
        const env = loadEnv();
        return new DatabaseService(env.DATABASE_URL);
      },
    },
    PrincipalScopeRepository,
  ],
  exports: [DatabaseService, PrincipalScopeRepository],
})
export class CommonModule {}
