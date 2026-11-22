import { CreateAthleteRequest } from '@athlete/contracts';
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
import { athletesCreateMutation, athletesListQueryKey, handleApiError } from '@/lib/api';
import { ATHLETE_LABELS, type AthleteValues, EMPTY_ATHLETE } from '../athlete-values';

/** The "Add athlete" button and the dialog it opens. */
export function CreateAthleteDialog() {
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
          <DialogTitle>Add athlete</DialogTitle>
          <DialogDescription>They are added to the academy you are working in.</DialogDescription>
        </DialogHeader>
        {/* Mounted with the dialog, so every opening starts from an empty form. */}
        <CreateAthleteForm onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

function CreateAthleteForm({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const create = useMutation(athletesCreateMutation());

  const form = useAppForm({
    defaultValues: EMPTY_ATHLETE,
    validators: { onSubmit: requestValidator<AthleteValues>(CreateAthleteRequest) },
    onSubmit: async ({ value }) => {
      try {
        const athlete = await create.mutateAsync({ body: value });
        await queryClient.invalidateQueries({ queryKey: athletesListQueryKey() });
        toast.success(`${athlete.firstName} ${athlete.lastName} added.`);
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
      <form.AppField name="firstName">
        {(field) => <field.TextField label={ATHLETE_LABELS.firstName} autoComplete="off" />}
      </form.AppField>
      <form.AppField name="lastName">
        {(field) => <field.TextField label={ATHLETE_LABELS.lastName} autoComplete="off" />}
      </form.AppField>
      <form.AppField name="dateOfBirth">
        {(field) => <field.TextField label={ATHLETE_LABELS.dateOfBirth} type="date" />}
      </form.AppField>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <form.AppForm>
          <form.SubmitButton pendingLabel="Adding...">Add athlete</form.SubmitButton>
        </form.AppForm>
      </DialogFooter>
    </form>
  );
}
