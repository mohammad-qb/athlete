import { createFileRoute } from '@tanstack/react-router';
import { AthletePage } from '@/features/athletes';
import { athletesGetByIdOptions } from '@/lib/api';

export const Route = createFileRoute('/_app/athletes/$athleteId')({
  staticData: { title: 'Athlete' },
  // Started, not awaited: the page draws its own loading and not-found states.
  loader: ({ context, params }) => {
    void context.queryClient.prefetchQuery(
      athletesGetByIdOptions({ path: { id: params.athleteId } }),
    );
  },
  component: AthleteRoute,
});

function AthleteRoute() {
  const { athleteId } = Route.useParams();
  // Keyed by the id: another athlete is another form, not this one with new values.
  return <AthletePage key={athleteId} athleteId={athleteId} />;
}
