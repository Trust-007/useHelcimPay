/**
 * Authenticated encryption (AES-256-GCM) for small JSON payloads, e.g. a
 * checkout's secret token kept in an httpOnly cookie. The key is SHA-256 of
 * the password, so any string of 32+ characters works as a secret.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const VERSION = 'v1';

const keys = new Map<string, Promise<CryptoKey>>();
function aesKey(password: string): Promise<CryptoKey> {
  let key = keys.get(password);
  if (!key) {
    key = crypto.subtle
      .digest('SHA-256', encoder.encode(password))
      .then((raw) => crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']));
    keys.set(password, key);
  }
  return key;
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export async function seal(password: string, value: unknown): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = encoder.encode(JSON.stringify(value));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(password), data);
  return `${VERSION}.${toBase64Url(iv)}.${toBase64Url(new Uint8Array(cipher))}`;
}

/** Returns `undefined` for anything that isn't a valid, untampered seal made with this password. */
export async function unseal<T>(password: string, sealed: string): Promise<T | undefined> {
  const [version, iv, cipher] = sealed.split('.');
  if (version !== VERSION || !iv || !cipher) return undefined;
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64Url(iv) },
      await aesKey(password),
      fromBase64Url(cipher),
    );
    return JSON.parse(decoder.decode(plain)) as T;
  } catch {
    return undefined;
  }
}
