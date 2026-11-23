import { SessionListQuery } from '@athlete/contracts';
import { createFileRoute, stripSearchParams } from '@tanstack/react-router';
import { z } from 'zod';
import { SessionsListPage, sessionsQuery } from '@/features/sessions';
import { sessionsListOptions } from '@/lib/api';
import { listSearch } from '@/lib/list-search';

/**
 * Page, page size and sort are the list contract's own, validated by its schema. `show`
 * is this screen's: the default view is what a coach opens the app for (what is coming
 * up, and the last two weeks), and `all` drops the bound. The bound itself is not in
 * the URL: "recent" in a link opened next month should mean recent then.
 */
const SessionsSearch = SessionListQuery.pick({ page: true, pageSize: true, sort: true }).extend({
  show: z.enum(['recent', 'all']).default('recent'),
});

const defaults = SessionsSearch.parse({});

export const Route = createFileRoute('/_app/sessions/')({
  staticData: { title: 'Sessions' },
  validateSearch: listSearch(SessionsSearch),
  search: { middlewares: [stripSearchParams(defaults)] },
  loaderDeps: ({ search }) => search,
  // Started here, not awaited: the page shows its own loading state.
  loader: ({ context, deps }) => {
    void context.queryClient.prefetchQuery(sessionsListOptions({ query: sessionsQuery(deps) }));
  },
  component: SessionsRoute,
});

function SessionsRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <SessionsListPage
      search={search}
      onSearchChange={(next) => void navigate({ search: next, replace: true })}
    />
  );
}
