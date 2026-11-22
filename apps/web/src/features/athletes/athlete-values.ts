import type { UpdateAthleteRequest } from '@athlete/contracts';
import type { AthleteResponse } from '@/lib/api';
import { formatDate } from '@/lib/dates';

/** The fields of an athlete a person edits; the form's values, and the request's body. */
export interface AthleteValues {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
}
export type AthleteField = keyof AthleteValues;

/** One set of labels for the form and for the conflict dialog, so they cannot differ. */
export const ATHLETE_LABELS: Record<AthleteField, string> = {
  firstName: 'First name',
  lastName: 'Last name',
  dateOfBirth: 'Date of birth',
};

export const ATHLETE_FORMATS: Partial<Record<AthleteField, (value: unknown) => string>> = {
  dateOfBirth: (value) => (typeof value === 'string' && value ? formatDate(value) : '—'),
};

export const EMPTY_ATHLETE: AthleteValues = { firstName: '', lastName: '', dateOfBirth: '' };

export function valuesOf(athlete: AthleteResponse): AthleteValues {
  return {
    firstName: athlete.firstName,
    lastName: athlete.lastName,
    dateOfBirth: athlete.dateOfBirth,
  };
}

/**
 * The PATCH that makes `against` look like the form: only the fields that differ.
 *
 * Sending the whole form would also "change" the fields the person never touched back
 * to what they loaded, quietly undoing someone else's edit to them. Empty when the form
 * already matches, which the caller must not send (the API refuses an empty patch).
 */
export function changedFields(values: AthleteValues, against: AthleteResponse): UpdateAthleteRequest {
  const patch: UpdateAthleteRequest = {};
  for (const field of Object.keys(ATHLETE_LABELS) as AthleteField[]) {
    if (values[field] !== against[field]) patch[field] = values[field];
  }
  return patch;
}
