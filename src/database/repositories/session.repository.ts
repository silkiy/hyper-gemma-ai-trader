import { Session } from '../models/session.model.js';
import type { ISession } from '../models/session.model.js';

export class SessionRepository {
  async create(data: Partial<ISession>): Promise<ISession> {
    return await Session.create(data);
  }

  async findLatest(): Promise<ISession | null> {
    return await Session.findOne().sort({ started_at: -1 });
  }

  async update(id: string, data: Partial<ISession>): Promise<ISession | null> {
    return await Session.findByIdAndUpdate(id, data, { returnDocument: 'after' });
  }
}

export const sessionRepository = new SessionRepository();
