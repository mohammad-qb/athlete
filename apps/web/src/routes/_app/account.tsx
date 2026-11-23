import { createFileRoute } from '@tanstack/react-router';
import { ChangePasswordPage } from '@/features/auth';

export const Route = createFileRoute('/_app/account')({
  staticData: { title: 'Account' },
  component: ChangePasswordPage,
});
