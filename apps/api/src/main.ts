import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { loadEnv } from '@athlete/config';
import { API_GLOBAL_PREFIX, AppModule } from './app.module';
import { assertDatabasePrivileges } from './common/tenancy/database-privileges';
import { DatabaseService } from './common/tenancy/database.service';
import { mountAuth } from './modules/auth/mount-auth';

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  // No body parser yet: better-auth must see its requests unparsed. `mountAuth`
  // registers its routes and then adds the parsers back for ours.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  mountAuth(app);

  // No CORS: the SPA is served from the same origin as the API (Front Door routes
  // /api/* here), so there is no cross-origin caller to allow -- and a same-origin
  // script can already read ETag.
  app.setGlobalPrefix(API_GLOBAL_PREFIX);

  // Before accepting a single request: are we connected as the constrained application
  // role? A superuser or owner connection serves traffic perfectly well while silently
  // voiding RLS and the privilege matrix, so it is refused here rather than discovered.
  await assertDatabasePrivileges(app.get(DatabaseService));

  // Migrations run as their own CI job before deploy -- never here. Two replicas
  // booting at once would otherwise race each other through the same migration.
  await app.listen(env.PORT);
  new Logger('bootstrap').log(`API listening on :${env.PORT} (${env.NODE_ENV})`);
}

bootstrap().catch((error: unknown) => {
  new Logger('bootstrap').error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
