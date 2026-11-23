import { IconArrowLeft } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { FormAlert } from '@/components/form';
import { RecordError, RecordLoading } from '@/components/record-state';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  handleApiError,
  isApiError,
  loadFailureMessage,
  type SessionResponse,
  sessionsGetByIdOptions,
  sessionsRecordAttendanceMutation,
  sessionsRegisterOptions,
  teamsGetByIdOptions,
  teamsRosterOptions,
} from '@/lib/api';
import { useCan, useMe } from '@/lib/authz';
import { type DraftScope, markAthlete } from '@/lib/drafts';
import { PendingAttendanceRow, RecordedAttendanceRow } from '../components/attendance-row';
import { useAttendanceDraft } from '../hooks/use-attendance-draft';
import { buildRegister, mergeEntries, toAttendanceRequest, withoutRecorded } from '../register';
import { formatSessionTime } from '../session-requests';

function BackToSessions() {
  return (
    <Button variant="ghost" size="sm" className="-ms-2 justify-self-start" asChild>
      <Link to="/sessions">
        <IconArrowLeft className="rtl:rotate-180" />
        Sessions
      </Link>
    </Button>
  );
}

/** One session's attendance register: what it is, who is recorded, and who is still to mark. */
export function AttendancePage({ sessionId }: { sessionId: string }) {
  const me = useMe();
  const session = useQuery(sessionsGetByIdOptions({ path: { id: sessionId } }));

  if (session.isPending) return <RecordLoading />;
  if (session.isError) {
    return (
      <RecordError
        error={session.error}
        onRetry={() => void session.refetch()}
        back={<BackToSessions />}
      />
    );
  }

  const scope: DraftScope = {
    userId: me.user.id,
    academyId: me.activeAcademyId ?? 'none',
    sessionId,
  };
  return (
    <div className="grid gap-4 px-4 lg:px-6">
      <BackToSessions />
      <SessionSummary session={session.data} />
      {/* Keyed by whose draft it is: another person's or session's register starts from its own. */}
      <Register
        key={`${scope.userId}:${scope.academyId}:${scope.sessionId}`}
        session={session.data}
        scope={scope}
      />
    </div>
  );
}

function SessionSummary({ session }: { session: SessionResponse }) {
  const team = useQuery(teamsGetByIdOptions({ path: { id: session.teamId } }));
  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle data-testid="session-team">{team.data?.name ?? 'Session'}</CardTitle>
        <CardDescription>
          {session.location
            ? `${formatSessionTime(session)}, ${session.location}`
            : formatSessionTime(session)}
        </CardDescription>
      </CardHeader>
    </Card>
  );
}

/** Codes that mean "the register on screen is out of date", not "try again". */
const REGISTER_MOVED = new Set(['attendance_already_recorded', 'athlete_not_on_team']);

/**
 * Mark everyone, submit once.
 *
 * The register is the roster AS OF THE SESSION'S START (who was on the team then, not
 * who is on it today) less the athletes the API already holds an entry for. Marks are
 * kept in a draft on this device until the submission is confirmed, so a reload, a
 * dead spot or a failed request loses nothing, and whatever is sent again carries the
 * ids it was first given.
 */
function Register({ session, scope }: { session: SessionResponse; scope: DraftScope }) {
  const can = useCan();
  const queryClient = useQueryClient();
  const rosterOptions = teamsRosterOptions({
    path: { id: session.teamId },
    query: { at: session.startsAt },
  });
  const registerOptions = sessionsRegisterOptions({ path: { id: session.id } });
  const roster = useQuery(rosterOptions);
  const entries = useQuery(registerOptions);
  const submit = useMutation(sessionsRecordAttendanceMutation());
  const { draft, stored, update } = useAttendanceDraft(scope);
  const [failure, setFailure] = useState<string | null>(null);

  // A mark for someone the API now holds can never be sent again: it leaves the draft.
  // (A submission whose answer was lost, then a reload, ends here.)
  const recordedEntries = entries.data;
  useEffect(() => {
    if (recordedEntries) update((current) => {
      const next = withoutRecorded(current, recordedEntries);
      return Object.keys(next).length === Object.keys(current).length ? current : next;
    });
  }, [recordedEntries, update]);

  if (roster.isPending || entries.isPending) {
    return (
      <div className="grid max-w-2xl gap-2" data-testid="register-loading">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }
  if (roster.isError || entries.isError) {
    return (
      <div role="alert" className="grid max-w-2xl gap-2 text-sm">
        <p className="font-medium">Could not load the register.</p>
        <p className="text-muted-foreground">
          {loadFailureMessage(roster.error ?? entries.error)}
        </p>
        <Button
          variant="outline"
          size="sm"
          className="justify-self-start"
          onClick={() => {
            void roster.refetch();
            void entries.refetch();
          }}
        >
          Try again
        </Button>
      </div>
    );
  }

  const register = buildRegister(roster.data, entries.data, draft);
  const canRecord = can('create', 'sessionParticipants');
  const unmarked = register.pending.length - register.marked;

  async function onSubmit() {
    if (!register.complete || submit.isPending) return;
    setFailure(null);
    try {
      const answered = await submit.mutateAsync({
        path: { id: session.id },
        body: toAttendanceRequest(register.pending),
      });
      // The answer is put on screen first, and only then is the draft dropped: at no
      // point is a submitted athlete drawn as unmarked. The refetch that follows is a
      // check, not what the screen waits for.
      queryClient.setQueryData(registerOptions.queryKey, (existing) =>
        mergeEntries(existing, answered),
      );
      update(() => ({}));
      void queryClient.invalidateQueries({ queryKey: registerOptions.queryKey });
      toast.success('Register submitted.');
    } catch (error) {
      // The draft is untouched, so trying again sends the same ids: if this request
      // did reach the API, the next one stores nothing twice.
      if (isApiError(error) && error.code !== undefined && REGISTER_MOVED.has(error.code)) {
        // Someone else recorded part of it, or the roster changed: show what is true now.
        setFailure('This register changed while you were marking it. Check it and submit again.');
        void entries.refetch();
        void roster.refetch();
      } else {
        setFailure('Not submitted. Your marks are kept; try again.');
      }
      handleApiError(error);
    }
  }

  return (
    <>
      {register.pending.length > 0 && (
        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle>{canRecord ? 'To mark' : 'Not recorded'}</CardTitle>
            <CardDescription>
              {register.pending.length} {register.pending.length === 1 ? 'athlete' : 'athletes'}
            </CardDescription>
            {canRecord && unmarked > 0 && (
              <CardAction>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    update((current) =>
                      register.pending.reduce(
                        (next, row) =>
                          next[row.athleteId]?.status
                            ? next
                            : markAthlete(next, row.athleteId, { status: 'present' }),
                        current,
                      ),
                    )
                  }
                >
                  Mark rest present
                </Button>
              </CardAction>
            )}
          </CardHeader>
          <CardContent>
            {canRecord ? (
              <ul className="divide-y rounded-md border" aria-label="Athletes to mark">
                {register.pending.map((row) => (
                  <PendingAttendanceRow
                    key={row.athleteId}
                    row={row}
                    onChange={(change) =>
                      update((current) => markAthlete(current, row.athleteId, change))
                    }
                  />
                ))}
              </ul>
            ) : (
              <ul className="divide-y rounded-md border" aria-label="Athletes not recorded">
                {register.pending.map((row) => (
                  <li key={row.athleteId} className="px-3 py-2.5 text-sm font-medium">
                    {row.fullName}
                  </li>
                ))}
              </ul>
            )}
            {!stored && (
              <p className="mt-3 text-sm text-muted-foreground">
                This device cannot keep your marks. Stay on this page until you have submitted.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {register.recorded.length > 0 && (
        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle>Recorded</CardTitle>
            <CardDescription data-testid="recorded-summary">
              {register.recorded.length}{' '}
              {register.recorded.length === 1 ? 'athlete' : 'athletes'}
              {register.pending.length === 0 ? ', the whole register' : ''}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y rounded-md border" aria-label="Recorded attendance">
              {register.recorded.map((row) => (
                <RecordedAttendanceRow key={row.athleteId} row={row} />
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {register.pending.length === 0 && register.recorded.length === 0 && (
        <p className="max-w-2xl text-sm text-muted-foreground">
          Nobody was on this team when the session started, so there is no one to mark.
        </p>
      )}

      {canRecord && register.pending.length > 0 && (
        // Sticks to the bottom of the screen: on a phone the count and the button stay
        // under the thumb however long the roster is.
        <div className="sticky bottom-0 -mx-4 grid max-w-2xl gap-2 border-t bg-background px-4 py-3 sm:mx-0 sm:rounded-lg sm:border">
          <FormAlert message={failure} />
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground" data-testid="register-progress">
              {register.marked} of {register.pending.length} marked
            </p>
            <Button
              onClick={() => void onSubmit()}
              disabled={!register.complete || submit.isPending}
            >
              {submit.isPending ? 'Submitting...' : failure ? 'Try again' : 'Submit register'}
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
