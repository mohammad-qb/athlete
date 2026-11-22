import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';
import { DataTable, dataTableColumns, type DataTableProps } from './data-table';
import type { ListState } from './list-state';

interface Person {
  id: string;
  lastName: string;
  firstName: string;
}

const column = dataTableColumns<Person>();
const columns = [
  column.accessor('lastName', { header: 'Last name', meta: { sortKey: 'lastName' } }),
  column.accessor('firstName', { header: 'First name', meta: { sortKey: 'firstName' } }),
  column.accessor('id', { header: 'Id' }),
];

const people: Person[] = [
  { id: '1', lastName: 'Falcon', firstName: 'Amal' },
  { id: '2', lastName: 'Oryx', firstName: 'Bilal' },
];

const initial: ListState = { page: 2, pageSize: 25, sort: 'lastName' };

function setup(overrides: Partial<DataTableProps<Person>> = {}) {
  const onStateChange = vi.fn<(next: ListState) => void>();
  const onRetry = vi.fn();
  const props: DataTableProps<Person> = {
    columns,
    page: { items: people, total: 60 },
    isLoading: false,
    error: null,
    onRetry,
    state: initial,
    onStateChange,
    getRowId: (person) => person.id,
    searchLabel: 'Search people',
    emptyMessage: 'No people yet.',
    noun: 'people',
    ...overrides,
  };
  render(<DataTable {...props} />);
  return { onStateChange, onRetry };
}

/** The table as a route uses it: state held outside, as the URL holds it. */
function Controlled({ onChange }: { onChange: (next: ListState) => void }) {
  const [state, setState] = useState<ListState>({ page: 1, pageSize: 25, sort: 'lastName' });
  return (
    <DataTable
      columns={columns}
      page={{ items: people, total: 60 }}
      isLoading={false}
      error={null}
      onRetry={() => {}}
      state={state}
      onStateChange={(next) => {
        onChange(next);
        setState(next);
      }}
      getRowId={(person) => person.id}
      searchLabel="Search people"
      emptyMessage="No people yet."
      noun="people"
    />
  );
}

describe('DataTable: reading the list state', () => {
  it('draws the page, the position and the total it is given', () => {
    setup();
    expect(screen.getAllByRole('row')).toHaveLength(1 + people.length);
    expect(screen.getByText('Falcon')).toBeInTheDocument();
    expect(screen.getByTestId('data-table-page')).toHaveTextContent('Page 2 of 3');
    expect(screen.getByTestId('data-table-total')).toHaveTextContent('60 people');
  });

  it('marks the sorted column and its direction', () => {
    setup({ state: { ...initial, sort: '-firstName' } });
    expect(screen.getByRole('columnheader', { name: 'First name' })).toHaveAttribute(
      'aria-sort',
      'descending',
    );
    expect(screen.getByRole('columnheader', { name: 'Last name' })).not.toHaveAttribute('aria-sort');
  });

  it('shows the search text from the state', () => {
    setup({ state: { ...initial, q: 'fal' } });
    expect(screen.getByRole('searchbox', { name: 'Search people' })).toHaveValue('fal');
  });

  it('offers no sort control on a column without a sort key', () => {
    setup();
    const header = screen.getByRole('columnheader', { name: 'Id' });
    expect(within(header).queryByRole('button')).not.toBeInTheDocument();
  });

  it('disables paging backwards on the first page and forwards on the last', () => {
    setup({ state: { ...initial, page: 3 } });
    expect(screen.getByRole('button', { name: 'Go to next page' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Go to last page' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Go to previous page' })).toBeEnabled();
  });
});

describe('DataTable: writing the list state', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('pages forwards and backwards, keeping sort and search', () => {
    const { onStateChange } = setup({ state: { ...initial, q: 'a' } });
    fireEvent.click(screen.getByRole('button', { name: 'Go to next page' }));
    expect(onStateChange).toHaveBeenLastCalledWith({ ...initial, q: 'a', page: 3 });
    fireEvent.click(screen.getByRole('button', { name: 'Go to previous page' }));
    expect(onStateChange).toHaveBeenLastCalledWith({ ...initial, q: 'a', page: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'Go to last page' }));
    expect(onStateChange).toHaveBeenLastCalledWith({ ...initial, q: 'a', page: 3 });
  });

  it('sorts by a column ascending and returns to page 1', () => {
    const { onStateChange } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'First name' }));
    expect(onStateChange).toHaveBeenLastCalledWith({ ...initial, sort: 'firstName', page: 1 });
  });

  it('flips the direction of the column that is already sorted', () => {
    const { onStateChange } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Last name' }));
    expect(onStateChange).toHaveBeenLastCalledWith({ ...initial, sort: '-lastName', page: 1 });
  });

  it('writes the search once typing pauses, trimmed, and returns to page 1', () => {
    const { onStateChange } = setup();
    const box = screen.getByRole('searchbox', { name: 'Search people' });
    fireEvent.change(box, { target: { value: 'f' } });
    fireEvent.change(box, { target: { value: 'fa' } });
    fireEvent.change(box, { target: { value: ' fal ' } });
    expect(onStateChange).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(onStateChange).toHaveBeenCalledOnce();
    expect(onStateChange).toHaveBeenLastCalledWith({ ...initial, q: 'fal', page: 1 });
  });

  it('removes the search from the state when the box is emptied', () => {
    const { onStateChange } = setup({ state: { ...initial, q: 'fal' } });
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search people' }), {
      target: { value: '' },
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(onStateChange).toHaveBeenLastCalledWith({ ...initial, q: undefined, page: 1 });
  });

  it('does not overwrite what is being typed when its own earlier search lands in the state', () => {
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);
    const box = screen.getByRole('searchbox', { name: 'Search people' });

    fireEvent.change(box, { target: { value: 'fa' } });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'fa' }));

    // The state now says "fa"; the person has already typed on.
    fireEvent.change(box, { target: { value: 'falc' } });
    expect(box).toHaveValue('falc');
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'falc' }));
    expect(box).toHaveValue('falc');
  });

  it('keeps a sort chosen while a typed search was still waiting', () => {
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search people' }), {
      target: { value: 'fal' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'First name' }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ sort: 'firstName' }));

    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(onChange).toHaveBeenLastCalledWith({
      page: 1,
      pageSize: 25,
      sort: 'firstName',
      q: 'fal',
    });
  });
});

describe('DataTable: a page past the end', () => {
  const pastTheEnd = { ...initial, page: 999 };

  it('moves to the last page once the answer says where the end is', () => {
    const { onStateChange } = setup({ page: { items: [], total: 60 }, state: pastTheEnd });
    expect(onStateChange).toHaveBeenCalledOnce();
    expect(onStateChange).toHaveBeenLastCalledWith({ ...initial, page: 3 });
  });

  it('moves to page 1 when nothing is left at all', () => {
    const { onStateChange } = setup({ page: { items: [], total: 0 }, state: pastTheEnd });
    expect(onStateChange).toHaveBeenLastCalledWith({ ...initial, page: 1 });
  });

  it('waits for the answer to its own page before deciding', () => {
    const loading = setup({ page: undefined, isLoading: true, state: pastTheEnd });
    expect(loading.onStateChange).not.toHaveBeenCalled();
    cleanup();

    // The previous page's rows, kept on screen while this page is fetched.
    const refreshing = setup({ isRefreshing: true, state: pastTheEnd });
    expect(refreshing.onStateChange).not.toHaveBeenCalled();
  });

  it('leaves a page inside the range alone', () => {
    const { onStateChange } = setup({ state: { ...initial, page: 3 } });
    expect(onStateChange).not.toHaveBeenCalled();
  });
});

describe('DataTable: loading, empty and failed', () => {
  it('shows placeholder rows, and no count, until the first page arrives', () => {
    setup({ page: undefined, isLoading: true });
    expect(screen.getAllByTestId('data-table-skeleton').length).toBeGreaterThan(0);
    expect(screen.queryByText('No people yet.')).not.toBeInTheDocument();
    expect(screen.getByRole('table')).toHaveAttribute('aria-busy', 'true');
  });

  it('says the list is empty', () => {
    setup({ page: { items: [], total: 0 }, state: { ...initial, page: 1 } });
    expect(screen.getByText('No people yet.')).toBeInTheDocument();
    expect(screen.getByTestId('data-table-page')).toHaveTextContent('Page 1 of 1');
  });

  it('says nothing matches, naming the search, when a search finds nothing', () => {
    setup({ page: { items: [], total: 0 }, state: { ...initial, page: 1, q: 'zzz' } });
    expect(screen.getByText('Nothing matches "zzz".')).toBeInTheDocument();
  });

  it('shows a failure in place of the rows, with a way to try again', () => {
    const { onRetry } = setup({
      page: undefined,
      error: new ApiError({ status: 0, type: 'UNKNOWN', message: 'Could not reach the server.' }),
    });
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Could not load this list.');
    expect(alert).toHaveTextContent('Could not reach the server.');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('explains a refusal without repeating the server text', () => {
    setup({
      page: undefined,
      error: new ApiError({ status: 403, type: 'FORBIDDEN', message: 'Cannot read athletes' }),
    });
    expect(screen.getByRole('alert')).toHaveTextContent(
      'You do not have access to this list in this academy.',
    );
  });
});
