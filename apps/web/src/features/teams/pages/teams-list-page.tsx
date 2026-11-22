import type { TeamListQuery } from '@athlete/contracts';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { DataTable, dataTableColumns } from '@/components/data-table';
import { type TeamResponse, teamsListOptions } from '@/lib/api';
import { Can } from '@/lib/authz';
import { CreateTeamDialog } from '../components/create-team-dialog';

const column = dataTableColumns<TeamResponse>();

const columns = [
  column.accessor('name', {
    header: 'Name',
    cell: ({ row }) => (
      <Link
        to="/teams/$teamId"
        params={{ teamId: row.original.id }}
        className="font-medium underline-offset-4 hover:underline"
      >
        {row.original.name}
      </Link>
    ),
    meta: { sortKey: 'name' },
  }),
  column.accessor('sport', { header: 'Sport' }),
  column.accessor('ageGroup', {
    header: 'Age group',
    cell: ({ row }) => row.original.ageGroup ?? '—',
  }),
];

/**
 * The teams the signed-in user may see in the active academy: an administrator's whole
 * academy, a coach's own teams. That scoping is the API's.
 */
export function TeamsListPage({
  search,
  onSearchChange,
}: {
  /** The validated list state from the URL. */
  search: TeamListQuery;
  onSearchChange: (next: TeamListQuery) => void;
}) {
  const query = useQuery({
    ...teamsListOptions({ query: search }),
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
      onStateChange={(next) => onSearchChange(next as TeamListQuery)}
      getRowId={(team) => team.id}
      searchLabel="Search teams"
      emptyMessage="No teams yet."
      noun={query.data?.total === 1 ? 'team' : 'teams'}
      actions={
        <Can action="create" subject="teams">
          <CreateTeamDialog />
        </Can>
      }
    />
  );
}
