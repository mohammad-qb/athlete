import type { ComponentProps } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { errorMessages } from './error-messages';
import { useFieldContext } from './form-context';

/**
 * A labelled text input bound to a TanStack Form field: value, blur, the invalid state
 * and the error text, from client validation and from the server alike.
 *
 * Errors show once the field has been touched or the form submitted, never while the
 * person is still typing their first attempt.
 */
export function TextField({
  label,
  description,
  ...input
}: { label: string; description?: string } & Omit<
  ComponentProps<typeof Input>,
  'value' | 'onChange' | 'onBlur' | 'name' | 'id'
>) {
  const field = useFieldContext<string>();
  const messages = errorMessages(field.state.meta.errors);
  const invalid = messages.length > 0 && field.state.meta.isTouched;
  const id = `field-${field.name}`;
  const hintId = `${id}-hint`;

  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        {...input}
        id={id}
        name={field.name}
        value={field.state.value}
        onChange={(event) => field.handleChange(event.target.value)}
        onBlur={field.handleBlur}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid || description ? hintId : undefined}
      />
      {invalid ? (
        <p id={hintId} role="alert" className="text-sm text-destructive">
          {messages.join(' ')}
        </p>
      ) : description ? (
        <p id={hintId} className="text-sm text-muted-foreground">
          {description}
        </p>
      ) : null}
    </div>
  );
}
