import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { TeamPage } from '@/features/teams';
import { teamsGetByIdOptions } from '@/lib/api';

const TeamSearch = z.object({
  /** The day the roster is shown for. Absent, or anything that is not a date: today. */
  on: z.iso.date().optional().catch(undefined),
});

export const Route = createFileRoute('/_app/teams/$teamId')({
  staticData: { title: 'Team' },
  validateSearch: TeamSearch,
  loader: ({ context, params }) => {
    void context.queryClient.prefetchQuery(teamsGetByIdOptions({ path: { id: params.teamId } }));
  },
  component: TeamRoute,
});

function TeamRoute() {
  const { teamId } = Route.useParams();
  const { on } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <TeamPage
      key={teamId}
      teamId={teamId}
      on={on}
      onDateChange={(next) => void navigate({ search: { on: next }, replace: true })}
    />
  );
}
