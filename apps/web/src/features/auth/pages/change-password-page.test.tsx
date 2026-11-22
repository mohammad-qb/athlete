import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChangePasswordPage } from './change-password-page';

const changePassword = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth')>()),
  authClient: { changePassword },
}));
vi.mock('@/lib/authz', () => ({
  useMe: () => ({ user: { name: 'Alpha Admin', email: 'admin@alpha.test' } }),
}));
const toastSuccess = vi.hoisted(() => vi.fn());
vi.mock('sonner', () => ({ toast: { success: toastSuccess } }));

async function fillAndSubmit() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Current password'), 'the-old-password');
  await user.type(screen.getByLabelText('New password'), 'the-new-password');
  await user.type(screen.getByLabelText('Confirm new password'), 'the-new-password');
  await user.click(screen.getByRole('button', { name: 'Change password' }));
}

describe('ChangePasswordPage', () => {
  beforeEach(() => {
    changePassword.mockReset();
    toastSuccess.mockReset();
  });

  it('changes the password, signing out the other sessions, and empties the form', async () => {
    changePassword.mockResolvedValue({ data: {}, error: null });
    render(<ChangePasswordPage />);
    await fillAndSubmit();

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledOnce());
    expect(changePassword).toHaveBeenCalledWith({
      currentPassword: 'the-old-password',
      newPassword: 'the-new-password',
      revokeOtherSessions: true,
    });
    expect(screen.getByLabelText('Current password')).toHaveValue('');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('puts a wrong current password on its field, not in the alert', async () => {
    changePassword.mockResolvedValue({
      data: null,
      error: { status: 400, code: 'INVALID_PASSWORD', message: 'Invalid password' },
    });
    render(<ChangePasswordPage />);
    await fillAndSubmit();

    expect(await screen.findByText('That is not your current password.')).toBeInTheDocument();
    expect(screen.getByLabelText('Current password')).toHaveAttribute('aria-invalid', 'true');
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('says to wait when it is rate limited', async () => {
    changePassword.mockResolvedValue({ data: null, error: { status: 429, message: 'Too many requests' } });
    render(<ChangePasswordPage />);
    await fillAndSubmit();

    expect(await screen.findByRole('alert')).toHaveTextContent('Too many attempts');
  });

  it('says the server could not be reached when no response arrives, and keeps what was typed', async () => {
    changePassword.mockRejectedValue(new TypeError('Failed to fetch'));
    render(<ChangePasswordPage />);
    await fillAndSubmit();

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach the server.');
    expect(screen.getByLabelText('New password')).toHaveValue('the-new-password');
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});
