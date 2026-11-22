import { TeamListQuery } from '@athlete/contracts';
import { createFileRoute, stripSearchParams } from '@tanstack/react-router';
import { TeamsListPage } from '@/features/teams';
import { teamsListOptions } from '@/lib/api';
import { listSearch } from '@/lib/list-search';

const defaults = TeamListQuery.parse({});

export const Route = createFileRoute('/_app/teams/')({
  staticData: { title: 'Teams' },
  validateSearch: listSearch(TeamListQuery),
  search: { middlewares: [stripSearchParams(defaults)] },
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) => {
    void context.queryClient.prefetchQuery(teamsListOptions({ query: deps }));
  },
  component: TeamsRoute,
});

function TeamsRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <TeamsListPage
      search={search}
      onSearchChange={(next) => void navigate({ search: next, replace: true })}
    />
  );
}
