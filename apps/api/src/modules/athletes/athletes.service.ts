import { Injectable, NotFoundException } from '@nestjs/common';
import type { AthleteResponse, CreateAthleteRequest, UpdateAthleteRequest } from '@athlete/contracts';
import { AthletesRepository, type AthleteRow } from './athletes.repository';
import { PolicyService } from '../../common/authz/policy.service';
import { staleWrite } from '../../common/http/optimistic-concurrency';

@Injectable()
export class AthletesService {
  constructor(
    private readonly repository: AthletesRepository,
    private readonly policies: PolicyService,
  ) {}

  async list(): Promise<AthleteResponse[]> {
    const rows = await this.repository.list();
    return rows.map(toResponse);
  }

  async getById(id: string): Promise<AthleteResponse> {
    const row = await this.repository.findById(id);
    if (!row) throw new NotFoundException(`Athlete ${id} not found`);
    // Coarse role check already happened in the guard; this is the responsibility check.
    await this.policies.assertCanAccessAthlete(id);
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
    await this.policies.assertCanAccessAthlete(id);

    const updated = await this.repository.updateIfVersionMatches(id, expectedVersion, patch);
    if (updated) return toResponse(updated);

    // Nothing matched. Tell the caller which of the two reasons applies.
    const current = await this.repository.findById(id);
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
