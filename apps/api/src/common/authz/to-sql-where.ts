import {
  and,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  notInArray,
  or,
  sql,
  type AnyColumn,
  type SQL,
} from 'drizzle-orm';

/** Field name as it appears in a condition -> the column it filters. */
export type ColumnMap = Record<string, AnyColumn>;

type Scalar = string | number | boolean | Date | null;

/**
 * Compiles a CASL (Mongo-dialect) condition into a Drizzle `SQL` predicate for the core
 * query builder. `undefined` means "no restriction".
 *
 * This is the only hand-written direction. In memory, CASL's own matcher evaluates the
 * same condition object, so a rule is written once and enforced both on a loaded row
 * and in a WHERE clause.
 *
 * Three properties are deliberate:
 *
 *  - FLAT. A key is a column of the subject's own table or a logical operator. There
 *    is no relation traversal, so there is nothing the in-memory matcher cannot follow.
 *  - FAIL LOUD. An unknown operator, an unmapped field or a malformed operand throws.
 *    A compiler that skipped what it did not understand would drop a restriction and
 *    widen the query -- the one failure an authorization layer must never have.
 *  - NULL-FAITHFUL. Mongo semantics and SQL's three-valued logic disagree on absent
 *    values: `{ a: { $ne: 1 } }` matches a row where `a` is null in memory, but
 *    `a <> 1` is NULL (so: filtered out) in SQL. Negations are therefore compiled with
 *    `is distinct from` / `is not true`, so both directions give the same answer.
 *    Ordering has the same trap: in memory a null `a` MATCHES `{ a: { $lt: 5 } }`,
 *    while `a < 5` is NULL in SQL -- see `ordering`.
 *
 * It takes the column map as a parameter and imports nothing from the schema, which is
 * why it needs no exception to the `no-sql-outside-repositories` boundary rule: the
 * repository that owns the table supplies the columns.
 */
export function toSqlWhere(condition: unknown, columns: ColumnMap): SQL | undefined {
  if (!isPlainObject(condition)) {
    throw new TypeError(`Condition must be a plain object, received ${describe(condition)}`);
  }

  const clauses: SQL[] = [];

  for (const [key, value] of Object.entries(condition)) {
    if (key.startsWith('$')) {
      const clause = compileLogical(key, value, columns);
      if (clause) clauses.push(clause);
    } else {
      clauses.push(compileField(key, value, columns));
    }
  }

  return all(clauses);
}

function compileLogical(operator: string, operand: unknown, columns: ColumnMap): SQL | undefined {
  switch (operator) {
    case '$and': {
      // An unrestricted member restricts nothing, so it drops out of a conjunction.
      const members = compileMembers(operator, operand, columns);
      return all(members.filter((member) => member !== undefined));
    }
    case '$or': {
      // An unrestricted member makes the whole disjunction unrestricted.
      const members = compileMembers(operator, operand, columns);
      const restricted = members.filter((member) => member !== undefined);
      if (restricted.length !== members.length) return undefined;
      return restricted.length === 1 ? restricted[0] : or(...restricted);
    }
    case '$not': {
      const inner = toSqlWhere(operand, columns);
      // NOT of "everything" is "nothing".
      if (!inner) return sql`false`;
      return negate(inner);
    }
    default:
      throw new Error(`Unsupported logical operator "${operator}" in authorization condition`);
  }
}

function compileMembers(
  operator: string,
  operand: unknown,
  columns: ColumnMap,
): (SQL | undefined)[] {
  if (!Array.isArray(operand) || operand.length === 0) {
    throw new TypeError(`${operator} requires a non-empty array of conditions`);
  }
  return operand.map((member) => toSqlWhere(member, columns));
}

function compileField(field: string, value: unknown, columns: ColumnMap): SQL {
  // Own-property lookup: `columns['constructor']` must not resolve to Object's.
  const column = Object.hasOwn(columns, field) ? columns[field] : undefined;
  if (!column) {
    throw new Error(
      `Authorization condition references "${field}", which is not a mapped column. ` +
        'Conditions are flat: only columns of the subject\'s own table are allowed.',
    );
  }

  // `{ field: value }` is shorthand for `{ field: { $eq: value } }`.
  if (!isPlainObject(value)) return compileOperator(field, column, '$eq', value);

  const operators = Object.entries(value);
  if (operators.length === 0) {
    throw new TypeError(`Condition on "${field}" is an empty object`);
  }
  const compiled = operators.map(([operator, operand]) =>
    compileOperator(field, column, operator, operand),
  );
  // Non-empty by the check above, so `all` cannot return undefined here.
  return all(compiled) as SQL;
}

function compileOperator(field: string, column: AnyColumn, operator: string, operand: unknown): SQL {
  switch (operator) {
    case '$eq':
      return operand === null ? isNull(column) : eq(column, scalar(field, operator, operand));
    case '$ne':
      // `is distinct from` treats NULL as a value: a null column IS different from 1.
      return operand === null
        ? isNotNull(column)
        : sql`${column} is distinct from ${scalar(field, operator, operand)}`;
    case '$gt':
    case '$gte':
    case '$lt':
    case '$lte':
      return ordering(column, operator, comparable(field, operator, operand));
    case '$in': {
      const values = list(field, operator, operand);
      // Stated rather than left to the query builder: IN () is not valid SQL.
      return values.length === 0 ? sql`false` : inArray(column, values);
    }
    case '$nin': {
      const values = list(field, operator, operand);
      if (values.length === 0) return sql`true`;
      // A null column is "not in" any list in memory; `NOT IN` alone would yield NULL.
      return or(isNull(column), notInArray(column, values)) as SQL;
    }
    default:
      throw new Error(
        `Unsupported operator "${operator}" on "${field}" in authorization condition`,
      );
  }
}

const ORDERING = { $gt: gt, $gte: gte, $lt: lt, $lte: lte } as const;

/**
 * An ordering comparison that gives a NULL column the answer CASL gives it in memory.
 *
 * CASL does not skip a null (or missing) value: it compares with JavaScript's `>`,
 * which coerces null to 0. So null sorts BELOW 5, 'm' or any date after 1970 -- it
 * matches `$lt`/`$lte` and fails `$gt`/`$gte` -- and ABOVE a negative number or a
 * pre-1970 date, where it is the other way round. SQL would answer NULL (filtered out)
 * every time, so where memory says "match" the null branch is written out. A NOT NULL
 * column needs none.
 */
function ordering(
  column: AnyColumn,
  operator: keyof typeof ORDERING,
  operand: Exclude<Scalar, null>,
): SQL {
  const comparison = ORDERING[operator](column, operand);
  if (column.notNull) return comparison;

  const nullSortsAbove = 0 > Number(operand);
  const nullMatches = operator === '$gt' || operator === '$gte' ? nullSortsAbove : !nullSortsAbove;
  return nullMatches ? (or(isNull(column), comparison) as SQL) : comparison;
}

/** `NOT x`, except that an unknown (NULL) inner result counts as "did not match". */
export function negate(predicate: SQL): SQL {
  return sql`(${predicate}) is not true`;
}

function all(clauses: SQL[]): SQL | undefined {
  if (clauses.length === 0) return undefined;
  return clauses.length === 1 ? clauses[0] : and(...clauses);
}

function scalar(field: string, operator: string, operand: unknown): Exclude<Scalar, null> {
  if (
    typeof operand === 'string' ||
    typeof operand === 'number' ||
    typeof operand === 'boolean' ||
    operand instanceof Date
  ) {
    return operand;
  }
  throw new TypeError(
    `${operator} on "${field}" requires a scalar value, received ${describe(operand)}`,
  );
}

/**
 * An operand that can be ordered. `null` is refused because ordering against it is
 * meaningless, and a boolean because CASL's matcher throws on one -- compiling it would
 * make the SQL direction accept a rule the in-memory direction rejects.
 */
function comparable(field: string, operator: string, operand: unknown): string | number | Date {
  const value = scalar(field, operator, operand);
  if (typeof value === 'boolean') {
    throw new TypeError(`${operator} on "${field}" cannot order against a boolean`);
  }
  return value;
}

function list(field: string, operator: string, operand: unknown): Exclude<Scalar, null>[] {
  if (!Array.isArray(operand)) {
    throw new TypeError(`${operator} on "${field}" requires an array, received ${describe(operand)}`);
  }
  return operand.map((item) => scalar(field, operator, item));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return typeof value === 'object' ? 'an object' : typeof value;
}
