import type { AthleteListQuery } from '@athlete/contracts';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { DataTable, dataTableColumns } from '@/components/data-table';
import { type AthleteResponse, athletesListOptions } from '@/lib/api';
import { Can } from '@/lib/authz';
import { formatDate } from '@/lib/dates';
import { CreateAthleteDialog } from '../components/create-athlete-dialog';

const column = dataTableColumns<AthleteResponse>();

const columns = [
  column.accessor('lastName', {
    header: 'Last name',
    cell: ({ row }) => (
      <Link
        to="/athletes/$athleteId"
        params={{ athleteId: row.original.id }}
        className="font-medium underline-offset-4 hover:underline"
      >
        {row.original.lastName}
      </Link>
    ),
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
      actions={
        <Can action="create" subject="athletes">
          <CreateAthleteDialog />
        </Can>
      }
    />
  );
}
