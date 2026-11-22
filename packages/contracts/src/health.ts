import { z } from 'zod';

/** `GET /health`: liveness only. It says the process answers, not that the database does. */
export const HealthResponse = z
  .object({ status: z.literal('ok'), uptimeSeconds: z.number().int().nonnegative() })
  .meta({ id: 'HealthResponse' });
export type HealthResponse = z.infer<typeof HealthResponse>;
