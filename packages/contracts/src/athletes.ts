import { z } from 'zod';
import { IsoDateTime, patchOf, strictObject, Uuid, Versioned } from './primitives';

export const CreateAthleteRequest = strictObject({
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD'),
});
export type CreateAthleteRequest = z.infer<typeof CreateAthleteRequest>;

export const UpdateAthleteRequest = patchOf(CreateAthleteRequest);
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
  .merge(Versioned);
export type AthleteResponse = z.infer<typeof AthleteResponse>;
