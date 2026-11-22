import type { z } from 'zod';

/** A Zod issue as a sentence for the person filling the form in. */
function messageOf(issue: z.core.$ZodIssue, value: unknown): string {
  // Whatever the schema objects to about an empty box, the person's problem is the same.
  if (value === '' || value === null || value === undefined) return 'Required.';
  if (issue.code === 'too_big' && issue.origin === 'string') {
    return `Use at most ${String(issue.maximum)} characters.`;
  }
  if (issue.code === 'too_small' && issue.origin === 'string') {
    return `Use at least ${String(issue.minimum)} characters.`;
  }
  return issue.message;
}

function valueAt(root: unknown, path: readonly PropertyKey[]): unknown {
  let current = root;
  for (const key of path) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Record<PropertyKey, unknown>)[key];
  }
  return current;
}

/**
 * A form's `onSubmit` validator that checks the REQUEST the form is about to send
 * against the request's own contract schema:
 *
 *     validators: { onSubmit: requestValidator(CreateTeamRequest, toRequest) }
 *
 * `toRequest` is the same function the submit handler uses to build the body, so what
 * is validated is exactly what is sent, with the schema the API validates it with. It
 * exists because a form's values are not always the request's shape: an empty text box
 * is `''` where the request says `null`, a date input is a day where the request wants
 * an instant. Issues land on the form field of the same name as the request field;
 * `fieldOf` names the form field for a request field that is called something else
 * (`{ athleteId: 'athlete' }`, where the form holds the chosen athlete and not an id).
 */
export function requestValidator<Values>(
  schema: z.ZodType,
  toRequest: (values: Values) => unknown = (values) => values,
  fieldOf: Record<string, string> = {},
) {
  return ({ value }: { value: Values }) => {
    const request = toRequest(value);
    const result = schema.safeParse(request);
    if (result.success) return undefined;

    const fields: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const path = issue.path.join('.');
      fields[fieldOf[path] ?? path] ??= messageOf(issue, valueAt(request, issue.path));
    }
    return { fields };
  };
}
