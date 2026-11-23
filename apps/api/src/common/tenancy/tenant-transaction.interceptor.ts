import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { from, lastValueFrom, type Observable } from 'rxjs';
import { defineAbility } from '../authz/ability';
import { PrincipalScopeRepository } from '../authz/principal-scope.repository';
import { DatabaseService } from './database.service';
import { requestContext, type Principal } from './request-context';

/**
 * Wraps each authenticated request in a tenant-scoped transaction and publishes it
 * through AsyncLocalStorage, so repositories cannot run outside one.
 *
 * Cost, stated openly: every request -- reads included -- now runs inside a
 * transaction. At 100-200 concurrent users (and at the 10x ceiling) that is
 * immaterial, and it buys an isolation guarantee that no amount of code review can.
 * If read volume ever made it matter, the fix is a read-only transaction on a replica,
 * not abandoning the mechanism.
 *
 * It is also where the SCOPED ability is built. The guard has already asked the coarse
 * question; the scoped one needs the principal's current teams and athletes, which
 * need a query, which needs the tenant transaction -- and guards run before
 * interceptors. So scope is resolved here, once per request, at a single `asOf` taken
 * from the database clock (the transaction's `now()`), and every rule evaluated during
 * the request sees the same instant.
 */
@Injectable()
export class TenantTransactionInterceptor implements NestInterceptor {
  constructor(
    private readonly database: DatabaseService,
    private readonly scopes: PrincipalScopeRepository,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<{ principal?: Principal }>();
    const principal = request.principal;

    // Public routes (health, login) have no tenant and therefore get no tenant transaction.
    if (!principal) return next.handle();

    const requestId = randomUUID();

    return from(
      this.database.runInTenantTransaction(principal.academyId, async (tx, startedAt) => {
        const scope = await this.scopes.resolve(tx, principal, startedAt);
        const ability = defineAbility(principal, { scoped: true, scope });
        return requestContext.run({ ...principal, ...scope, ability, tx, requestId }, () =>
          lastValueFrom(next.handle()),
        );
      }),
    );
  }
}
