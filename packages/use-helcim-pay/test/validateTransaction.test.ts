import { createHash } from 'node:crypto';
import { validateTransaction } from '../src/server';
import pythonCases from './fixtures/python-json.json';

// Hashes are computed with node:crypto over encodings produced by the
// reference implementations (the CPython fixture, or PHP rules applied by
// hand). That keeps these tests independent of the code under test.
const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

const SECRET = 'test-secret-token';
const transactionCase = pythonCases.at(-1)!;
/** Helcim-style transaction JSON as it might arrive (pretty-printed, `15.45`, `/`, non-ASCII). */
const rawData = JSON.stringify(JSON.parse(transactionCase.input), null, 2);
const pythonJson = transactionCase.expected;
/** PHP differs from Python here only in escaping '/'. */
const phpJson = pythonJson.replaceAll('/', '\\/');

const message = (hash: string, data = rawData) => `{"data":{"hash":"${hash}","data":${data}}}`;

describe('validateTransaction', () => {
  it('accepts a PHP-hashed response', async () => {
    const result = await validateTransaction({
      eventMessage: message(sha256(phpJson + SECRET)),
      secretToken: SECRET,
    });
    expect(result).toMatchObject({ valid: true, encoding: 'php' });
    if (result.valid) expect(result.transaction.transactionId).toBe(20163175);
  });

  it('accepts a Python-hashed response', async () => {
    const result = await validateTransaction({
      eventMessage: message(sha256(pythonJson + SECRET)),
      secretToken: SECRET,
    });
    expect(result).toMatchObject({ valid: true, encoding: 'python' });
  });

  it('accepts an uppercase hex hash', async () => {
    const result = await validateTransaction({
      eventMessage: message(sha256(phpJson + SECRET).toUpperCase()),
      secretToken: SECRET,
    });
    expect(result.valid).toBe(true);
  });

  it('preserves float formatting: 10.00 must hash as 10.0, not 10', async () => {
    const data = '{"transactionId":1,"amount":10.00,"currency":"CAD","status":"APPROVED"}';
    const hash = sha256(
      '{"transactionId":1,"amount":10.0,"currency":"CAD","status":"APPROVED"}' + SECRET,
    );
    const result = await validateTransaction({
      eventMessage: message(hash, data),
      secretToken: SECRET,
    });
    expect(result.valid).toBe(true);
  });

  it('handles already-parsed objects using floatKeys for amounts', async () => {
    const hash = sha256('{"transactionId":1,"amount":10.0,"status":"APPROVED"}' + SECRET);
    const result = await validateTransaction({
      eventMessage: { data: { hash, data: { transactionId: 1, amount: 10, status: 'APPROVED' } } },
      secretToken: SECRET,
    });
    expect(result.valid).toBe(true);
  });

  it('rejects tampered data', async () => {
    const hash = sha256(phpJson + SECRET);
    const tampered = rawData.replace('15.45', '1545.00');
    const result = await validateTransaction({
      eventMessage: message(hash, tampered),
      secretToken: SECRET,
    });
    expect(result).toMatchObject({ valid: false, reason: 'HASH_MISMATCH' });
  });

  it('rejects the wrong secret', async () => {
    const result = await validateTransaction({
      eventMessage: message(sha256(phpJson + SECRET)),
      secretToken: 'other-secret',
    });
    expect(result).toMatchObject({ valid: false, reason: 'HASH_MISMATCH' });
  });

  it('rejects malformed messages without throwing', async () => {
    await expect(
      validateTransaction({ eventMessage: 'garbage', secretToken: SECRET }),
    ).resolves.toMatchObject({
      valid: false,
      reason: 'MALFORMED_MESSAGE',
    });
  });

  it('enforces the expected amount and currency', async () => {
    const eventMessage = message(sha256(phpJson + SECRET));
    await expect(
      validateTransaction({
        eventMessage,
        secretToken: SECRET,
        expected: { amount: 15.45, currency: 'cad' },
      }),
    ).resolves.toMatchObject({ valid: true });
    await expect(
      validateTransaction({ eventMessage, secretToken: SECRET, expected: { amount: 1 } }),
    ).resolves.toMatchObject({ valid: false, reason: 'AMOUNT_MISMATCH' });
    await expect(
      validateTransaction({ eventMessage, secretToken: SECRET, expected: { currency: 'USD' } }),
    ).resolves.toMatchObject({ valid: false, reason: 'CURRENCY_MISMATCH' });
  });

  it('rejects non-approved transactions unless requireApproved is false', async () => {
    const data = '{"transactionId":2,"status":"DECLINED"}';
    const eventMessage = message(sha256(data + SECRET), data);
    await expect(validateTransaction({ eventMessage, secretToken: SECRET })).resolves.toMatchObject(
      {
        valid: false,
        reason: 'NOT_APPROVED',
      },
    );
    await expect(
      validateTransaction({ eventMessage, secretToken: SECRET, requireApproved: false }),
    ).resolves.toMatchObject({ valid: true });
  });
});
