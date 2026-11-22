import { Injectable, NotFoundException } from '@nestjs/common';
import type { AthleteResponse, CreateAthleteRequest, UpdateAthleteRequest } from '@athlete/contracts';
import { AthletesRepository, type AthleteRow } from './athletes.repository';
import { assertCan } from '../../common/authz/assert-can';
import { staleWrite } from '../../common/http/optimistic-concurrency';

@Injectable()
export class AthletesService {
  constructor(private readonly repository: AthletesRepository) {}

  /**
   * The guard has already answered "may this role list athletes at all". Which ones is
   * the access filter: an administrator's is unrestricted, a coach's is the athletes on
   * the teams they coach now, and a coach with none is refused outright rather than
   * shown an empty page.
   */
  async list(): Promise<AthleteResponse[]> {
    const rows = await this.repository.list(this.repository.accessFilter('read'));
    return rows.map(toResponse);
  }

  async getById(id: string): Promise<AthleteResponse> {
    // The id IS the scope key for an athlete, so a principal naming one they do not
    // answer for is told so (403) before any read. It is no existence oracle: the
    // answer is the same whether or not that id exists.
    assertCan('read', 'athletes', { id });
    const row = await this.repository.findById(id, this.repository.accessFilter('read'));
    if (!row) throw new NotFoundException(`Athlete ${id} not found`);
    return toResponse(row);
  }

  async create(input: CreateAthleteRequest): Promise<AthleteResponse> {
    return toResponse(await this.repository.insert(input));
  }

  async update(
    id: string,
    expectedVersion: number,
    patch: UpdateAthleteRequest,
  ): Promise<AthleteResponse> {
    assertCan('update', 'athletes', { id });

    const updated = await this.repository.updateIfVersionMatches(
      id,
      expectedVersion,
      patch,
      this.repository.accessFilter('update'),
    );
    if (updated) return toResponse(updated);

    // Nothing matched. Tell the caller which of the two reasons applies.
    const current = await this.repository.findById(id, this.repository.accessFilter('read'));
    if (!current) throw new NotFoundException(`Athlete ${id} not found`);
    throw staleWrite('Athlete', expectedVersion);
  }
}

function toResponse(row: AthleteRow): AthleteResponse {
  return {
    id: row.id,
    academyId: row.academyId,
    firstName: row.firstName,
    lastName: row.lastName,
    dateOfBirth: row.dateOfBirth,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
  };
}
