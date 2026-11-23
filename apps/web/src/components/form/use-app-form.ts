import { createFormHook } from '@tanstack/react-form';
import { fieldContext, formContext } from './form-context';
import { SubmitButton } from './submit-button';
import { TextField } from './text-field';

/**
 * TanStack Form bound to the shadcn inputs, once. A form is
 *
 *     const form = useAppForm({ defaultValues, validators: { onSubmit: Schema }, onSubmit })
 *     <form.AppField name="email">{(field) => <field.TextField label="Email" />}</form.AppField>
 *     <form.AppForm><form.SubmitButton pendingLabel="Saving...">Save</form.SubmitButton></form.AppForm>
 *
 * where `Schema` is the request's Zod schema from `@athlete/contracts`: the form and
 * the API validate with the same object.
 */
export const { useAppForm } = createFormHook({
  fieldContext,
  formContext,
  fieldComponents: { TextField },
  formComponents: { SubmitButton },
});
