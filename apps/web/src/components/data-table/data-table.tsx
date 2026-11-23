import {
  IconArrowDown,
  IconArrowsSort,
  IconArrowUp,
  IconChevronLeft,
  IconChevronRight,
  IconChevronsLeft,
  IconChevronsRight,
  IconSearch,
} from '@tabler/icons-react';
import {
  type ColumnDef,
  createColumnHelper,
  FlexRender,
  type RowData,
  tableFeatures,
  useTable,
} from '@tanstack/react-table';
import { cn } from 'cn';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { toApiError } from '@/lib/api';
import {
  type ListState,
  PAGE_SIZES,
  pageCountOf,
  sortDirection,
  toggleSort,
} from './list-state';
import { useDebouncedCallback } from './use-debounced-callback';

/**
 * No row model beyond the core one is registered: sorting, filtering and paging all
 * happen on the server (the list contract), and the table only draws the page it is
 * given. TanStack Table v9 tree-shakes whatever is not listed here.
 */
const features = tableFeatures({});
type Features = typeof features;

/** What a column may say about itself beyond what TanStack Table knows. */
export interface DataTableColumnMeta {
  /** The sortable key of the list contract this column sorts by. Absent: not sortable. */
  sortKey?: string;
  /** Classes for the column's header and cells, e.g. `hidden md:table-cell`. */
  className?: string;
}

// `any` for the cell value, as TanStack Table's own column arrays are typed: one array
// holds columns of different value types, and a column def is invariant in its value.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DataTableColumn<TData extends RowData> = ColumnDef<Features, TData, any> & {
  meta?: DataTableColumnMeta;
};

/** `const column = dataTableColumns<Athlete>()` then `column.accessor('lastName', { ... })`. */
export function dataTableColumns<TData extends RowData>() {
  return createColumnHelper<Features, TData>();
}

export interface DataTableProps<TData extends RowData> {
  columns: DataTableColumn<TData>[];
  /** The current page; undefined until the first answer arrives. */
  page: { items: TData[]; total: number } | undefined;
  /** True while there is nothing to show yet. */
  isLoading: boolean;
  /** True while a newer page is on its way and the previous one is still shown. */
  isRefreshing?: boolean;
  error: unknown;
  onRetry: () => void;
  /** Page, page size, sort and search: read from, and written to, the route's search params. */
  state: ListState;
  onStateChange: (next: ListState) => void;
  getRowId: (row: TData) => string;
  /** Draws the search box. Leave out for a list with nothing to search. */
  searchLabel?: string;
  /** What "nothing here" means for this list, e.g. "No athletes yet." */
  emptyMessage: string;
  /** What the rows are called in the footer count, e.g. "athletes". */
  noun: string;
  /** Controls beside the search box (a Create button). */
  actions?: ReactNode;
}

const SEARCH_DEBOUNCE_MS = 300;
const SKELETON_ROWS = 5;

/**
 * THE list table: every paginated list in the app is this component over one of the
 * API's `{ items, total, page, pageSize }` routes.
 *
 * It holds no list state of its own. `state` comes from the URL and every interaction
 * calls `onStateChange` with the next URL state, so a reload, a shared link and the
 * back button all reproduce the view. The one local value is the text in the search
 * box, which is written to the URL once typing pauses. Anything that changes WHICH
 * rows match (search, sort, page size) returns to page 1.
 *
 * Loading, empty and failed are states of the table, not of each screen.
 */
export function DataTable<TData extends RowData>({
  columns,
  page,
  isLoading,
  isRefreshing = false,
  error,
  onRetry,
  state,
  onStateChange,
  getRowId,
  searchLabel,
  emptyMessage,
  noun,
  actions,
}: DataTableProps<TData>) {
  const table = useTable({
    features,
    columns,
    data: page?.items ?? [],
    getRowId,
  });

  const total = page?.total ?? 0;
  const pageCount = pageCountOf(total, state.pageSize);
  const failed = error != null && !isLoading;
  const columnCount = columns.length;

  const goTo = (target: number) =>
    onStateChange({ ...state, page: Math.min(Math.max(1, target), pageCount) });

  // A page past the end (a hand-edited URL, or the last row of the last page deleted)
  // is answered with no rows and the real total. That answer is what says where the
  // end is, so the state is moved to the last page once it has arrived.
  const pastTheEnd = page !== undefined && !isLoading && !isRefreshing && state.page > pageCount;
  const reconcile = useRef({ state, onStateChange });
  useEffect(() => {
    reconcile.current = { state, onStateChange };
  });
  useEffect(() => {
    if (!pastTheEnd) return;
    const current = reconcile.current;
    current.onStateChange({ ...current.state, page: pageCount });
  }, [pastTheEnd, pageCount]);

  return (
    <div className="flex flex-col gap-4">
      {(searchLabel || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 lg:px-6">
          {searchLabel ? (
            <SearchBox
              label={searchLabel}
              value={state.q ?? ''}
              onSearch={(q) => onStateChange({ ...state, q: q === '' ? undefined : q, page: 1 })}
            />
          ) : (
            <span />
          )}
          {actions}
        </div>
      )}

      <div className="px-4 lg:px-6">
        <div className="overflow-hidden rounded-lg border">
          <Table aria-busy={isLoading || isRefreshing}>
            <TableHeader className="bg-muted">
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id}>
                  {headerGroup.headers.map((header) => {
                    const meta = metaOf(header.column);
                    const sortKey = meta.sortKey;
                    const direction = sortKey ? sortDirection(state.sort, sortKey) : false;
                    return (
                      <TableHead
                        key={header.id}
                        colSpan={header.colSpan}
                        className={meta.className}
                        aria-sort={
                          direction === 'asc'
                            ? 'ascending'
                            : direction === 'desc'
                              ? 'descending'
                              : undefined
                        }
                      >
                        {header.isPlaceholder ? null : sortKey ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="-ms-3 h-8"
                            onClick={() =>
                              onStateChange({
                                ...state,
                                sort: toggleSort(state.sort, sortKey),
                                page: 1,
                              })
                            }
                          >
                            <FlexRender header={header} />
                            {direction === 'asc' ? (
                              <IconArrowUp />
                            ) : direction === 'desc' ? (
                              <IconArrowDown />
                            ) : (
                              <IconArrowsSort className="text-muted-foreground/60" />
                            )}
                          </Button>
                        ) : (
                          <FlexRender header={header} />
                        )}
                      </TableHead>
                    );
                  })}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody className={cn(isRefreshing && 'opacity-60 transition-opacity')}>
              {failed ? (
                <TableRow>
                  <TableCell colSpan={columnCount} className="h-32 text-center">
                    <div role="alert" className="flex flex-col items-center gap-3">
                      <div>
                        <p className="font-medium">Could not load this list.</p>
                        <p className="text-muted-foreground">{failureMessage(error)}</p>
                      </div>
                      <Button variant="outline" size="sm" onClick={onRetry}>
                        Try again
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ) : isLoading ? (
                Array.from({ length: SKELETON_ROWS }, (_, row) => (
                  <TableRow key={row} data-testid="data-table-skeleton">
                    {table.getAllLeafColumns().map((column) => (
                      <TableCell
                        key={column.id}
                        className={metaOf(column).className}
                      >
                        <Skeleton className="h-5 w-full max-w-40" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : table.getRowModel().rows.length > 0 ? (
                table.getRowModel().rows.map((row) => (
                  <TableRow key={row.id}>
                    {row.getAllCells().map((cell) => (
                      <TableCell
                        key={cell.id}
                        className={metaOf(cell.column).className}
                      >
                        <FlexRender cell={cell} />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={columnCount} className="h-32 text-center text-muted-foreground">
                    {state.q ? `Nothing matches "${state.q}".` : emptyMessage}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-2 px-4 lg:px-6">
        <div className="text-sm text-muted-foreground" data-testid="data-table-total">
          {page ? `${total} ${noun}` : ' '}
        </div>
        <div className="flex items-center gap-4 lg:gap-8">
          <div className="hidden items-center gap-2 sm:flex">
            <Label htmlFor="rows-per-page" className="text-sm font-medium">
              Rows per page
            </Label>
            <Select
              value={String(state.pageSize)}
              onValueChange={(value) =>
                onStateChange({ ...state, pageSize: Number(value), page: 1 })
              }
            >
              <SelectTrigger size="sm" className="w-20" id="rows-per-page">
                <SelectValue />
              </SelectTrigger>
              <SelectContent side="top">
                {pageSizeChoices(state.pageSize).map((size) => (
                  <SelectItem key={size} value={String(size)}>
                    {size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="text-sm font-medium" data-testid="data-table-page">
            Page {state.page} of {pageCount}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              className="hidden size-8 lg:flex"
              onClick={() => goTo(1)}
              disabled={state.page <= 1}
            >
              <span className="sr-only">Go to first page</span>
              <IconChevronsLeft className="rtl:rotate-180" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              onClick={() => goTo(state.page - 1)}
              disabled={state.page <= 1}
            >
              <span className="sr-only">Go to previous page</span>
              <IconChevronLeft className="rtl:rotate-180" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              onClick={() => goTo(state.page + 1)}
              disabled={state.page >= pageCount}
            >
              <span className="sr-only">Go to next page</span>
              <IconChevronRight className="rtl:rotate-180" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="hidden size-8 lg:flex"
              onClick={() => goTo(pageCount)}
              disabled={state.page >= pageCount}
            >
              <span className="sr-only">Go to last page</span>
              <IconChevronsRight className="rtl:rotate-180" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** A column's own notes about itself; TanStack Table types `meta` as an open, empty interface. */
function metaOf(column: { columnDef: { meta?: object } }): DataTableColumnMeta {
  const meta: DataTableColumnMeta = column.columnDef.meta ?? {};
  return meta;
}

function failureMessage(error: unknown): string {
  const apiError = toApiError(error);
  if (apiError.status === 403) return 'You do not have access to this list in this academy.';
  if (apiError.status >= 500) return 'Something went wrong on our side.';
  return apiError.message;
}

/** The standard sizes, plus the current one when a hand-edited URL asked for another. */
function pageSizeChoices(current: number): number[] {
  return [...new Set([...PAGE_SIZES, current])].sort((a, b) => a - b);
}

function SearchBox({
  label,
  value,
  onSearch,
}: {
  label: string;
  value: string;
  onSearch: (q: string) => void;
}) {
  const [text, setText] = useState(value);
  const lastSent = useRef(value);
  // Only the text waits. `onSearch` is read when the timer fires, so a sort or a page
  // size chosen while it was pending is kept instead of being written over.
  const debounced = useDebouncedCallback((q: string) => {
    lastSent.current = q;
    onSearch(q);
  }, SEARCH_DEBOUNCE_MS);

  // The URL is the source of truth: when it changes under the box (back button, a
  // link), the box follows. A value this box sent itself is not such a change, and
  // must not overwrite what has been typed since.
  useEffect(() => {
    if (value === lastSent.current) return;
    lastSent.current = value;
    debounced.cancel();
    setText(value);
  }, [value, debounced]);

  return (
    <div className="relative w-full max-w-xs">
      <IconSearch className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        aria-label={label}
        placeholder={label}
        className="ps-8"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          debounced.call(event.target.value.trim());
        }}
      />
    </div>
  );
}
