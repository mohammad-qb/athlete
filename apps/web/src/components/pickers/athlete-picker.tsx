import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { athletesListOptions } from '@/lib/api';
import { formatDate } from '@/lib/dates';
import { type PickerOption, SearchPicker } from './search-picker';

/**
 * Choosing an athlete, for a form in any feature. It searches the athletes list route,
 * so it offers exactly the athletes the signed-in user may see.
 */
export function AthletePicker({
  value,
  onChange,
  error,
  label = 'Athlete',
}: {
  value: PickerOption | null;
  onChange: (next: PickerOption | null) => void;
  error?: string | undefined;
  label?: string;
}) {
  const [q, setQ] = useState('');
  const query = useQuery({
    ...athletesListOptions({ query: { pageSize: 20, ...(q ? { q } : {}) } }),
    enabled: value === null,
  });

  return (
    <SearchPicker
      label={label}
      placeholder="Search by name"
      value={value}
      onChange={onChange}
      onSearch={setQ}
      isLoading={query.isPending}
      isError={query.isError}
      error={error}
      options={(query.data?.items ?? []).map((athlete) => ({
        id: athlete.id,
        label: `${athlete.firstName} ${athlete.lastName}`,
        hint: `Born ${formatDate(athlete.dateOfBirth)}`,
      }))}
    />
  );
}
