import type { AthleteListQuery } from '@athlete/contracts';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { DataTable, dataTableColumns } from '@/components/data-table';
import { type AthleteResponse, athletesListOptions } from '@/lib/api';

const column = dataTableColumns<AthleteResponse>();

const dateFormat = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' });

/** A calendar date (`YYYY-MM-DD`) has no time zone; format it as the day it names. */
function formatDate(date: string): string {
  const parsed = new Date(date.length === 10 ? `${date}T00:00:00Z` : date);
  return Number.isNaN(parsed.getTime()) ? date : dateFormat.format(parsed);
}

const columns = [
  column.accessor('lastName', {
    header: 'Last name',
    cell: ({ row }) => <span className="font-medium">{row.original.lastName}</span>,
    meta: { sortKey: 'lastName' },
  }),
  column.accessor('firstName', {
    header: 'First name',
    meta: { sortKey: 'firstName' },
  }),
  column.accessor('dateOfBirth', {
    header: 'Date of birth',
    cell: ({ row }) => formatDate(row.original.dateOfBirth),
    meta: { sortKey: 'dateOfBirth' },
  }),
  column.accessor('createdAt', {
    header: 'Added',
    cell: ({ row }) => formatDate(row.original.createdAt),
    meta: { sortKey: 'createdAt', className: 'hidden md:table-cell' },
  }),
];

/**
 * The athletes the signed-in user may see in the active academy: an administrator's
 * whole academy, a coach's own teams. That scoping is the API's; this page asks for a
 * page and draws it.
 */
export function AthletesListPage({
  search,
  onSearchChange,
}: {
  /** The validated list state from the URL. */
  search: AthleteListQuery;
  onSearchChange: (next: AthleteListQuery) => void;
}) {
  const query = useQuery({
    ...athletesListOptions({ query: search }),
    placeholderData: keepPreviousData,
  });

  return (
    <DataTable
      columns={columns}
      page={query.data}
      isLoading={query.isPending}
      isRefreshing={query.isPlaceholderData}
      error={query.error}
      onRetry={() => void query.refetch()}
      state={search}
      onStateChange={(next) => onSearchChange(next as AthleteListQuery)}
      getRowId={(athlete) => athlete.id}
      searchLabel="Search athletes"
      emptyMessage="No athletes yet."
      noun={query.data?.total === 1 ? 'athlete' : 'athletes'}
    />
  );
}
