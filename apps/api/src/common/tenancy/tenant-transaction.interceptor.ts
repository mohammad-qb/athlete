import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { from, lastValueFrom, type Observable } from 'rxjs';
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
 */
@Injectable()
export class TenantTransactionInterceptor implements NestInterceptor {
  constructor(private readonly database: DatabaseService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<{ principal?: Principal }>();
    const principal = request.principal;

    // Public routes (health, login) have no tenant and therefore get no tenant transaction.
    if (!principal) return next.handle();

    const requestId = randomUUID();

    return from(
      this.database.runInTenantTransaction(principal.academyId, (tx) =>
        requestContext.run({ ...principal, tx, requestId }, () =>
          lastValueFrom(next.handle()),
        ),
      ),
    );
  }
}
