/**
 * A field's errors as text. A schema validator reports issue objects (`{ message }`),
 * the server's messages are applied as plain strings, and the same message can arrive
 * from more than one validation pass.
 */
export function errorMessages(errors: readonly unknown[]): string[] {
  const messages = errors.flatMap((error) => {
    if (typeof error === 'string') return [error];
    if (typeof error === 'object' && error !== null && 'message' in error) {
      return typeof error.message === 'string' ? [error.message] : [];
    }
    return [];
  });
  return [...new Set(messages)];
}
