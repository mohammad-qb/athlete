import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { DataTable, dataTableColumns } from '@/components/data-table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { type SessionResponse, sessionsListOptions, teamsGetByIdOptions } from '@/lib/api';
import { Can } from '@/lib/authz';
import { CreateSessionDialog } from '../components/create-session-dialog';
import {
  formatSessionTime,
  RECENT_DAYS,
  sessionsQuery,
  type SessionsSearch,
} from '../session-requests';

const column = dataTableColumns<SessionResponse>();

/**
 * A session carries its team's id, not its name, so each row asks for its team. The
 * query cache makes that one request per distinct team on the page, however many rows
 * share it, and it holds for any number of teams in the academy. Empty until it
 * arrives, and for a team this person may not read.
 */
function TeamName({ teamId, fallback = '' }: { teamId: string; fallback?: string }) {
  const team = useQuery(teamsGetByIdOptions({ path: { id: teamId } }));
  return <>{team.data?.name ?? fallback}</>;
}

const columns = [
  column.accessor('startsAt', {
    header: 'When',
    cell: ({ row }) => (
      <div className="grid gap-0.5">
        <Link
          to="/sessions/$sessionId/attendance"
          params={{ sessionId: row.original.id }}
          className="font-medium underline-offset-4 hover:underline"
        >
          {formatSessionTime(row.original)}
        </Link>
        {/* At phone width the team has no column of its own. */}
        <span className="text-muted-foreground sm:hidden">
          <TeamName teamId={row.original.teamId} />
        </span>
      </div>
    ),
    meta: { sortKey: 'startsAt' },
  }),
  column.accessor('teamId', {
    header: 'Team',
    cell: ({ row }) => <TeamName teamId={row.original.teamId} fallback="—" />,
    meta: { className: 'hidden sm:table-cell' },
  }),
  column.accessor('location', {
    header: 'Location',
    cell: ({ row }) => row.original.location ?? '—',
    meta: { className: 'hidden md:table-cell' },
  }),
];

/**
 * The sessions the signed-in user may see in the active academy: an administrator's
 * whole academy, a coach's own teams. That scoping is the API's. Each row opens the
 * session's attendance register.
 */
export function SessionsListPage({
  search,
  onSearchChange,
}: {
  /** The validated list state from the URL. */
  search: SessionsSearch;
  onSearchChange: (next: SessionsSearch) => void;
}) {
  const query = useQuery({
    ...sessionsListOptions({ query: sessionsQuery(search) }),
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
      onStateChange={(next) =>
        onSearchChange({
          ...search,
          page: next.page,
          pageSize: next.pageSize,
          sort: next.sort as SessionsSearch['sort'],
        })
      }
      getRowId={(session) => session.id}
      emptyMessage={
        search.show === 'recent'
          ? `No sessions in the last ${RECENT_DAYS} days, and none coming up.`
          : 'No sessions yet.'
      }
      noun={query.data?.total === 1 ? 'session' : 'sessions'}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={search.show}
            onValueChange={(show) =>
              onSearchChange({ ...search, show: show as SessionsSearch['show'], page: 1 })
            }
          >
            <SelectTrigger size="sm" className="w-48" aria-label="Which sessions to show">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="recent">Upcoming and recent</SelectItem>
              <SelectItem value="all">All sessions</SelectItem>
            </SelectContent>
          </Select>
          <Can action="create" subject="trainingSessions">
            <CreateSessionDialog />
          </Can>
        </div>
      }
    />
  );
}
