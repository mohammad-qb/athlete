import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { handleApiError } from '@/lib/api';

/**
 * The three versions of a record that a refused save (409 `stale_write`) leaves a
 * person with: what they loaded, what they typed, and what is stored now.
 */
export interface Conflict<Field extends string, TRecord extends Record<Field, unknown>> {
  /** The record as it was when the form was filled from it. */
  loaded: TRecord;
  /** The form's values at the moment the save was refused. */
  mine: Record<Field, unknown>;
  /** The record as someone else has since saved it. */
  current: TRecord;
}

export interface ConflictRow<Field extends string> {
  field: Field;
  label: string;
  theirs: string;
  mine: string;
  /** True when the other person changed this field; false when only the form differs. */
  changedByThem: boolean;
}

function show(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/**
 * The fields worth showing: those where the three versions are not all the same. A
 * field nobody touched is left out, so the dialog is as long as the disagreement.
 */
export function conflictRows<Field extends string, TRecord extends Record<Field, unknown>>(
  conflict: Conflict<Field, TRecord>,
  labels: Record<Field, string>,
  format: Partial<Record<Field, (value: unknown) => string>> = {},
): ConflictRow<Field>[] {
  return (Object.keys(labels) as Field[])
    .filter(
      (field) =>
        conflict.current[field] !== conflict.loaded[field] ||
        conflict.mine[field] !== conflict.current[field],
    )
    .map((field) => {
      const text = format[field] ?? show;
      return {
        field,
        label: labels[field],
        theirs: text(conflict.current[field]),
        mine: text(conflict.mine[field]),
        changedByThem: conflict.current[field] !== conflict.loaded[field],
      };
    });
}

/**
 * The state behind `<ConflictDialog>`, for an edit form:
 *
 *     const conflict = useConflict(() => fetchTheRecordAgain());
 *     handleApiError(error, { onConflict: () => conflict.open(loaded, values) });
 *     <ConflictDialog conflict={conflict.conflict} onDismiss={conflict.close} ... />
 *
 * `open` fetches the record as it is now and only then shows the dialog, so the dialog
 * never appears without the other person's version in it. If that fetch fails the
 * failure goes through the error mapper like any other.
 */
export function useConflict<Field extends string, TRecord extends Record<Field, unknown>>(
  fetchCurrent: () => Promise<TRecord>,
) {
  const [conflict, setConflict] = useState<Conflict<Field, TRecord> | null>(null);
  const fetchLatest = useRef(fetchCurrent);
  useEffect(() => {
    fetchLatest.current = fetchCurrent;
  });

  const open = useCallback(async (loaded: TRecord, mine: Record<Field, unknown>) => {
    try {
      const current = await fetchLatest.current();
      setConflict({ loaded, mine, current });
    } catch (error) {
      handleApiError(error);
    }
  }, []);
  const close = useCallback(() => setConflict(null), []);

  return { conflict, open, close };
}

/**
 * THE conflict dialog: what every edit form shows when its save is refused because
 * someone else saved first. The form behind it stays filled in.
 *
 * It lists only the fields in dispute, the other person's value beside the form's, and
 * offers the two ways out. "Keep mine" saves the form again, this time against the
 * version just fetched. "Take theirs" drops the form's values for the stored ones.
 * Closing it does neither: nothing is saved and the form is as it was.
 */
export function ConflictDialog<Field extends string, TRecord extends Record<Field, unknown>>({
  conflict,
  labels,
  format,
  noun,
  onKeepMine,
  onTakeTheirs,
  onDismiss,
}: {
  conflict: Conflict<Field, TRecord> | null;
  /** The form's fields, by name, as the form labels them. */
  labels: Record<Field, string>;
  /** How to print a field whose value is not already display text (a date). */
  format?: Partial<Record<Field, (value: unknown) => string>>;
  /** What the record is called, e.g. "athlete". */
  noun: string;
  onKeepMine: (conflict: Conflict<Field, TRecord>) => Promise<void> | void;
  onTakeTheirs: (conflict: Conflict<Field, TRecord>) => void;
  onDismiss: () => void;
}) {
  const [saving, setSaving] = useState(false);
  if (!conflict) return null;
  const rows = conflictRows(conflict, labels, format);

  async function keepMine(current: Conflict<Field, TRecord>) {
    setSaving(true);
    try {
      await onKeepMine(current);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onDismiss()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Someone else changed this {noun}</DialogTitle>
          <DialogDescription>
            It was saved by someone else while you were editing, so your changes have not
            been saved. Choose which version to keep.
          </DialogDescription>
        </DialogHeader>
        <dl className="grid gap-3 text-sm">
          {rows.map((row) => (
            <div
              key={row.field}
              className="grid gap-1 rounded-md border p-3"
              data-testid={`conflict-${row.field}`}
            >
              <dt className="font-medium">{row.label}</dt>
              <dd className="grid grid-cols-2 gap-3">
                <div className="min-w-0">
                  <div className="text-xs text-muted-foreground">
                    {row.changedByThem ? 'Theirs (changed)' : 'Theirs'}
                  </div>
                  <div className="break-words" data-testid="conflict-theirs">
                    {row.theirs}
                  </div>
                </div>
                <div className="min-w-0">
                  <div className="text-xs text-muted-foreground">Yours</div>
                  <div className="break-words" data-testid="conflict-mine">
                    {row.mine}
                  </div>
                </div>
              </dd>
            </div>
          ))}
        </dl>
        <DialogFooter>
          <Button variant="outline" disabled={saving} onClick={() => onTakeTheirs(conflict)}>
            Take theirs
          </Button>
          <Button disabled={saving} onClick={() => void keepMine(conflict)}>
            {saving ? 'Saving...' : 'Keep mine'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
