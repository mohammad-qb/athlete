import { IconArrowLeft } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  loadFailureMessage,
  type RosterEntry,
  type TeamResponse,
  teamsGetByIdOptions,
  teamsRosterOptions,
} from '@/lib/api';
import { useCan } from '@/lib/authz';
import { endOfDay, formatDate } from '@/lib/dates';
import { AddMembershipDialog } from '../components/add-membership-dialog';
import { TransferDialog } from '../components/transfer-dialog';

function BackToTeams() {
  return (
    <Button variant="ghost" size="sm" className="-ms-2 justify-self-start" asChild>
      <Link to="/teams">
        <IconArrowLeft className="rtl:rotate-180" />
        Teams
      </Link>
    </Button>
  );
}

/** One team: what it is, and who is on it on a given day. */
export function TeamPage({
  teamId,
  on,
  onDateChange,
}: {
  teamId: string;
  /** The day the roster is shown for (`YYYY-MM-DD`, from the URL); absent means now. */
  on: string | undefined;
  onDateChange: (next: string | undefined) => void;
}) {
  const query = useQuery(teamsGetByIdOptions({ path: { id: teamId } }));

  if (query.isPending) return <RecordLoading />;
  if (query.isError) {
    return (
      <RecordError error={query.error} onRetry={() => void query.refetch()} back={<BackToTeams />} />
    );
  }
  const team = query.data;

  return (
    <div className="grid gap-4 px-4 lg:px-6">
      <BackToTeams />
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle data-testid="team-name">{team.name}</CardTitle>
          <CardDescription>
            {team.ageGroup ? `${team.sport}, ${team.ageGroup}` : team.sport}
          </CardDescription>
        </CardHeader>
      </Card>
      <Roster team={team} on={on} onDateChange={onDateChange} />
    </div>
  );
}

/**
 * The roster AS OF a day. Membership is a period, so the same team has a different
 * roster on different days, and the API answers for whichever instant it is asked
 * about. Athletes are added and transferred from the roster as it is now; a past day is
 * a record to read, not something to edit.
 */
function Roster({
  team,
  on,
  onDateChange,
}: {
  team: TeamResponse;
  on: string | undefined;
  onDateChange: (next: string | undefined) => void;
}) {
  const can = useCan();
  const [transferring, setTransferring] = useState<RosterEntry | null>(null);
  const roster = useQuery(
    teamsRosterOptions({
      path: { id: team.id },
      ...(on ? { query: { at: endOfDay(on) } } : {}),
    }),
  );
  const current = on === undefined;
  const canAdd = current && can('create', 'teamMemberships');
  const canTransfer = current && can('update', 'teamMemberships');

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>Roster</CardTitle>
        <CardDescription data-testid="roster-summary">
          {roster.data
            ? `${roster.data.length} ${roster.data.length === 1 ? 'athlete' : 'athletes'} ${
                on ? `on ${formatDate(on)}` : 'today'
              }`
            : ' '}
        </CardDescription>
        {canAdd && (
          <CardAction>
            <AddMembershipDialog team={team} />
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex flex-wrap items-end gap-2">
          <div className="grid gap-2">
            <Label htmlFor="roster-date">As of</Label>
            <Input
              id="roster-date"
              type="date"
              className="w-44"
              value={on ?? ''}
              onChange={(event) => onDateChange(event.target.value || undefined)}
            />
          </div>
          {on !== undefined && (
            <Button variant="outline" onClick={() => onDateChange(undefined)}>
              Today
            </Button>
          )}
        </div>

        {roster.isPending ? (
          <div className="grid gap-2" data-testid="roster-loading">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : roster.isError ? (
          <div role="alert" className="grid gap-2 text-sm">
            <p className="text-muted-foreground">{loadFailureMessage(roster.error)}</p>
            <Button
              variant="outline"
              size="sm"
              className="justify-self-start"
              onClick={() => void roster.refetch()}
            >
              Try again
            </Button>
          </div>
        ) : roster.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {on ? 'Nobody was on this team on that day.' : 'Nobody is on this team yet.'}
          </p>
        ) : (
          <ul className="divide-y rounded-md border" aria-label="Roster">
            {roster.data.map((entry) => (
              <li
                key={entry.athleteId}
                className="flex items-center justify-between gap-2 px-3 py-1.5 text-sm"
              >
                <Link
                  to="/athletes/$athleteId"
                  params={{ athleteId: entry.athleteId }}
                  className="min-w-0 truncate font-medium underline-offset-4 hover:underline"
                >
                  {entry.fullName}
                </Link>
                {canTransfer && (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Transfer ${entry.fullName}`}
                    onClick={() => setTransferring(entry)}
                  >
                    Transfer
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <TransferDialog team={team} entry={transferring} onClose={() => setTransferring(null)} />
    </Card>
  );
}
