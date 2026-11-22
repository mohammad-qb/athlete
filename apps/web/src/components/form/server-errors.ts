import type { AnyFormApi } from '@tanstack/react-form';
import { toast } from 'sonner';

/**
 * Puts the server's validation messages on the form's own fields: the function to pass
 * as `setFieldErrors` to the error mapper.
 *
 *     onError: (error) => handleApiError(error, { setFieldErrors: serverFieldErrors(form) })
 *
 * The messages go in the field's `onSubmit` slot, which is the slot TanStack Form
 * clears when the field is next edited and overwrites on the next submit, so a server
 * message behaves exactly like a client one. A message for a field the form does not
 * render is shown as a toast instead of being dropped.
 */
export function serverFieldErrors(form: AnyFormApi): (fields: Record<string, string[]>) => void {
  return (fields) => {
    for (const [path, messages] of Object.entries(fields)) {
      const message = messages.join(' ');
      // `fieldInfo` is the form's record of the fields that have mounted.
      const mounted = (form.fieldInfo as Record<string, { instance: unknown } | undefined>)[path];
      if (!mounted?.instance) {
        toast.error(`${path}: ${message}`);
        continue;
      }
      form.setFieldMeta(path, (meta) => ({
        ...meta,
        isTouched: true,
        errorMap: { ...meta.errorMap, onSubmit: message },
      }));
    }
  };
}
