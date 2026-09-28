import { initializeCheckout } from '../src/server';
import { HelcimPayError } from '../src/types';

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const base = {
  apiToken: 'tok_test',
  paymentType: 'purchase',
  amount: 19.99,
  currency: 'CAD',
} as const;

async function expectInitError(
  promise: Promise<unknown>,
  match: { status?: number; message?: RegExp },
) {
  const error = await promise.then(
    () => {
      throw new Error('expected rejection');
    },
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(HelcimPayError);
  expect((error as HelcimPayError).code).toBe('INIT_FAILED');
  if (match.status !== undefined) expect((error as HelcimPayError).status).toBe(match.status);
  if (match.message) expect((error as HelcimPayError).message).toMatch(match.message);
}

describe('initializeCheckout', () => {
  it('POSTs the documented request and returns the session', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ checkoutToken: 'ct_1', secretToken: 'st_1' }),
    );
    const session = await initializeCheckout({ ...base, invoiceNumber: 'INV-1', fetch: fetchMock });

    expect(session.checkoutToken).toBe('ct_1');
    expect(session.secretToken).toBe('st_1');
    expect(session.expiresAt.getTime()).toBeGreaterThan(Date.now() + 59 * 60 * 1000);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.helcim.com/v2/helcim-pay/initialize');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'api-token': 'tok_test', accept: 'application/json' });
    expect(JSON.parse(init.body as string)).toEqual({
      paymentType: 'purchase',
      amount: 19.99,
      currency: 'CAD',
      invoiceNumber: 'INV-1',
    });
  });

  it('respects apiBaseUrl (for simulators) and strips trailing slashes', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ checkoutToken: 'a', secretToken: 'b' }));
    await initializeCheckout({
      ...base,
      apiBaseUrl: 'http://localhost:3000/api/mock-helcim/v2/',
      fetch: fetchMock,
    });
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe(
      'http://localhost:3000/api/mock-helcim/v2/helcim-pay/initialize',
    );
  });

  it('never sends the api token in the body', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ checkoutToken: 'a', secretToken: 'b' }));
    await initializeCheckout({ ...base, fetch: fetchMock });
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.body).not.toContain('tok_test');
  });

  it.each([
    [{ errors: 'Invalid currency' }, /Invalid currency/],
    [
      { errors: ['amount is required', 'currency is required'] },
      /amount is required; currency is required/,
    ],
    [{ errors: { amount: 'must be positive' } }, /amount: must be positive/],
  ])('surfaces Helcim error body %j', async (body, message) => {
    const fetchMock = vi.fn(async () => jsonResponse(body, 400));
    await expectInitError(initializeCheckout({ ...base, fetch: fetchMock }), {
      status: 400,
      message,
    });
  });

  it('handles non-JSON error responses', async () => {
    const fetchMock = vi.fn(async () => new Response('<html>502</html>', { status: 502 }));
    await expectInitError(initializeCheckout({ ...base, fetch: fetchMock }), {
      status: 502,
      message: /HTTP 502/,
    });
  });

  it('wraps network failures', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    await expectInitError(initializeCheckout({ ...base, fetch: fetchMock }), {
      message: /Could not reach/,
    });
  });

  it('rejects a 200 response without tokens', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ checkoutToken: 'only' }));
    await expectInitError(initializeCheckout({ ...base, fetch: fetchMock }), {
      message: /did not include/,
    });
  });

  it('validates inputs before calling Helcim', async () => {
    const fetchMock = vi.fn();
    await expectInitError(initializeCheckout({ ...base, apiToken: '', fetch: fetchMock }), {
      message: /API token/,
    });
    await expectInitError(initializeCheckout({ ...base, amount: -1, fetch: fetchMock }), {
      message: /Invalid amount/,
    });
    await expectInitError(initializeCheckout({ ...base, amount: NaN, fetch: fetchMock }), {
      message: /Invalid amount/,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
