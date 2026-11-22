import { TransferAthleteRequest } from '@athlete/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { errorMessages, requestValidator, serverFieldErrors, useAppForm } from '@/components/form';
import { TeamPicker } from '@/components/pickers';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  athletesListQueryKey,
  handleApiError,
  type RosterEntry,
  type TeamResponse,
  teamsRosterQueryKey,
  teamsTransferMutation,
} from '@/lib/api';
import { today } from '@/lib/dates';
import { toTransferRequest, type TransferValues } from '../team-requests';

/**
 * Moving an athlete from this team to another. Nothing is overwritten: the membership
 * here is closed on the chosen day and a new one opens in the other team, so past
 * rosters and registers keep saying what was true then.
 */
export function TransferDialog({
  team,
  entry,
  onClose,
}: {
  team: TeamResponse;
  /** The athlete being moved; `null` keeps the dialog closed. */
  entry: RosterEntry | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={entry !== null} onOpenChange={(open) => !open && onClose()}>
      {entry && (
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Transfer {entry.fullName}</DialogTitle>
            <DialogDescription>
              They leave {team.name} and join the other team on the same day. Their history
              with {team.name} is kept.
            </DialogDescription>
          </DialogHeader>
          <TransferForm team={team} entry={entry} onDone={onClose} />
        </DialogContent>
      )}
    </Dialog>
  );
}

function TransferForm({
  team,
  entry,
  onDone,
}: {
  team: TeamResponse;
  entry: RosterEntry;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const transfer = useMutation(teamsTransferMutation());
  const move = { athleteId: entry.athleteId, fromTeamId: team.id };

  const initial: TransferValues = { toTeam: null, effectiveAt: today() };

  const form = useAppForm({
    defaultValues: initial,
    validators: {
      onSubmit: requestValidator<TransferValues>(
        TransferAthleteRequest,
        (values) => toTransferRequest(values, move),
        { toTeamId: 'toTeam' },
      ),
    },
    onSubmit: async ({ value }) => {
      try {
        const { opened } = await transfer.mutateAsync({ body: toTransferRequest(value, move) });
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: teamsRosterQueryKey({ path: { id: team.id } }) }),
          queryClient.invalidateQueries({
            queryKey: teamsRosterQueryKey({ path: { id: opened.teamId } }),
          }),
          queryClient.invalidateQueries({ queryKey: athletesListQueryKey() }),
        ]);
        toast.success(`${entry.fullName} transferred to ${value.toTeam?.label ?? 'the other team'}.`);
        onDone();
      } catch (error) {
        handleApiError(error, { setFieldErrors: serverFieldErrors(form) });
      }
    },
  });

  return (
    <form
      noValidate
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.AppField name="toTeam">
        {(field) => (
          <TeamPicker
            label="Destination team"
            excludeIds={[team.id]}
            value={field.state.value}
            onChange={field.handleChange}
            error={errorMessages(field.state.meta.errors).join(' ') || undefined}
          />
        )}
      </form.AppField>
      <form.AppField name="effectiveAt">
        {(field) => <field.TextField label="Transfer date" type="date" />}
      </form.AppField>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <form.AppForm>
          <form.SubmitButton pendingLabel="Transferring...">Transfer</form.SubmitButton>
        </form.AppForm>
      </DialogFooter>
    </form>
  );
}
