import { createFileRoute } from '@tanstack/react-router';
import { AttendancePage } from '@/features/sessions';
import { sessionsGetByIdOptions, sessionsRegisterOptions } from '@/lib/api';

export const Route = createFileRoute('/_app/sessions/$sessionId/attendance')({
  staticData: { title: 'Attendance' },
  // Started, not awaited: the page draws its own loading and not-found states. The
  // roster is asked for by the page, once the session says which team and when.
  loader: ({ context, params }) => {
    const path = { id: params.sessionId };
    void context.queryClient.prefetchQuery(sessionsGetByIdOptions({ path }));
    void context.queryClient.prefetchQuery(sessionsRegisterOptions({ path }));
  },
  component: AttendanceRoute,
});

function AttendanceRoute() {
  const { sessionId } = Route.useParams();
  return <AttendancePage key={sessionId} sessionId={sessionId} />;
}
