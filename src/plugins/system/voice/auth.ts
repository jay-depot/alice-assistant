import { randomBytes, timingSafeEqual } from 'node:crypto';

export function createVoiceAccessToken(): string {
  return randomBytes(32).toString('hex');
}

export function extractVoiceAccessToken(headers: Record<string, string | string[] | undefined>): string | null {
  const directHeader = headers['x-alice-voice-token'];
  if (typeof directHeader === 'string' && directHeader.trim()) {
    return directHeader.trim();
  }

  const authorization = headers.authorization;
  if (typeof authorization !== 'string') {
    return null;
  }

  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

export function isVoiceAccessTokenValid(expectedToken: string | null, providedToken: string | null): boolean {
  if (!expectedToken || !providedToken) {
    return false;
  }

  const expectedBuffer = Buffer.from(expectedToken, 'utf8');
  const providedBuffer = Buffer.from(providedToken, 'utf8');
  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, providedBuffer);
}