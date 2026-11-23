import { IconSearch } from '@tabler/icons-react';
import { useId, useState } from 'react';
import { useDebouncedCallback } from '@/components/data-table/use-debounced-callback';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export interface PickerOption {
  id: string;
  label: string;
  /** A second line that tells two options with the same label apart. */
  hint?: string;
}

const SEARCH_DEBOUNCE_MS = 250;

/**
 * Choosing one record out of a list too long to put in a select: a search box and the
 * matches under it. Presentational; `AthletePicker` and `TeamPicker` give it a list
 * route to search.
 *
 * Laid out in the flow of the form rather than in a popover, so it works unchanged in
 * a dialog at phone width.
 */
export function SearchPicker({
  label,
  value,
  onChange,
  onSearch,
  options,
  isLoading,
  isError,
  error,
  placeholder,
}: {
  label: string;
  value: PickerOption | null;
  onChange: (next: PickerOption | null) => void;
  /** Called, debounced, with the trimmed text of the search box. */
  onSearch: (q: string) => void;
  options: readonly PickerOption[];
  isLoading: boolean;
  isError: boolean;
  /** The field's validation message, when it has one to show. */
  error?: string | undefined;
  placeholder: string;
}) {
  const id = useId();
  const [text, setText] = useState('');
  const debounced = useDebouncedCallback(onSearch, SEARCH_DEBOUNCE_MS);
  const errorId = `${id}-error`;

  if (value) {
    return (
      <div className="grid gap-2">
        <Label htmlFor={`${id}-change`}>{label}</Label>
        <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-1.5 text-sm">
          <span className="min-w-0 truncate" data-testid="picker-value">
            {value.label}
          </span>
          <Button
            id={`${id}-change`}
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`Change ${label.toLowerCase()}`}
            onClick={() => onChange(null)}
          >
            Change
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <IconSearch className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          id={id}
          type="search"
          className="ps-8"
          placeholder={placeholder}
          autoComplete="off"
          value={text}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          onChange={(event) => {
            setText(event.target.value);
            debounced.call(event.target.value.trim());
          }}
        />
      </div>
      <div
        role="listbox"
        aria-label={`${label} matches`}
        className="grid max-h-44 gap-0.5 overflow-y-auto rounded-md border p-1"
      >
        {isError ? (
          <p className="px-2 py-1.5 text-sm text-destructive">Could not load the list.</p>
        ) : isLoading ? (
          <p className="px-2 py-1.5 text-sm text-muted-foreground">Searching...</p>
        ) : options.length === 0 ? (
          <p className="px-2 py-1.5 text-sm text-muted-foreground">No matches.</p>
        ) : (
          options.map((option) => (
            <button
              key={option.id}
              type="button"
              role="option"
              aria-selected={false}
              className="flex min-w-0 flex-col rounded-sm px-2 py-1.5 text-start text-sm outline-none hover:bg-accent focus-visible:bg-accent"
              onClick={() => onChange(option)}
            >
              <span className="truncate">{option.label}</span>
              {option.hint && (
                <span className="truncate text-xs text-muted-foreground">{option.hint}</span>
              )}
            </button>
          ))
        )}
      </div>
      {error && (
        <p id={errorId} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
