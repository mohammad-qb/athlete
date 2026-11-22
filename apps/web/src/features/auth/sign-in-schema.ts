import { z } from 'zod';

/**
 * What the sign-in form checks before asking the server. Deliberately loose on the
 * password: its rules belong to whoever set it, and telling a stranger the minimum
 * length here would only describe the lock.
 */
export const SignInForm = z.object({
  email: z.email('Enter your email address.'),
  password: z.string().min(1, 'Enter your password.'),
});
export type SignInForm = z.infer<typeof SignInForm>;

/** better-auth's own limits: 8 to 128 characters. */
export const ChangePasswordForm = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password.'),
    newPassword: z
      .string()
      .min(8, 'Use at least 8 characters.')
      .max(128, 'Use at most 128 characters.'),
    confirmPassword: z.string(),
  })
  .refine((value) => value.newPassword === value.confirmPassword, {
    path: ['confirmPassword'],
    message: 'The two passwords do not match.',
  })
  .refine((value) => value.newPassword !== value.currentPassword, {
    path: ['newPassword'],
    message: 'Choose a password different from the current one.',
  });
export type ChangePasswordForm = z.infer<typeof ChangePasswordForm>;
