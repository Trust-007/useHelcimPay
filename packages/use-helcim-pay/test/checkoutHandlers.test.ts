import { createCheckoutHandlers, seal } from '../src/server';
import { createCheckoutClient } from '../src/checkoutClient';
import { createHelcimSimulator } from '../src/testing';

const COOKIE_SECRET = 'cookie-secret-that-is-at-least-32-chars!!';
const ORIGIN = 'https://shop.example';
const PRICES: Record<string, number> = { tote: 24, mug: 16.5 };

type Cart = { items: Array<{ id: string; qty: number }> };

function setup(overrides: Partial<Parameters<typeof createCheckoutHandlers<Cart>>[0]> = {}) {
  const sim = createHelcimSimulator({
    signingSecret: 'handler-test-signing-secret',
    apiToken: 'sim-token',
  });
  const onVerified = vi.fn();
  const handlers = createCheckoutHandlers<Cart>({
    apiToken: 'sim-token',
    cookieSecret: COOKIE_SECRET,
    apiBaseUrl: sim.apiBaseUrl,
    fetch: sim.fetch,
    getOrder: ({ items }) => {
      if (!Array.isArray(items) || items.length === 0) throw new Error('Cart is empty');
      const cents = items.reduce((sum, { id, qty }) => {
        const price = PRICES[id];
        if (price === undefined) throw new Error(`Unknown product: ${id}`);
        return sum + Math.round(price * 100) * qty;
      }, 0);
      return { amount: cents / 100, currency: 'CAD', invoiceNumber: 'INV-7' };
    },
    onVerified,
    ...overrides,
  });
  return { sim, handlers, onVerified };
}

const post = (path: string, body: unknown, cookie?: string) =>
  new Request(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

/** Turns a Set-Cookie header into the Cookie header a browser would send back. */
const cookieFrom = (res: Response) => res.headers.get('set-cookie')!.split(';')[0]!;

async function startCheckout(
  ctx: ReturnType<typeof setup>,
  cart: Cart = {
    items: [
      { id: 'tote', qty: 1 },
      { id: 'mug', qty: 2 },
    ],
  },
) {
  const res = await ctx.handlers.initialize(post('/api/checkout/initialize', cart));
  expect(res.status).toBe(200);
  const body = (await res.json()) as { checkoutToken: string; expiresAt: string };
  return { ...body, cookie: cookieFrom(res), setCookie: res.headers.get('set-cookie')! };
}

describe('createCheckoutHandlers', () => {
  it('requires a long cookie secret', () => {
    expect(() => setup({ cookieSecret: 'short' })).toThrow(/at least 32/);
  });

  it('runs the whole flow: initialize → pay → validate, then refuses a replay', async () => {
    const ctx = setup();
    const { checkoutToken, expiresAt, cookie, setCookie } = await startCheckout(ctx);

    expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(setCookie).toMatch(/^helcim_checkout=v1\./);
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/SameSite=Strict/);
    expect(setCookie).toMatch(/Secure/);
    // The secret token is encrypted, not just encoded.
    expect(setCookie).not.toContain(await ctx.sim.getSecretToken(checkoutToken));

    const { eventMessage } = await ctx.sim.simulatePayment({ checkoutToken });
    const res = await ctx.handlers.validate(
      post('/api/checkout/validate', { checkoutToken, eventMessage }, cookie),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      valid: true,
      transaction: { amount: 57, currency: 'CAD', status: 'APPROVED' },
    });
    expect(res.headers.get('set-cookie')).toMatch(/Max-Age=0/);
    expect(ctx.onVerified).toHaveBeenCalledWith(
      expect.objectContaining({
        order: { amount: 57, currency: 'CAD', invoiceNumber: 'INV-7' },
        transaction: expect.objectContaining({ amount: 57 }),
      }),
    );

    // The browser has dropped the cookie, so the same receipt can't be verified twice.
    const replay = await ctx.handlers.validate(
      post('/api/checkout/validate', { checkoutToken, eventMessage }),
    );
    expect(replay.status).toBe(400);
    expect(await replay.json()).toMatchObject({ valid: false, reason: 'NO_SESSION' });
    expect(ctx.onVerified).toHaveBeenCalledTimes(1);
  });

  it('omits Secure on plain http (local dev)', async () => {
    const ctx = setup();
    const res = await ctx.handlers.initialize(
      new Request('http://localhost:3000/api/checkout/initialize', {
        method: 'POST',
        body: JSON.stringify({ items: [{ id: 'mug', qty: 1 }] }),
      }),
    );
    expect(res.headers.get('set-cookie')).not.toMatch(/Secure/);
  });

  it.each([
    ['an empty cart', { items: [] }, /Cart is empty/],
    ['an unknown product', { items: [{ id: 'yacht', qty: 1 }] }, /Unknown product/],
    ['invalid JSON', 'nope', /must be JSON/],
  ])('rejects %s with HTTP 400', async (_label, body, message) => {
    const res = await setup().handlers.initialize(post('/api/checkout/initialize', body));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(message);
  });

  it('maps Helcim initialize failures to HTTP 502', async () => {
    const res = await setup({ apiToken: 'wrong' }).handlers.initialize(
      post('/api/checkout/initialize', { items: [{ id: 'mug', qty: 1 }] }),
    );
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({
      code: 'INIT_FAILED',
      error: expect.stringMatching(/401/),
    });
  });

  it('rejects validation for a different checkout token', async () => {
    const ctx = setup();
    const a = await startCheckout(ctx);
    const b = await startCheckout(ctx);
    const { eventMessage } = await ctx.sim.simulatePayment({ checkoutToken: a.checkoutToken });
    // The browser only holds the latest checkout's cookie.
    const res = await ctx.handlers.validate(
      post('/api/checkout/validate', { checkoutToken: a.checkoutToken, eventMessage }, b.cookie),
    );
    expect(await res.json()).toMatchObject({ valid: false, reason: 'NO_SESSION' });
  });

  it('rejects a tampered or foreign cookie', async () => {
    const ctx = setup();
    const { checkoutToken, cookie } = await startCheckout(ctx);
    const { eventMessage } = await ctx.sim.simulatePayment({ checkoutToken });
    const tampered = cookie.slice(0, -2) + (cookie.endsWith('A') ? 'BB' : 'AA');
    const forged = `helcim_checkout=${await seal('some-other-secret-that-is-32-chars-long', {
      checkoutToken,
      secretToken: 'x',
      order: { amount: 0.01, currency: 'CAD' },
      exp: Date.now() + 1000,
    })}`;
    for (const c of [tampered, forged, 'helcim_checkout=garbage']) {
      const res = await ctx.handlers.validate(
        post('/api/checkout/validate', { checkoutToken, eventMessage }, c),
      );
      expect(await res.json()).toMatchObject({ valid: false, reason: 'NO_SESSION' });
    }
  });

  it('rejects a tampered transaction with HASH_MISMATCH', async () => {
    const ctx = setup();
    const { checkoutToken, cookie } = await startCheckout(ctx);
    const { eventMessage } = await ctx.sim.simulatePayment({ checkoutToken });
    const res = await ctx.handlers.validate(
      post(
        '/api/checkout/validate',
        { checkoutToken, eventMessage: eventMessage.replace('INV-7', 'INV-8') },
        cookie,
      ),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ valid: false, reason: 'HASH_MISMATCH' });
  });

  it('returns 500 when onVerified throws, and keeps the session for a retry', async () => {
    const ctx = setup({
      onVerified: () => {
        throw new Error('inventory service down');
      },
    });
    const { checkoutToken, cookie } = await startCheckout(ctx);
    const { eventMessage } = await ctx.sim.simulatePayment({ checkoutToken });
    const res = await ctx.handlers.validate(
      post('/api/checkout/validate', { checkoutToken, eventMessage }, cookie),
    );
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'inventory service down' });
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('supports a custom cookie name and path', async () => {
    const ctx = setup({ cookieName: 'pay', cookiePath: '/api/checkout' });
    const { setCookie } = await startCheckout(ctx);
    expect(setCookie).toMatch(/^pay=/);
    expect(setCookie).toMatch(/Path=\/api\/checkout/);
  });
});

describe('createCheckoutClient', () => {
  it('talks to the handlers (full round trip through fetch)', async () => {
    const ctx = setup();
    let cookie = '';
    // A tiny cookie jar standing in for the browser.
    const fetchImpl: typeof fetch = async (url, init) => {
      const headers = new Headers(init?.headers);
      if (cookie) headers.set('cookie', cookie);
      const req = new Request(`${ORIGIN}${String(url)}`, { ...init, headers });
      const res = String(url).endsWith('/initialize')
        ? await ctx.handlers.initialize(req)
        : await ctx.handlers.validate(req);
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.includes('Max-Age=0') ? '' : set.split(';')[0]!;
      return res;
    };
    const client = createCheckoutClient<Cart>({
      initializeUrl: '/api/checkout/initialize',
      validateUrl: '/api/checkout/validate',
      fetch: fetchImpl,
    });

    const { checkoutToken, expiresAt } = await client.getCheckoutToken(
      { items: [{ id: 'mug', qty: 1 }] },
      { signal: new AbortController().signal },
    );
    expect(expiresAt).toEqual(expect.any(String));
    const { eventMessage } = await ctx.sim.simulatePayment({ checkoutToken });
    await expect(client.validate({ checkoutToken, eventMessage })).resolves.toMatchObject({
      valid: true,
      transaction: { amount: 16.5 },
    });
    // Replay: the verdict comes back as data (valid: false), not as a thrown error.
    await expect(client.validate({ checkoutToken, eventMessage })).resolves.toMatchObject({
      valid: false,
      reason: 'NO_SESSION',
    });
  });

  it('throws INIT_FAILED with the server message', async () => {
    const client = createCheckoutClient({
      initializeUrl: '/i',
      validateUrl: '/v',
      fetch: async () => new Response(JSON.stringify({ error: 'Cart is empty' }), { status: 400 }),
    });
    await expect(
      client.getCheckoutToken({}, { signal: new AbortController().signal }),
    ).rejects.toMatchObject({
      code: 'INIT_FAILED',
      status: 400,
      message: 'Cart is empty',
    });
  });

  it('throws VALIDATION_FAILED for server errors without a verdict', async () => {
    const client = createCheckoutClient({
      initializeUrl: '/i',
      validateUrl: '/v',
      fetch: async () => new Response('<html>oops</html>', { status: 502 }),
    });
    await expect(client.validate({ checkoutToken: 't', eventMessage: '' })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      message: expect.stringMatching(/HTTP 502/),
    });
  });

  it('sends JSON, custom headers and same-origin credentials', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ checkoutToken: 'x' })));
    const client = createCheckoutClient({
      initializeUrl: '/i',
      validateUrl: '/v',
      headers: { 'x-csrf': 'abc' },
      fetch: fetchMock,
    });
    await client.getCheckoutToken({ a: 1 }, { signal: new AbortController().signal });
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init).toMatchObject({ method: 'POST', credentials: 'same-origin', body: '{"a":1}' });
    expect(init.headers).toMatchObject({ 'content-type': 'application/json', 'x-csrf': 'abc' });
  });
});
