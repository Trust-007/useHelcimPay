import { bytesToHex, timingSafeEqual } from '../server/crypto';

/**
 * Stateless simulator sessions. The checkout token *is* the session: a
 * base64url JSON payload plus an HMAC. The secret token is derived from it
 * with a second HMAC. So any serverless instance can check a token and
 * rebuild its secret without shared storage.
 */

export interface SimulatorSession {
  v: 1;
  paymentType: 'purchase' | 'preauth' | 'verify';
  amount: number;
  currency: 'CAD' | 'USD';
  invoiceNumber?: string;
  customerCode?: string;
  confirmationScreen?: boolean;
  /** Expiry, in ms since epoch. */
  exp: number;
  /** Random nonce, so two identical carts get different tokens. */
  n: string;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

const keyCache = new Map<string, Promise<CryptoKey>>();
function hmacKey(secret: string): Promise<CryptoKey> {
  let key = keyCache.get(secret);
  if (!key) {
    key = crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    keyCache.set(secret, key);
  }
  return key;
}

async function hmac(secret: string, message: string): Promise<Uint8Array> {
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(message));
  return new Uint8Array(sig);
}

export function randomHex(bytes: number): string {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function signSession(
  signingSecret: string,
  session: SimulatorSession,
): Promise<string> {
  const payload = toBase64Url(encoder.encode(JSON.stringify(session)));
  const sig = toBase64Url(await hmac(signingSecret, `token:${payload}`));
  return `${payload}.${sig}`;
}

export type VerifyResult =
  | { ok: true; session: SimulatorSession }
  | { ok: false; reason: 'malformed' | 'bad-signature' | 'expired' };

export async function verifySession(
  signingSecret: string,
  token: string,
  now = Date.now(),
): Promise<VerifyResult> {
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: 'malformed' };
  const [payload, sig] = parts as [string, string];
  const expected = toBase64Url(await hmac(signingSecret, `token:${payload}`));
  if (!timingSafeEqual(expected, sig)) return { ok: false, reason: 'bad-signature' };
  let session: SimulatorSession;
  try {
    session = JSON.parse(decoder.decode(fromBase64Url(payload))) as SimulatorSession;
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (session.v !== 1) return { ok: false, reason: 'malformed' };
  if (session.exp <= now) return { ok: false, reason: 'expired' };
  return { ok: true, session };
}

/** The secret token for a checkout token. Only the server that holds `signingSecret` can compute it. */
export async function deriveSecretToken(
  signingSecret: string,
  checkoutToken: string,
): Promise<string> {
  return bytesToHex(await hmac(signingSecret, `secret:${checkoutToken}`));
}
