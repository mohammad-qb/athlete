import { Global, Module } from '@nestjs/common';
import { loadEnv } from '@athlete/config';
import { DatabaseService } from './tenancy/database.service';
import { PolicyService } from './authz/policy.service';

/**
 * Global so feature modules get the database and policy services without re-declaring
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
    PolicyService,
  ],
  exports: [DatabaseService, PolicyService],
})
export class CommonModule {}
