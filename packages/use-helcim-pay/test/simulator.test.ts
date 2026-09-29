import { initializeCheckout, validateTransaction } from '../src/server';
import { createHelcimSimulator, SimulatorInputError, TEST_CARDS } from '../src/testing';

const SECRET = 'simulator-signing-secret-for-tests';
const ORIGIN = 'http://localhost:3000';

function makeSim(overrides: Parameters<typeof createHelcimSimulator>[0] | object = {}) {
  return createHelcimSimulator({ signingSecret: SECRET, ...overrides });
}

async function init(sim = makeSim(), body: Record<string, unknown> = {}) {
  return initializeCheckout({
    apiToken: 'any-token',
    apiBaseUrl: sim.apiBaseUrl,
    fetch: sim.fetch,
    paymentType: 'purchase',
    amount: 15.45,
    currency: 'CAD',
    ...body,
  });
}

const card = (outcome: string) => TEST_CARDS.find((c) => c.outcome === outcome)!.number;

describe('createHelcimSimulator', () => {
  it('rejects a short signing secret', () => {
    expect(() => createHelcimSimulator({ signingSecret: 'short' })).toThrow(/at least 16/);
  });

  describe('end to end with the real server helpers', () => {
    it('initialize → approved payment → validateTransaction passes', async () => {
      const sim = makeSim();
      const { checkoutToken, secretToken } = await init(sim, { invoiceNumber: 'INV-1/2' });
      expect(await sim.getSecretToken(checkoutToken)).toBe(secretToken);

      const event = await sim.simulatePayment({ checkoutToken, cardHolderName: 'Renée Test' });
      expect(event.eventStatus).toBe('SUCCESS');
      expect(typeof event.eventMessage).toBe('string');
      // Encoded like PHP: escaped slashes and unicode.
      expect(event.eventMessage).toContain('INV-1\\/2');
      expect(event.eventMessage).not.toContain('é');

      const result = await validateTransaction({
        eventMessage: event.eventMessage,
        secretToken,
        expected: { amount: 15.45, currency: 'CAD' },
      });
      expect(result).toMatchObject({ valid: true, encoding: 'php' });
      if (result.valid) {
        expect(result.transaction).toMatchObject({
          status: 'APPROVED',
          amount: 15.45,
          currency: 'CAD',
          invoiceNumber: 'INV-1/2',
          cardHolderName: 'Renée Test',
          cardNumber: '424242******4242',
        });
      }
    });

    it('encodes integral amounts as PHP floats (10 → 10.0) and still validates', async () => {
      const sim = makeSim();
      const { checkoutToken, secretToken } = await init(sim, { amount: 10 });
      const event = await sim.simulatePayment({ checkoutToken });
      expect(event.eventMessage).toContain('"amount":10.0');
      await expect(
        validateTransaction({
          eventMessage: event.eventMessage,
          secretToken,
          expected: { amount: 10 },
        }),
      ).resolves.toMatchObject({ valid: true });
    });

    it('fails validation with the wrong secret or a tampered amount', async () => {
      const sim = makeSim();
      const a = await init(sim);
      const b = await init(sim);
      const event = await sim.simulatePayment({ checkoutToken: a.checkoutToken });
      await expect(
        validateTransaction({ eventMessage: event.eventMessage, secretToken: b.secretToken }),
      ).resolves.toMatchObject({ valid: false, reason: 'HASH_MISMATCH' });
      await expect(
        validateTransaction({
          eventMessage: event.eventMessage.replace('15.45', '0.01'),
          secretToken: a.secretToken,
        }),
      ).resolves.toMatchObject({ valid: false, reason: 'HASH_MISMATCH' });
    });

    it('issues a different token for identical requests', async () => {
      const sim = makeSim();
      expect((await init(sim)).checkoutToken).not.toBe((await init(sim)).checkoutToken);
    });
  });

  describe('initialize', () => {
    it('requires an api-token header, and the configured one if set', async () => {
      const sim = makeSim({ apiToken: 'expected' });
      await expect(init(sim)).rejects.toMatchObject({ code: 'INIT_FAILED', status: 401 });
      await expect(init(sim).catch((e) => e.message)).resolves.toMatch(/Unauthorized/);
      const res = await sim.fetch(`${sim.apiBaseUrl}/helcim-pay/initialize`, {
        method: 'POST',
        body: '{}',
      });
      expect(res.status).toBe(401);
      await expect(
        initializeCheckout({
          apiToken: 'expected',
          apiBaseUrl: sim.apiBaseUrl,
          fetch: sim.fetch,
          paymentType: 'purchase',
          amount: 1,
          currency: 'USD',
        }),
      ).resolves.toHaveProperty('checkoutToken');
    });

    it.each([
      [{ paymentType: 'refund' }, /paymentType/],
      [{ currency: 'EUR' }, /currency/],
      [{ amount: 1.005 }, /2 decimal/],
      [{ amount: 0 }, /greater than 0/],
    ])(
      'rejects invalid body %j like Helcim (HTTP 400 with field errors)',
      async (body, message) => {
        await expect(init(makeSim(), body)).rejects.toMatchObject({
          code: 'INIT_FAILED',
          status: 400,
          message: expect.stringMatching(message),
        });
      },
    );

    it('allows amount 0 for verify', async () => {
      await expect(init(makeSim(), { paymentType: 'verify', amount: 0 })).resolves.toHaveProperty(
        'secretToken',
      );
    });
  });

  describe('simulatePayment', () => {
    it.each([
      ['declined', /Card declined/],
      ['insufficient-funds', /Insufficient funds/],
      ['processing-error', /Processor error/],
    ])('%s card → ABORTED with a HelcimPay.js-style message', async (outcome, message) => {
      const sim = makeSim();
      const { checkoutToken } = await init(sim);
      const event = await sim.simulatePayment({ checkoutToken, cardNumber: card(outcome) });
      expect(event.eventStatus).toBe('ABORTED');
      expect(event.eventMessage).toMatch(/^HelcimPay\.js transaction failed - /);
      expect(event.eventMessage).toMatch(message);
    });

    it('accepts formatted card numbers', async () => {
      const sim = makeSim();
      const { checkoutToken } = await init(sim);
      const event = await sim.simulatePayment({ checkoutToken, cardNumber: '5555 5555 5555 4444' });
      expect(event.eventStatus).toBe('SUCCESS');
    });

    it.each([
      [{ cardNumber: '4111111111111111' }, 'cardNumber', /test cards only/],
      [{ cardExpiry: '01/20' }, 'cardExpiry', /expired/],
      [{ cardExpiry: '13/40' }, 'cardExpiry', /01-12/],
      [{ cardExpiry: '1240' }, 'cardExpiry', /MM\/YY/],
      [{ cardCvv: '12' }, 'cardCvv', /3 or 4/],
    ])('rejects %j with a field error', async (input, field, message) => {
      const sim = makeSim();
      const { checkoutToken } = await init(sim);
      const error = await sim.simulatePayment({ checkoutToken, ...input }).catch((e) => e);
      expect(error).toBeInstanceOf(SimulatorInputError);
      expect(error.status).toBe(422);
      expect(error.errors[field]).toMatch(message);
    });

    it('rejects tampered and expired tokens', async () => {
      let now = Date.now();
      const sim = makeSim({ now: () => now, tokenTtlMs: 1000 });
      const { checkoutToken } = await init(sim);
      const [payload, sig] = checkoutToken.split('.');
      const tampered = `${payload}x.${sig}`;
      await expect(sim.simulatePayment({ checkoutToken: tampered })).rejects.toMatchObject({
        status: 400,
      });
      await expect(sim.simulatePayment({ checkoutToken: 'garbage' })).rejects.toMatchObject({
        status: 400,
      });
      now += 1001;
      await expect(sim.simulatePayment({ checkoutToken })).rejects.toMatchObject({
        status: 410,
        message: /expired/,
      });
    });

    it('rejects tokens signed with a different secret', async () => {
      const other = createHelcimSimulator({ signingSecret: 'another-secret-value-123' });
      const { checkoutToken } = await init(other);
      await expect(makeSim().simulatePayment({ checkoutToken })).rejects.toMatchObject({
        status: 400,
      });
    });
  });

  describe('HTTP routes via handle()', () => {
    const get = (sim: ReturnType<typeof makeSim>, path: string) =>
      sim.handle(new Request(`${ORIGIN}${path}`));

    it('serves start.js pointing at the absolute checkout URL', async () => {
      const res = await get(makeSim(), '/mock-helcim/start.js');
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toMatch(/javascript/);
      const js = await res.text();
      expect(js).toContain('"http://localhost:3000/mock-helcim/checkout/"');
      expect(() => new Function(js)).not.toThrow();
    });

    it('honours a custom basePath', async () => {
      const sim = makeSim({ basePath: '/api/helcim-sim/' });
      expect(sim.basePath).toBe('/api/helcim-sim');
      expect((await get(sim, '/api/helcim-sim/start.js')).status).toBe(200);
      expect((await get(sim, '/mock-helcim/start.js')).status).toBe(404);
    });

    it('renders the checkout page with the amount, test cards and valid inline JS', async () => {
      const sim = makeSim();
      const { checkoutToken } = await init(sim, { invoiceNumber: '<script>alert(1)</script>' });
      const res = await get(
        sim,
        `/mock-helcim/checkout/${encodeURIComponent(checkoutToken)}?allowExit=1`,
      );
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('no-store');
      const html = await res.text();
      expect(html).toContain('$15.45 CAD');
      expect(html).toContain('4242 4242 4242 4242');
      expect(html).toContain('aria-label="Close payment window"');
      // The invoice number is escaped, never injected as markup.
      expect(html).not.toContain('<script>alert(1)</script>');
      expect(html).toContain('&#60;script&#62;');

      const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]!);
      expect(scripts).toHaveLength(1);
      expect(() => new Function(scripts[0]!)).not.toThrow();
      expect(scripts[0]).toContain(`"eventName":"helcim-pay-js-${checkoutToken}"`);
    });

    it('omits the close button when allowExit=0', async () => {
      const sim = makeSim();
      const { checkoutToken } = await init(sim);
      const html = await (
        await get(sim, `/mock-helcim/checkout/${checkoutToken}?allowExit=0`)
      ).text();
      expect(html).not.toContain('aria-label="Close payment window"');
      expect(html).toContain('"allowExit":false');
    });

    it('renders an error page for a bad token', async () => {
      const res = await get(makeSim(), '/mock-helcim/checkout/nope');
      expect(res.status).toBe(410);
      expect(await res.text()).toContain('Checkout unavailable');
    });

    it('processes payments over POST /process', async () => {
      const sim = makeSim();
      const { checkoutToken } = await init(sim);
      const post = (body: unknown) =>
        sim.handle(
          new Request(`${ORIGIN}/mock-helcim/process`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          }),
        );
      const ok = await post({
        checkoutToken,
        cardNumber: '4242 4242 4242 4242',
        cardExpiry: '12/40',
        cardCvv: '123',
      });
      expect(ok.status).toBe(200);
      expect(await ok.json()).toMatchObject({
        eventStatus: 'SUCCESS',
        eventMessage: expect.any(String),
      });

      const bad = await post({
        checkoutToken,
        cardNumber: '4111 1111 1111 1111',
        cardExpiry: '12/40',
        cardCvv: '123',
      });
      expect(bad.status).toBe(422);
      expect(await bad.json()).toMatchObject({ errors: { cardNumber: expect.any(String) } });
    });

    it('returns 400 for a non-JSON body and 404 for unknown routes', async () => {
      const sim = makeSim();
      const res = await sim.handle(
        new Request(`${ORIGIN}/mock-helcim/process`, { method: 'POST', body: 'not json' }),
      );
      expect(res.status).toBe(400);
      expect((await get(sim, '/mock-helcim/nope')).status).toBe(404);
      expect((await get(sim, '/elsewhere')).status).toBe(404);
    });
  });
});
