import { CreateTeamRequest } from '@athlete/contracts';
import { IconPlus } from '@tabler/icons-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { requestValidator, serverFieldErrors, useAppForm } from '@/components/form';
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
import { handleApiError, teamsCreateMutation, teamsListQueryKey } from '@/lib/api';
import { type TeamValues, toTeamRequest } from '../team-requests';

/** The "New team" button and the dialog it opens. */
export function CreateTeamDialog() {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <IconPlus />
          New team
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New team</DialogTitle>
          <DialogDescription>Athletes are added to it from the team's own page.</DialogDescription>
        </DialogHeader>
        <CreateTeamForm onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

function CreateTeamForm({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const create = useMutation(teamsCreateMutation());

  const form = useAppForm({
    defaultValues: { name: '', sport: '', ageGroup: '' } satisfies TeamValues,
    validators: { onSubmit: requestValidator<TeamValues>(CreateTeamRequest, toTeamRequest) },
    onSubmit: async ({ value }) => {
      try {
        const team = await create.mutateAsync({ body: toTeamRequest(value) });
        await queryClient.invalidateQueries({ queryKey: teamsListQueryKey() });
        toast.success(`${team.name} created.`);
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
      <form.AppField name="name">
        {(field) => <field.TextField label="Name" autoComplete="off" />}
      </form.AppField>
      <form.AppField name="sport">
        {(field) => <field.TextField label="Sport" autoComplete="off" />}
      </form.AppField>
      <form.AppField name="ageGroup">
        {(field) => (
          <field.TextField label="Age group" autoComplete="off" description="Optional, e.g. U17." />
        )}
      </form.AppField>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <form.AppForm>
          <form.SubmitButton pendingLabel="Creating...">Create team</form.SubmitButton>
        </form.AppForm>
      </DialogFooter>
    </form>
  );
}
