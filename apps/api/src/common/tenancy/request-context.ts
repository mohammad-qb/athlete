import { AsyncLocalStorage } from 'node:async_hooks';
import type { Role } from '@athlete/contracts';
import type { TenantTx } from './database.service';

export interface Principal {
  userId: string;
  academyId: string;
  roles: Role[];
}

export interface RequestContext extends Principal {
  /**
   * The transaction this request runs in. It already has the tenant key applied via
   * set_config('app.current_academy_id', ..., true), so every query made through it is
   * subject to RLS. Repositories read the transaction from here rather than receiving a
   * connection by parameter, which is what makes "unscoped query" unrepresentable.
   */
  tx: TenantTx;
  requestId: string;
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
