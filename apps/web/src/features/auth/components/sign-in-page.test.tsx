import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SignInPage } from './sign-in-page';

const signInEmail = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth')>()),
  authClient: { signIn: { email: signInEmail } },
}));

async function fillAndSubmit(email: string, password: string) {
  const user = userEvent.setup();
  if (email) await user.type(screen.getByLabelText('Email'), email);
  if (password) await user.type(screen.getByLabelText('Password'), password);
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('SignInPage', () => {
  const onSignedIn = vi.fn();

  beforeEach(() => {
    signInEmail.mockReset();
    onSignedIn.mockReset();
  });

  it('asks for both fields and sends nothing when the form is empty', async () => {
    render(<SignInPage onSignedIn={onSignedIn} />);
    await fillAndSubmit('', '');

    expect(await screen.findByText('Enter your email address.')).toBeInTheDocument();
    expect(screen.getByText('Enter your password.')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    expect(signInEmail).not.toHaveBeenCalled();
  });

  it('refuses something that is not an email address before sending it', async () => {
    render(<SignInPage onSignedIn={onSignedIn} />);
    await fillAndSubmit('not-an-email', 'a-password');

    expect(await screen.findByText('Enter your email address.')).toBeInTheDocument();
    expect(signInEmail).not.toHaveBeenCalled();
  });

  it('clears a field error once the field is corrected', async () => {
    render(<SignInPage onSignedIn={onSignedIn} />);
    await fillAndSubmit('', 'a-password');
    expect(await screen.findByText('Enter your email address.')).toBeInTheDocument();

    await userEvent.setup().type(screen.getByLabelText('Email'), 'admin@alpha.test');
    await waitFor(() =>
      expect(screen.queryByText('Enter your email address.')).not.toBeInTheDocument(),
    );
  });

  it('signs in with what was typed and reports success to the route', async () => {
    signInEmail.mockResolvedValue({ data: { user: {} }, error: null });
    render(<SignInPage onSignedIn={onSignedIn} />);
    await fillAndSubmit('admin@alpha.test', 'the-password');

    await waitFor(() => expect(onSignedIn).toHaveBeenCalledOnce());
    expect(signInEmail).toHaveBeenCalledWith({
      email: 'admin@alpha.test',
      password: 'the-password',
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows one message for a refused sign-in, whichever part was wrong', async () => {
    signInEmail.mockResolvedValue({
      data: null,
      error: { status: 401, code: 'INVALID_EMAIL_OR_PASSWORD', message: 'Invalid email or password' },
    });
    render(<SignInPage onSignedIn={onSignedIn} />);
    await fillAndSubmit('admin@alpha.test', 'wrong');

    expect(await screen.findByRole('alert')).toHaveTextContent('Email or password is incorrect.');
    expect(onSignedIn).not.toHaveBeenCalled();
    // The form stays filled, so the person can correct the password and try again.
    expect(screen.getByLabelText('Email')).toHaveValue('admin@alpha.test');
  });

  it('says to wait when sign-in is rate limited', async () => {
    signInEmail.mockResolvedValue({ data: null, error: { status: 429, message: 'Too many requests' } });
    render(<SignInPage onSignedIn={onSignedIn} />);
    await fillAndSubmit('admin@alpha.test', 'the-password');

    expect(await screen.findByRole('alert')).toHaveTextContent('Too many attempts');
  });

  it('says the server could not be reached when no response arrives', async () => {
    signInEmail.mockRejectedValue(new TypeError('Failed to fetch'));
    render(<SignInPage onSignedIn={onSignedIn} />);
    await fillAndSubmit('admin@alpha.test', 'the-password');

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach the server.');
    expect(onSignedIn).not.toHaveBeenCalled();
  });
});
