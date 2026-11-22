import type { ComponentProps } from 'react';
import { Button } from '@/components/ui/button';
import { useFormContext } from './form-context';

/** The form's submit button: disabled, and saying so, while a submission is in flight. */
export function SubmitButton({
  children,
  pendingLabel,
  ...button
}: { pendingLabel: string } & Omit<ComponentProps<typeof Button>, 'type'>) {
  const form = useFormContext();
  return (
    <form.Subscribe selector={(state) => state.isSubmitting}>
      {(isSubmitting) => (
        <Button {...button} type="submit" disabled={isSubmitting || button.disabled}>
          {isSubmitting ? pendingLabel : children}
        </Button>
      )}
    </form.Subscribe>
  );
}
