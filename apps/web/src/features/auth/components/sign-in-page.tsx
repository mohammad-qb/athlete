import { IconInnerShadowTop } from '@tabler/icons-react';
import { useState } from 'react';
import { FormAlert, useAppForm } from '@/components/form';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { type AuthFailure, authClient, authFailureOf } from '@/lib/auth';
import { SignInForm } from '../sign-in-schema';

function messageFor(failure: AuthFailure): string {
  if (failure.status === 429) return 'Too many attempts. Wait a few seconds and try again.';
  // One message for "no such account" and "wrong password": which of the two it was
  // is not something to tell whoever is typing.
  if (failure.status === 401) return 'Email or password is incorrect.';
  if (failure.status === 0 || failure.status >= 500) {
    return 'Could not reach the server. Try again in a moment.';
  }
  return failure.message;
}

/**
 * Sign in with email and password. There is no sign-up and no "forgot password" here:
 * accounts are created by an operator (ADR 0006).
 */
export function SignInPage({ onSignedIn }: { onSignedIn: () => void | Promise<void> }) {
  const [failure, setFailure] = useState<string | null>(null);

  const form = useAppForm({
    defaultValues: { email: '', password: '' } satisfies SignInForm,
    validators: { onSubmit: SignInForm },
    onSubmit: async ({ value }) => {
      setFailure(null);
      const failed = await authFailureOf(
        authClient.signIn.email({ email: value.email, password: value.password }),
      );
      if (failed) {
        setFailure(messageFor(failed));
        return;
      }
      await onSignedIn();
    },
  });

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted p-6 md:p-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex items-center gap-2 self-center font-medium">
          <div className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <IconInnerShadowTop className="size-4" />
          </div>
          Athlete Platform
        </div>
        <Card>
          <CardHeader className="text-center">
            <CardTitle className="text-xl">Sign in</CardTitle>
            <CardDescription>Use the email and password your academy gave you.</CardDescription>
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
              <form.AppField name="email">
                {(field) => (
                  <field.TextField label="Email" type="email" autoComplete="username" autoFocus />
                )}
              </form.AppField>
              <form.AppField name="password">
                {(field) => (
                  <field.TextField label="Password" type="password" autoComplete="current-password" />
                )}
              </form.AppField>
              <form.AppForm>
                <form.SubmitButton className="w-full" pendingLabel="Signing in...">
                  Sign in
                </form.SubmitButton>
              </form.AppForm>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
