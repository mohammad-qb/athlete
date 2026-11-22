import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { teamsListOptions } from '@/lib/api';
import { type PickerOption, SearchPicker } from './search-picker';

/**
 * Choosing a team, for a form in any feature. It searches the teams list route, so it
 * offers exactly the teams the signed-in user may see.
 */
export function TeamPicker({
  value,
  onChange,
  error,
  label = 'Team',
  excludeIds = [],
}: {
  value: PickerOption | null;
  onChange: (next: PickerOption | null) => void;
  error?: string | undefined;
  label?: string;
  /** Teams that are not a choice here, e.g. the team an athlete is leaving. */
  excludeIds?: readonly string[];
}) {
  const [q, setQ] = useState('');
  const query = useQuery({
    ...teamsListOptions({ query: { pageSize: 20, ...(q ? { q } : {}) } }),
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
      options={(query.data?.items ?? [])
        .filter((team) => !excludeIds.includes(team.id))
        .map((team) => ({
          id: team.id,
          label: team.name,
          hint: team.ageGroup ? `${team.sport}, ${team.ageGroup}` : team.sport,
        }))}
    />
  );
}
