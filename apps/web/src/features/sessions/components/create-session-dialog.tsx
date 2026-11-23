import { IconPlus } from '@tabler/icons-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { errorMessages, serverFieldErrors, useAppForm } from '@/components/form';
import { TeamPicker } from '@/components/pickers';
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
import { handleApiError, sessionsCreateMutation, sessionsListQueryKey } from '@/lib/api';
import { today } from '@/lib/dates';
import {
  formatSessionTime,
  sessionFormErrors,
  type SessionValues,
  toSessionRequest,
} from '../session-requests';

/** The "New session" button and the dialog it opens. */
export function CreateSessionDialog() {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <IconPlus />
          New session
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New session</DialogTitle>
          <DialogDescription>
            Its register is the team's roster as it stands when the session starts.
          </DialogDescription>
        </DialogHeader>
        <CreateSessionForm onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

function CreateSessionForm({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const create = useMutation(sessionsCreateMutation());

  const initial: SessionValues = {
    team: null,
    date: today(),
    startTime: '',
    endTime: '',
    location: '',
  };

  const form = useAppForm({
    defaultValues: initial,
    validators: { onSubmit: ({ value }) => sessionFormErrors(value) },
    onSubmit: async ({ value }) => {
      try {
        const session = await create.mutateAsync({ body: toSessionRequest(value) });
        await queryClient.invalidateQueries({ queryKey: sessionsListQueryKey() });
        toast.success(`Session created for ${formatSessionTime(session)}.`);
        onDone();
      } catch (error) {
        // The team picker offers only teams this person may schedule for; a refusal
        // that still arrives (a team they stopped coaching meanwhile) is a toast.
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
      <form.AppField name="team">
        {(field) => (
          <TeamPicker
            value={field.state.value}
            onChange={field.handleChange}
            error={errorMessages(field.state.meta.errors).join(' ') || undefined}
          />
        )}
      </form.AppField>
      <form.AppField name="date">
        {(field) => <field.TextField label="Date" type="date" />}
      </form.AppField>
      <div className="grid grid-cols-2 items-start gap-4">
        <form.AppField name="startTime">
          {(field) => <field.TextField label="Starts" type="time" />}
        </form.AppField>
        <form.AppField name="endTime">
          {(field) => <field.TextField label="Ends" type="time" />}
        </form.AppField>
      </div>
      <form.AppField name="location">
        {(field) => (
          <field.TextField label="Location" autoComplete="off" description="Optional." />
        )}
      </form.AppField>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <form.AppForm>
          <form.SubmitButton pendingLabel="Creating...">Create session</form.SubmitButton>
        </form.AppForm>
      </DialogFooter>
    </form>
  );
}
