import type { AttendanceStatus } from '@athlete/contracts';
import { cn } from 'cn';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { AttendanceMark } from '@/lib/drafts';
import { type PendingRow, type RecordedRow, STATUS_LABELS, STATUSES } from '../register';

/** What a chosen status looks like, as whole class names (Tailwind reads them as text). */
const CHOSEN: Record<AttendanceStatus, string> = {
  present: 'has-checked:border-success has-checked:bg-success has-checked:text-success-foreground',
  late: 'has-checked:border-warning has-checked:bg-warning has-checked:text-warning-foreground',
  absent: 'has-checked:border-destructive has-checked:bg-destructive has-checked:text-white',
  excused: 'has-checked:border-primary has-checked:bg-primary has-checked:text-primary-foreground',
};

const BADGE: Record<AttendanceStatus, 'success' | 'warning' | 'destructive' | 'secondary'> = {
  present: 'success',
  late: 'warning',
  absent: 'destructive',
  excused: 'secondary',
};

/**
 * One athlete still to record: a status to choose and an optional note.
 *
 * The four choices are real radio buttons, each covering its whole segment: a thumb
 * hits the segment, a keyboard gets a radio group's arrow keys, and a screen reader is
 * told which athlete the group is for.
 */
export function PendingAttendanceRow({
  row,
  onChange,
}: {
  row: PendingRow;
  onChange: (change: Partial<Pick<AttendanceMark, 'status' | 'note'>>) => void;
}) {
  const note = row.mark?.note ?? '';
  const [noteOpen, setNoteOpen] = useState(note !== '');

  return (
    <li className="grid gap-2 px-3 py-3" data-testid="pending-row">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-sm font-medium">{row.fullName}</span>
        {!noteOpen && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`Add a note for ${row.fullName}`}
            onClick={() => setNoteOpen(true)}
          >
            Add note
          </Button>
        )}
      </div>
      <div
        role="radiogroup"
        aria-label={`Attendance for ${row.fullName}`}
        className="grid grid-cols-4 gap-1"
      >
        {STATUSES.map((status) => (
          <label
            key={status}
            className={cn(
              'relative flex h-10 items-center justify-center rounded-md border text-sm font-medium transition-colors',
              'has-focus-visible:ring-[3px] has-focus-visible:ring-ring/50',
              CHOSEN[status],
            )}
          >
            <input
              type="radio"
              className="absolute inset-0 cursor-pointer opacity-0"
              name={`attendance-${row.athleteId}`}
              value={status}
              checked={row.mark?.status === status}
              onChange={() => onChange({ status })}
            />
            {STATUS_LABELS[status]}
          </label>
        ))}
      </div>
      {noteOpen && (
        <Input
          aria-label={`Note for ${row.fullName}`}
          placeholder="Note (optional)"
          autoComplete="off"
          maxLength={500}
          value={note}
          onChange={(event) => onChange({ note: event.target.value })}
        />
      )}
    </li>
  );
}

/** One athlete the API already holds an entry for: what was recorded, to read. */
export function RecordedAttendanceRow({ row }: { row: RecordedRow }) {
  return (
    <li className="flex items-start justify-between gap-3 px-3 py-2.5 text-sm">
      <div className="grid min-w-0 gap-0.5">
        <span className="truncate font-medium">{row.fullName}</span>
        {row.note && <span className="text-muted-foreground">{row.note}</span>}
      </div>
      <Badge variant={BADGE[row.status]}>{STATUS_LABELS[row.status]}</Badge>
    </li>
  );
}
