import { useState } from 'react';
import { toast } from 'sonner';
import { FormAlert, useAppForm } from '@/components/form';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { authClient, authFailureOf } from '@/lib/auth';
import { useMe } from '@/lib/authz';
import { ChangePasswordForm } from '../sign-in-schema';

/**
 * The account page: who is signed in, and changing their password. Changing it signs
 * out every OTHER session of the account, which is what someone who suspects their
 * password is known wants to happen.
 */
export function ChangePasswordPage() {
  const { user } = useMe();
  const [failure, setFailure] = useState<string | null>(null);

  const form = useAppForm({
    defaultValues: {
      currentPassword: '',
      newPassword: '',
      confirmPassword: '',
    } satisfies ChangePasswordForm,
    validators: { onSubmit: ChangePasswordForm },
    onSubmit: async ({ value, formApi }) => {
      setFailure(null);
      const failed = await authFailureOf(
        authClient.changePassword({
          currentPassword: value.currentPassword,
          newPassword: value.newPassword,
          revokeOtherSessions: true,
        }),
      );
      if (failed) {
        if (failed.code === 'INVALID_PASSWORD') {
          formApi.setFieldMeta('currentPassword', (meta) => ({
            ...meta,
            errorMap: { ...meta.errorMap, onSubmit: 'That is not your current password.' },
          }));
        } else {
          setFailure(
            failed.status === 429 ? 'Too many attempts. Wait a moment and try again.' : failed.message,
          );
        }
        return;
      }
      formApi.reset();
      toast.success('Password changed. Other devices have been signed out.');
    },
  });

  return (
    <div className="px-4 lg:px-6">
      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>Change password</CardTitle>
          <CardDescription>
            Signed in as {user.name} ({user.email}).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            noValidate
            className="grid gap-6"
            onSubmit={(event) => {
              event.preventDefault();
              void form.handleSubmit();
            }}
          >
            <FormAlert message={failure} />
            {/* For password managers: which account these passwords belong to. */}
            <input type="text" name="username" autoComplete="username" value={user.email} readOnly hidden />
            <form.AppField name="currentPassword">
              {(field) => (
                <field.TextField
                  label="Current password"
                  type="password"
                  autoComplete="current-password"
                />
              )}
            </form.AppField>
            <form.AppField name="newPassword">
              {(field) => (
                <field.TextField
                  label="New password"
                  type="password"
                  autoComplete="new-password"
                  description="At least 8 characters."
                />
              )}
            </form.AppField>
            <form.AppField name="confirmPassword">
              {(field) => (
                <field.TextField
                  label="Confirm new password"
                  type="password"
                  autoComplete="new-password"
                />
              )}
            </form.AppField>
            <form.AppForm>
              <form.SubmitButton className="justify-self-start" pendingLabel="Saving...">
                Change password
              </form.SubmitButton>
            </form.AppForm>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
