import { z } from 'zod';
import { IsoDateTime, listQueryOf, pageOf, patchOf, strictObject, Uuid, Versioned } from './primitives';

const AthleteFields = strictObject({
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD'),
});

export const CreateAthleteRequest = AthleteFields.meta({ id: 'CreateAthleteRequest' });
export type CreateAthleteRequest = z.infer<typeof CreateAthleteRequest>;

/** `minProperties` says in the document what the refinement enforces: no empty patch. */
export const UpdateAthleteRequest = patchOf(AthleteFields).meta({
  id: 'UpdateAthleteRequest',
  minProperties: 1,
});
export type UpdateAthleteRequest = z.infer<typeof UpdateAthleteRequest>;

export const AthleteResponse = z
  .object({
    id: Uuid,
    academyId: Uuid,
    firstName: z.string(),
    lastName: z.string(),
    dateOfBirth: z.string(),
    createdAt: IsoDateTime,
  })
  .merge(Versioned)
  .meta({ id: 'AthleteResponse' });
export type AthleteResponse = z.infer<typeof AthleteResponse>;

/** `q` matches the first or the last name, case-insensitively. */
export const AthleteListQuery = listQueryOf(
  ['lastName', 'firstName', 'dateOfBirth', 'createdAt'],
  'lastName',
);
export type AthleteListQuery = z.infer<typeof AthleteListQuery>;

export const AthletePage = pageOf(AthleteResponse).meta({ id: 'AthletePage' });
export type AthletePage = z.infer<typeof AthletePage>;
