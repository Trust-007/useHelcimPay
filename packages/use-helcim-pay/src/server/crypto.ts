/** Web Crypto helpers, so the server entry runs on Node >= 20, Edge and Workers alike. */

function subtle(): SubtleCrypto {
  const c = globalThis.crypto;
  if (!c?.subtle) {
    throw new Error(
      'use-helcim-pay/server requires the Web Crypto API (Node >= 20, Edge or Workers).',
    );
  }
  return c.subtle;
}

const encoder = new TextEncoder();

export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

/** Lowercase hex SHA-256 of a UTF-8 string. */
export async function sha256Hex(input: string): Promise<string> {
  const digest = await subtle().digest('SHA-256', encoder.encode(input));
  return bytesToHex(new Uint8Array(digest));
}

/** Constant-time string comparison, so timing doesn't leak how much of a hash matched. */
export function timingSafeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) diff |= (a.charCodeAt(i) | 0) ^ (b.charCodeAt(i) | 0);
  return diff === 0;
}
