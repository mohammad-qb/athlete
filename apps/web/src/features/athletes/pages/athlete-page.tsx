import { UpdateAthleteRequest } from '@athlete/contracts';
import { IconArrowLeft } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ConflictDialog, useConflict } from '@/components/conflict-dialog';
import { requestValidator, serverFieldErrors, useAppForm } from '@/components/form';
import { RecordError, RecordLoading } from '@/components/record-state';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  type AthleteResponse,
  athletesGetByIdOptions,
  athletesListQueryKey,
  athletesUpdateMutation,
  type ErrorOutcome,
  handleApiError,
} from '@/lib/api';
import { useCan } from '@/lib/authz';
import { formatDate } from '@/lib/dates';
import {
  ATHLETE_FORMATS,
  ATHLETE_LABELS,
  type AthleteField,
  type AthleteValues,
  changedFields,
  valuesOf,
} from '../athlete-values';

function BackToAthletes() {
  return (
    <Button variant="ghost" size="sm" className="-ms-2 justify-self-start" asChild>
      <Link to="/athletes">
        <IconArrowLeft className="rtl:rotate-180" />
        Athletes
      </Link>
    </Button>
  );
}

/** One athlete: their details, editable by whoever may update athletes. */
export function AthletePage({ athleteId }: { athleteId: string }) {
  const query = useQuery(athletesGetByIdOptions({ path: { id: athleteId } }));

  if (query.isPending) return <RecordLoading />;
  if (query.isError) {
    return (
      <RecordError
        error={query.error}
        onRetry={() => void query.refetch()}
        back={<BackToAthletes />}
      />
    );
  }
  return <AthleteEditor athlete={query.data} />;
}

/**
 * The edit form. Every save names the version it was made against (`If-Match`), so a
 * save over someone else's is refused with a 409 and the conflict dialog opens instead
 * of one person's work silently replacing the other's.
 *
 * `base` is the version the form was FILLED from, and is what a save is made against.
 * It is deliberately not "whatever the cache holds now": if a background refetch moved
 * the version under a half-edited form and the save used it, the 409 that protects the
 * other person's change would never happen.
 */
function AthleteEditor({ athlete }: { athlete: AthleteResponse }) {
  const queryClient = useQueryClient();
  const canUpdate = useCan()('update', 'athletes');
  const [base, setBase] = useState(athlete);
  const update = useMutation(athletesUpdateMutation());
  const current = athletesGetByIdOptions({ path: { id: athlete.id } });
  const conflict = useConflict<AthleteField, AthleteResponse>(() =>
    queryClient.fetchQuery({ ...current, staleTime: 0 }),
  );

  const form = useAppForm({
    defaultValues: valuesOf(base),
    validators: { onSubmit: requestValidator<AthleteValues>(UpdateAthleteRequest) },
    onSubmit: async ({ value }) => {
      await save(value, base);
    },
  });

  /** The form now shows, and will save against, this version. */
  function adopt(next: AthleteResponse) {
    setBase(next);
    queryClient.setQueryData(current.queryKey, next);
    form.reset(valuesOf(next));
  }

  async function save(values: AthleteValues, against: AthleteResponse): Promise<ErrorOutcome | 'saved'> {
    const patch = changedFields(values, against);
    if (Object.keys(patch).length === 0) {
      adopt(against);
      toast.info('There is nothing to save.');
      return 'saved';
    }
    try {
      const saved = await update.mutateAsync({
        path: { id: against.id },
        headers: { 'If-Match': `"${against.version}"` },
        body: patch,
      });
      adopt(saved);
      void queryClient.invalidateQueries({ queryKey: athletesListQueryKey() });
      toast.success('Athlete saved.');
      return 'saved';
    } catch (error) {
      return handleApiError(error, {
        setFieldErrors: serverFieldErrors(form),
        onConflict: () => void conflict.open(against, values),
      });
    }
  }

  // A newer version arrived (a refetch) under a form nobody has typed in: show it.
  // A form with edits in it is left alone; its save will meet the conflict dialog.
  useEffect(() => {
    if (athlete.version !== base.version && !form.state.isDirty && !conflict.conflict) {
      setBase(athlete);
      form.reset(valuesOf(athlete));
    }
  }, [athlete, base.version, conflict.conflict, form]);

  return (
    <div className="grid gap-4 px-4 lg:px-6">
      <BackToAthletes />
      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle data-testid="athlete-name">
            {base.firstName} {base.lastName}
          </CardTitle>
          <CardDescription>Added {formatDate(base.createdAt)}.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            noValidate
            className="grid gap-6"
            onSubmit={(event) => {
              event.preventDefault();
              void form.handleSubmit();
            }}
          >
            <form.AppField name="firstName">
              {(field) => (
                <field.TextField
                  label={ATHLETE_LABELS.firstName}
                  autoComplete="off"
                  disabled={!canUpdate}
                />
              )}
            </form.AppField>
            <form.AppField name="lastName">
              {(field) => (
                <field.TextField
                  label={ATHLETE_LABELS.lastName}
                  autoComplete="off"
                  disabled={!canUpdate}
                />
              )}
            </form.AppField>
            <form.AppField name="dateOfBirth">
              {(field) => (
                <field.TextField
                  label={ATHLETE_LABELS.dateOfBirth}
                  type="date"
                  disabled={!canUpdate}
                />
              )}
            </form.AppField>
            {canUpdate && (
              <form.AppForm>
                <form.SubmitButton className="justify-self-start" pendingLabel="Saving...">
                  Save changes
                </form.SubmitButton>
              </form.AppForm>
            )}
          </form>
        </CardContent>
      </Card>

      <ConflictDialog
        conflict={conflict.conflict}
        labels={ATHLETE_LABELS}
        format={ATHLETE_FORMATS}
        noun="athlete"
        onDismiss={conflict.close}
        onKeepMine={async ({ mine, current: theirs }) => {
          // A second conflict (they saved again) reopens the dialog with the newer version.
          if ((await save(mine as unknown as AthleteValues, theirs)) !== 'conflict') conflict.close();
        }}
        onTakeTheirs={({ current: theirs }) => {
          adopt(theirs);
          conflict.close();
        }}
      />
    </div>
  );
}
