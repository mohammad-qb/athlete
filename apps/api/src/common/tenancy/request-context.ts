import { AsyncLocalStorage } from 'node:async_hooks';
import type { AppAbility } from '../authz/ability';
import type { Principal, PrincipalScope } from '../authz/principal';
import type { TenantTx } from './database.service';

export type { Principal, PrincipalScope };

export interface RequestContext extends Principal, PrincipalScope {
  /**
   * The transaction this request runs in. It already has the tenant key applied via
   * set_config('app.current_academy_id', ..., true), so every query made through it is
   * subject to RLS. Repositories read the transaction from here rather than receiving a
   * connection by parameter, which is what makes "unscoped query" unrepresentable.
   */
  tx: TenantTx;
  requestId: string;
  /**
   * The SCOPED ability: the same policy the guard consulted, now carrying conditions
   * over this principal's teams and athletes as resolved at `asOf`. Repositories turn
   * it into WHERE predicates with `accessibleBy`; services instance-check a loaded row
   * with `ability.can(action, asSubject(type, row))`.
   */
  ability: AppAbility;
}

const storage = new AsyncLocalStorage<RequestContext>();

export const requestContext = {
  run<T>(context: RequestContext, fn: () => Promise<T>): Promise<T> {
    return storage.run(context, fn);
  },

  /** Throws rather than returning undefined: a missing tenant context is a bug, not a state. */
  require(): RequestContext {
    const context = storage.getStore();
    if (!context) {
      throw new Error(
        'No request context. Database access outside a tenant transaction is not permitted.',
      );
    }
    return context;
  },

  peek(): RequestContext | undefined {
    return storage.getStore();
  },
};
