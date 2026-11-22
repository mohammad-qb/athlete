import { act, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';
import { type Conflict, ConflictDialog, conflictRows, useConflict } from './conflict-dialog';

const toastError = vi.hoisted(() => vi.fn());
vi.mock('sonner', () => ({ toast: { error: toastError } }));

interface Person {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  version: number;
}
type Field = 'firstName' | 'lastName' | 'dateOfBirth';

const LABELS: Record<Field, string> = {
  firstName: 'First name',
  lastName: 'Last name',
  dateOfBirth: 'Date of birth',
};

const loaded: Person = { firstName: 'Amal', lastName: 'Falcon', dateOfBirth: '2008-01-01', version: 3 };

/** They changed the last name; I changed the first name; nobody touched the date. */
const conflict: Conflict<Field, Person> = {
  loaded,
  mine: { firstName: 'Amala', lastName: 'Falcon', dateOfBirth: '2008-01-01' },
  current: { ...loaded, lastName: 'Hawk', version: 4 },
};

describe('conflictRows', () => {
  it('lists only the fields where the three versions are not all the same', () => {
    expect(conflictRows(conflict, LABELS)).toEqual([
      { field: 'firstName', label: 'First name', theirs: 'Amal', mine: 'Amala', changedByThem: false },
      { field: 'lastName', label: 'Last name', theirs: 'Hawk', mine: 'Falcon', changedByThem: true },
    ]);
  });

  it('shows a field both people changed, and prints values through the given format', () => {
    const both: Conflict<Field, Person> = {
      loaded,
      mine: { ...conflict.mine, dateOfBirth: '2008-02-02' },
      current: { ...loaded, dateOfBirth: '2008-03-03', version: 4 },
    };
    const rows = conflictRows(both, LABELS, { dateOfBirth: (value) => `on ${String(value)}` });
    expect(rows.find((row) => row.field === 'dateOfBirth')).toEqual({
      field: 'dateOfBirth',
      label: 'Date of birth',
      theirs: 'on 2008-03-03',
      mine: 'on 2008-02-02',
      changedByThem: true,
    });
  });

  it('ignores a field that has no label: it is not on the form', () => {
    expect(conflictRows(conflict, LABELS).map((row) => row.field)).not.toContain('version');
  });
});

describe('ConflictDialog', () => {
  function renderDialog(handlers: {
    onKeepMine?: (conflict: Conflict<Field, Person>) => Promise<void> | void;
    onTakeTheirs?: (conflict: Conflict<Field, Person>) => void;
    onDismiss?: () => void;
  }) {
    return render(
      <ConflictDialog
        conflict={conflict}
        labels={LABELS}
        noun="athlete"
        onKeepMine={handlers.onKeepMine ?? vi.fn()}
        onTakeTheirs={handlers.onTakeTheirs ?? vi.fn()}
        onDismiss={handlers.onDismiss ?? vi.fn()}
      />,
    );
  }

  it('renders nothing while there is no conflict', () => {
    render(
      <ConflictDialog
        conflict={null}
        labels={LABELS}
        noun="athlete"
        onKeepMine={vi.fn()}
        onTakeTheirs={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows their value beside mine for the disputed fields only', () => {
    renderDialog({});
    const dialog = screen.getByRole('dialog', { name: 'Someone else changed this athlete' });
    const lastName = within(dialog).getByTestId('conflict-lastName');
    expect(within(lastName).getByTestId('conflict-theirs')).toHaveTextContent('Hawk');
    expect(within(lastName).getByTestId('conflict-mine')).toHaveTextContent('Falcon');
    expect(within(lastName).getByText('Theirs (changed)')).toBeInTheDocument();
    expect(within(dialog).getByTestId('conflict-firstName')).toBeInTheDocument();
    expect(within(dialog).queryByTestId('conflict-dateOfBirth')).not.toBeInTheDocument();
  });

  it('"Keep mine" hands the conflict back, and holds both buttons until the save settles', async () => {
    let settle!: () => void;
    const onKeepMine = vi.fn(() => new Promise<void>((resolve) => (settle = resolve)));
    const onTakeTheirs = vi.fn();
    renderDialog({ onKeepMine, onTakeTheirs });

    await userEvent.click(screen.getByRole('button', { name: 'Keep mine' }));
    expect(onKeepMine).toHaveBeenCalledExactlyOnceWith(conflict);
    expect(screen.getByRole('button', { name: 'Saving...' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Take theirs' })).toBeDisabled();

    await act(async () => {
      settle();
      await Promise.resolve();
    });
    expect(screen.getByRole('button', { name: 'Keep mine' })).toBeEnabled();
    expect(onTakeTheirs).not.toHaveBeenCalled();
  });

  it('"Take theirs" hands the conflict back without saving', async () => {
    const onKeepMine = vi.fn();
    const onTakeTheirs = vi.fn();
    renderDialog({ onKeepMine, onTakeTheirs });

    await userEvent.click(screen.getByRole('button', { name: 'Take theirs' }));
    expect(onTakeTheirs).toHaveBeenCalledExactlyOnceWith(conflict);
    expect(onKeepMine).not.toHaveBeenCalled();
  });

  it('closing it does neither', async () => {
    const onKeepMine = vi.fn();
    const onTakeTheirs = vi.fn();
    const onDismiss = vi.fn();
    renderDialog({ onKeepMine, onTakeTheirs, onDismiss });

    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onDismiss).toHaveBeenCalledOnce();
    expect(onKeepMine).not.toHaveBeenCalled();
    expect(onTakeTheirs).not.toHaveBeenCalled();
  });
});

describe('useConflict', () => {
  it('fetches the stored record and only then holds a conflict', async () => {
    const fetchCurrent = vi.fn().mockResolvedValue(conflict.current);
    const { result } = renderHook(() => useConflict<Field, Person>(fetchCurrent));
    expect(result.current.conflict).toBeNull();

    await act(() => result.current.open(loaded, conflict.mine));
    expect(fetchCurrent).toHaveBeenCalledOnce();
    expect(result.current.conflict).toEqual(conflict);

    act(() => result.current.close());
    expect(result.current.conflict).toBeNull();
  });

  it('sends a failed fetch through the error mapper and opens nothing', async () => {
    const fetchCurrent = vi
      .fn()
      .mockRejectedValue(new ApiError({ status: 404, type: 'NOT_FOUND', message: 'gone' }));
    const { result } = renderHook(() => useConflict<Field, Person>(fetchCurrent));

    await act(() => result.current.open(loaded, conflict.mine));
    await waitFor(() => expect(toastError).toHaveBeenCalledOnce());
    expect(result.current.conflict).toBeNull();
  });
});
