import { AthleteListQuery } from '@athlete/contracts';
import { createFileRoute, stripSearchParams } from '@tanstack/react-router';
import { AthletesListPage } from '@/features/athletes';
import { athletesListOptions } from '@/lib/api';
import { listSearch } from '@/lib/list-search';

const defaults = AthleteListQuery.parse({});

export const Route = createFileRoute('/_app/athletes/')({
  staticData: { title: 'Athletes' },
  // Page, page size, sort and search live in the URL, validated by the same schema the
  // API validates the query string with. Defaults are left out of the address bar.
  validateSearch: listSearch(AthleteListQuery),
  search: { middlewares: [stripSearchParams(defaults)] },
  loaderDeps: ({ search }) => search,
  // Started here, not awaited: the page shows its own loading state, and a slow list
  // must not hold up the navigation.
  loader: ({ context, deps }) => {
    void context.queryClient.prefetchQuery(athletesListOptions({ query: deps }));
  },
  component: AthletesRoute,
});

function AthletesRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <AthletesListPage
      search={search}
      onSearchChange={(next) => void navigate({ search: next, replace: true })}
    />
  );
}
