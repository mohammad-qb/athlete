/** What the database driver reported about a failed statement. */
export interface DriverError {
  /** The SQLSTATE, e.g. `23P01` (exclusion violation). */
  code: string;
  /** The violated constraint's name, for an integrity violation that names one. */
  constraint: string | undefined;
  message: string;
}

/**
 * The driver's own error out of whatever a failed query threw, or `undefined` when the
 * failure did not come from the database.
 *
 * Drizzle wraps the driver's error (`DrizzleQueryError <- error from pg`), and the `pg`
 * error is the one carrying the SQLSTATE and the constraint, so the cause chain is
 * walked (bounded, and safe against a self-referential cause).
 *
 * This is how a rule the DATABASE enforces becomes a typed refusal instead of a 500:
 * the service that issued the write names the failures it expects and what each one
 * means to the caller, and rethrows everything else untouched.
 */
export function driverError(error: unknown): DriverError | undefined {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (typeof current === 'object' && current !== null && !seen.has(current) && seen.size < 5) {
    seen.add(current);
    const { code, constraint, message, cause } = current as {
      code?: unknown;
      constraint?: unknown;
      message?: unknown;
      cause?: unknown;
    };
    // A SQLSTATE is five characters; Node's own error codes (`ECONNREFUSED`) are not.
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) {
      return {
        code,
        constraint: typeof constraint === 'string' ? constraint : undefined,
        message: typeof message === 'string' ? message : '',
      };
    }
    current = cause;
  }
  return undefined;
}

/**
 * The name of the constraint a failed statement violated, or `undefined` when the
 * failure is something else. Only integrity violations (SQLSTATE class 23) count: a
 * constraint name on any other error is not a rule the caller broke.
 */
export function violatedConstraint(error: unknown): string | undefined {
  const driver = driverError(error);
  return driver?.code.startsWith('23') ? driver.constraint : undefined;
}

/**
 * True when a statement tried to build a range whose end is before its start
 * (SQLSTATE 22000, raised by the range constructor). For a table whose period is a
 * GENERATED range column this is how "ends before it starts" fails: the column is
 * computed before any CHECK constraint is looked at, so the constraint that states the
 * rule never gets to speak.
 */
export function isInvertedRange(error: unknown): boolean {
  const driver = driverError(error);
  return driver?.code === '22000' && driver.message.includes('range lower bound');
}
