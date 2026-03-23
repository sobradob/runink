import crypto from 'crypto';

export interface StravaSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Unix timestamp (seconds)
  athleteId: number;
  athleteName: string;
}

const sessions = new Map<string, StravaSession>();

export function createSession(data: StravaSession): string {
  const id = crypto.randomUUID();
  sessions.set(id, data);
  return id;
}

export function getSession(id: string): StravaSession | undefined {
  return sessions.get(id);
}

export function updateSession(id: string, data: Partial<StravaSession>) {
  const existing = sessions.get(id);
  if (existing) {
    sessions.set(id, { ...existing, ...data });
  }
}

export function deleteSession(id: string) {
  sessions.delete(id);
}
