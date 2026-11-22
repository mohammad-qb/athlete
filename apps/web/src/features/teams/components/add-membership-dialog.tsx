import { CreateMembershipRequest } from '@athlete/contracts';
import { IconPlus } from '@tabler/icons-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { errorMessages, requestValidator, serverFieldErrors, useAppForm } from '@/components/form';
import { AthletePicker } from '@/components/pickers';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  athletesListQueryKey,
  handleApiError,
  type TeamResponse,
  teamsAddMembershipMutation,
  teamsRosterQueryKey,
} from '@/lib/api';
import { today } from '@/lib/dates';
import {
  membershipPeriodError,
  type MembershipValues,
  toMembershipRequest,
} from '../team-requests';

const validateRequest = requestValidator<MembershipValues>(
  CreateMembershipRequest,
  toMembershipRequest,
  { athleteId: 'athlete' },
);

/** The "Add athlete" button on a team's roster and the dialog it opens. */
export function AddMembershipDialog({ team }: { team: TeamResponse }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <IconPlus />
          Add athlete
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add an athlete to {team.name}</DialogTitle>
          <DialogDescription>
            A membership is a period. Leave the last day empty for an athlete who is staying.
          </DialogDescription>
        </DialogHeader>
        <AddMembershipForm team={team} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

function AddMembershipForm({ team, onDone }: { team: TeamResponse; onDone: () => void }) {
  const queryClient = useQueryClient();
  const add = useMutation(teamsAddMembershipMutation());

  const initial: MembershipValues = { athlete: null, validFrom: today(), validTo: '' };

  const form = useAppForm({
    defaultValues: initial,
    validators: {
      onSubmit: ({ value }) => {
        const period = membershipPeriodError(value);
        return validateRequest({ value }) ?? (period ? { fields: { validTo: period } } : undefined);
      },
    },
    onSubmit: async ({ value }) => {
      try {
        await add.mutateAsync({ path: { id: team.id }, body: toMembershipRequest(value) });
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: teamsRosterQueryKey({ path: { id: team.id } }) }),
          // Whom a coach may see follows from who is on their teams.
          queryClient.invalidateQueries({ queryKey: athletesListQueryKey() }),
        ]);
        toast.success(`${value.athlete?.label ?? 'Athlete'} added to ${team.name}.`);
        onDone();
      } catch (error) {
        // An overlapping period is the database's rule; the API says so in its message.
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
      <form.AppField name="athlete">
        {(field) => (
          <AthletePicker
            value={field.state.value}
            onChange={field.handleChange}
            error={errorMessages(field.state.meta.errors).join(' ') || undefined}
          />
        )}
      </form.AppField>
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <form.AppField name="validFrom">
          {(field) => <field.TextField label="First day" type="date" />}
        </form.AppField>
        <form.AppField name="validTo">
          {(field) => <field.TextField label="Last day" type="date" description="Optional." />}
        </form.AppField>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <form.AppForm>
          <form.SubmitButton pendingLabel="Adding...">Add to team</form.SubmitButton>
        </form.AppForm>
      </DialogFooter>
    </form>
  );
}
