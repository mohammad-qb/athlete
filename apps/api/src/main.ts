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

/**
 * A refused connection arrives as an `AggregateError` (one attempt per address family)
 * whose own message is empty -- the reason lives in `errors`, and for a wrapped driver
 * error in `cause`. Walk both so the boot failure names what actually went wrong.
 */
function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const nested = [
    ...(error instanceof AggregateError ? (error.errors as unknown[]) : []),
    ...(error.cause === undefined ? [] : [error.cause]),
  ].map(describeError);
  const own = error.message || error.name;
  return nested.length === 0 ? own : `${own}: ${[...new Set(nested)].join('; ')}`;
}

bootstrap().catch((error: unknown) => {
  new Logger('bootstrap').error(describeError(error));
  process.exit(1);
});
