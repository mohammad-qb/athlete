import type { NestExpressApplication } from '@nestjs/platform-express';
import { AUTH_BASE_PATH } from './auth.factory';
import { AuthGateway } from './auth.gateway';

/**
 * Hands `/api/auth/*` to better-auth, on the Express instance underneath Nest.
 *
 * Order is the whole point, and why this is a function called from `main.ts` at one
 * exact moment. better-auth reads the request body itself, so its handler must sit in
 * front of any body parser: the application is created with `bodyParser: false`, this
 * route is registered, and only then are the parsers added for our own routes.
 *
 * `*splat` is Express 5's named wildcard. The bare `*` of Express 4 matches nothing
 * under path-to-regexp v8 -- the same trap AuthenticationGuard's header describes.
 *
 * These routes are the library's API and answer in its own shapes. They pass through
 * no Nest guard, interceptor or filter: better-auth authenticates them, checks their
 * origin, and rate-limits them itself.
 */
export function mountAuth(app: NestExpressApplication): void {
  const handler = app.get(AuthGateway).nodeHandler();

  app
    .getHttpAdapter()
    .getInstance()
    .all(`${AUTH_BASE_PATH}/*splat`, (request, response, next) => {
      handler(request, response).catch(next);
    });

  app.useBodyParser('json');
  app.useBodyParser('urlencoded', { extended: true });
}
