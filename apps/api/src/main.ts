import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { loadEnv } from '@athlete/config';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  const app = await NestFactory.create(AppModule, { bodyParser: true });

  // ETag is only useful to a browser client if it is allowed to read it.
  app.enableCors({ exposedHeaders: ['ETag'] });
  app.setGlobalPrefix('api/v1');

  // Migrations run as their own CI job before deploy -- never here. Two replicas
  // booting at once would otherwise race each other through the same migration.
  await app.listen(env.PORT);
  new Logger('bootstrap').log(`API listening on :${env.PORT} (${env.NODE_ENV})`);
}

void bootstrap();
