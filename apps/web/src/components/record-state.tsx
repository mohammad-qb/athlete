import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { loadFailureMessage } from '@/lib/api';

/** Where a single record will be, while it is on its way. */
export function RecordLoading() {
  return (
    <div className="grid max-w-xl gap-3 px-4 lg:px-6" data-testid="record-loading">
      <Skeleton className="h-6 w-48" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}

/** Where a single record would have been: why it is not, a retry, and a way back. */
export function RecordError({
  error,
  onRetry,
  back,
}: {
  error: unknown;
  onRetry: () => void;
  /** A link back to the list the record belongs to. */
  back: ReactNode;
}) {
  return (
    <div role="alert" className="grid max-w-xl gap-3 px-4 lg:px-6">
      <p className="font-medium">Could not load this page.</p>
      <p className="text-sm text-muted-foreground">{loadFailureMessage(error)}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
        {back}
      </div>
    </div>
  );
}
