import { CreateAthleteRequest, CreateTeamRequest } from '@athlete/contracts';
import { describe, expect, it } from 'vitest';
import { requestValidator } from './request-validator';

describe('requestValidator', () => {
  it('passes a request the contract accepts', () => {
    const validate = requestValidator(CreateAthleteRequest);
    expect(
      validate({ value: { firstName: 'Amal', lastName: 'Falcon', dateOfBirth: '2008-01-01' } }),
    ).toBeUndefined();
  });

  it('says "Required." for an empty box, whatever the schema objects to about it', () => {
    const validate = requestValidator(CreateAthleteRequest);
    expect(validate({ value: { firstName: '', lastName: 'Falcon', dateOfBirth: '' } })).toEqual({
      fields: { firstName: 'Required.', dateOfBirth: 'Required.' },
    });
  });

  it('states a length limit as a sentence, and keeps the schema\'s own message otherwise', () => {
    const validate = requestValidator(CreateAthleteRequest);
    expect(
      validate({ value: { firstName: 'x'.repeat(101), lastName: 'Falcon', dateOfBirth: '01/01/2008' } }),
    ).toEqual({
      fields: { firstName: 'Use at most 100 characters.', dateOfBirth: 'expected YYYY-MM-DD' },
    });
  });

  it('validates what `toRequest` builds, and puts a renamed field\'s message on the form field', () => {
    const validate = requestValidator<{ title: string }>(
      CreateTeamRequest,
      (values) => ({ name: values.title, sport: 'football', ageGroup: null }),
      { name: 'title' },
    );
    expect(validate({ value: { title: '' } })).toEqual({ fields: { title: 'Required.' } });
    expect(validate({ value: { title: 'U17 Squad' } })).toBeUndefined();
  });
});
