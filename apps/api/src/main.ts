import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { loadEnv } from '@athlete/config';
import { API_GLOBAL_PREFIX, AppModule } from './app.module';
import { assertDatabasePrivileges } from './common/tenancy/database-privileges';
import { DatabaseService } from './common/tenancy/database.service';

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  const app = await NestFactory.create(AppModule, { bodyParser: true });

  // ETag is only useful to a browser client if it is allowed to read it.
  app.enableCors({ exposedHeaders: ['ETag'] });
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
