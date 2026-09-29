import { sha256Hex } from '../server/crypto';
import { encodeJson, fromValue } from '../shared/json';
import type { HelcimPayEventStatus, HelcimTransaction } from '../types';
import { renderCheckoutPage } from './checkoutPage';
import { renderStartScript } from './startScript';
import { DECLINE_MESSAGES, findTestCard, TEST_CARDS, type TestCard } from './testCards';
import {
  deriveSecretToken,
  randomHex,
  signSession,
  verifySession,
  type SimulatorSession,
} from './token';

export interface HelcimSimulatorOptions {
  /** Secret for signing simulator checkout tokens. Use at least 32 random characters. */
  signingSecret: string;
  /** Where the simulator's routes live. Default `/mock-helcim`. */
  basePath?: string;
  /** Checkout token lifetime. Default 60 minutes, like Helcim. */
  tokenTtlMs?: number;
  /** If set, `initialize` requires this exact `api-token` header. Otherwise any non-empty token works. */
  apiToken?: string;
  /** Clock override for tests. */
  now?: () => number;
}

export interface SimulatedPaymentInput {
  checkoutToken: string;
  /** Defaults to the approved Visa test card. */
  cardNumber?: string;
  /** `MM/YY`. Defaults to next year. */
  cardExpiry?: string;
  cardCvv?: string;
  cardHolderName?: string;
}

/** What the HelcimPay.js iframe would post to the parent window. */
export interface SimulatedPaymentEvent {
  eventStatus: Extract<HelcimPayEventStatus, 'SUCCESS' | 'ABORTED'>;
  /** SUCCESS: a JSON string `{"data":{"hash":…,"data":{…}}}`. ABORTED: an error string. */
  eventMessage: string;
  transaction?: HelcimTransaction;
}

export class SimulatorInputError extends Error {
  override readonly name = 'SimulatorInputError';
  constructor(
    readonly status: number,
    readonly errors: Record<string, string> | string,
  ) {
    super(typeof errors === 'string' ? errors : Object.values(errors).join('; '));
  }
}

export interface HelcimSimulator {
  readonly basePath: string;
  /**
   * An `apiBaseUrl` for `initializeCheckout` together with `simulator.fetch`,
   * so the simulator runs in-process with no HTTP.
   */
  readonly apiBaseUrl: string;
  /** `initializeCheckout({ apiBaseUrl: simulator.apiBaseUrl, fetch: simulator.fetch, ... })`. */
  fetch: typeof fetch;
  /** Handles every simulator route. Mount it on `${basePath}/*` for GET and POST. */
  handle: (request: Request) => Promise<Response>;
  /** Runs a payment directly, without the iframe UI (tests, scripts). */
  simulatePayment: (input: SimulatedPaymentInput) => Promise<SimulatedPaymentEvent>;
  /** The secret token for a checkout token (what `initialize` returned). */
  getSecretToken: (checkoutToken: string) => Promise<string>;
}

const PAYMENT_TYPES = new Set(['purchase', 'preauth', 'verify']);
const CURRENCIES = new Set(['CAD', 'USD']);

/**
 * An in-memory, stateless stand-in for Helcim's HelcimPay.js backend and
 * iframe. It follows the published API: the same initialize request and
 * response, the same `start.js` globals, the same `postMessage` events and
 * the same SHA-256 response hash. So your integration runs its real code
 * paths with no Helcim account.
 *
 * Routes (under `basePath`):
 *  - `POST /v2/helcim-pay/initialize`: create a checkout session
 *  - `GET  /start.js`: the `appendHelcimPayIframe` / `removeHelcimPayIframe` script
 *  - `GET  /checkout/:token`: the payment modal page loaded in the iframe
 *  - `POST /process`: charges a test card (used by the modal page)
 */
export function createHelcimSimulator(options: HelcimSimulatorOptions): HelcimSimulator {
  const {
    signingSecret,
    basePath: rawBasePath = '/mock-helcim',
    tokenTtlMs = 60 * 60 * 1000,
    apiToken,
    now = Date.now,
  } = options;
  if (!signingSecret || signingSecret.length < 16) {
    throw new Error('createHelcimSimulator: signingSecret must be at least 16 characters');
  }
  const basePath = `/${rawBasePath.replace(/^\/+|\/+$/g, '')}`;

  async function initialize(
    body: unknown,
  ): Promise<{ checkoutToken: string; secretToken: string }> {
    const input = (body ?? {}) as Record<string, unknown>;
    const errors: Record<string, string> = {};
    if (!PAYMENT_TYPES.has(input.paymentType as string)) {
      errors.paymentType = 'paymentType must be one of purchase, preauth, verify';
    }
    if (!CURRENCIES.has(input.currency as string)) {
      errors.currency = 'currency must be CAD or USD';
    }
    const amount = input.amount;
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) {
      errors.amount = 'amount must be a non-negative number';
    } else if (Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-6) {
      errors.amount = 'amount must have at most 2 decimal places';
    } else if (input.paymentType !== 'verify' && amount === 0) {
      errors.amount = 'amount must be greater than 0';
    }
    if (Object.keys(errors).length) throw new SimulatorInputError(400, errors);

    const session: SimulatorSession = {
      v: 1,
      paymentType: input.paymentType as SimulatorSession['paymentType'],
      amount: amount as number,
      currency: input.currency as SimulatorSession['currency'],
      invoiceNumber: typeof input.invoiceNumber === 'string' ? input.invoiceNumber : undefined,
      customerCode: typeof input.customerCode === 'string' ? input.customerCode : undefined,
      confirmationScreen: input.confirmationScreen === true ? true : undefined,
      exp: now() + tokenTtlMs,
      n: randomHex(6),
    };
    const checkoutToken = await signSession(signingSecret, session);
    return { checkoutToken, secretToken: await deriveSecretToken(signingSecret, checkoutToken) };
  }

  async function loadSession(checkoutToken: string): Promise<SimulatorSession> {
    const result = await verifySession(signingSecret, checkoutToken, now());
    if (!result.ok) {
      throw new SimulatorInputError(
        result.reason === 'expired' ? 410 : 400,
        result.reason === 'expired' ? 'Checkout session has expired' : 'Invalid checkout token',
      );
    }
    return result.session;
  }

  async function simulatePayment(input: SimulatedPaymentInput): Promise<SimulatedPaymentEvent> {
    const session = await loadSession(input.checkoutToken);
    const errors: Record<string, string> = {};

    const card = findTestCard(input.cardNumber ?? TEST_CARDS[0]!.number);
    if (!card) {
      errors.cardNumber = 'Simulator accepts test cards only. Use one of the listed numbers.';
    }
    const expiry = input.cardExpiry ?? defaultExpiry(now());
    const expiryError = checkExpiry(expiry, now());
    if (expiryError) errors.cardExpiry = expiryError;
    const cvv = (input.cardCvv ?? '123').trim();
    if (!/^\d{3,4}$/.test(cvv)) errors.cardCvv = 'CVV must be 3 or 4 digits';
    if (Object.keys(errors).length) throw new SimulatorInputError(422, errors);

    if (card!.outcome !== 'approved') {
      return { eventStatus: 'ABORTED', eventMessage: DECLINE_MESSAGES[card!.outcome] };
    }

    const transaction = buildTransaction(session, card!, input.cardHolderName, now());
    // Encode like Helcim's PHP backend: json_encode, with floats kept as floats.
    const dataJson = encodeJson(fromValue(transaction, new Set(['amount'])), 'php');
    const secretToken = await deriveSecretToken(signingSecret, input.checkoutToken);
    const hash = await sha256Hex(dataJson + secretToken);
    return {
      eventStatus: 'SUCCESS',
      eventMessage: `{"data":{"hash":"${hash}","data":${dataJson}}}`,
      transaction,
    };
  }

  async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith(`${basePath}/`)) return json(404, { errors: 'Not found' });
    const route = url.pathname.slice(basePath.length);

    try {
      if (request.method === 'POST' && route === '/v2/helcim-pay/initialize') {
        const token = request.headers.get('api-token');
        if (!token || (apiToken !== undefined && token !== apiToken)) {
          return json(401, { errors: 'Unauthorized: missing or invalid api-token header' });
        }
        return json(200, await initialize(await readJson(request)));
      }

      if (request.method === 'GET' && route === '/start.js') {
        return new Response(renderStartScript(`${url.origin}${basePath}/checkout/`), {
          headers: {
            'content-type': 'text/javascript; charset=utf-8',
            'cache-control': 'public, max-age=300',
          },
        });
      }

      const checkoutMatch = /^\/checkout\/([^/]+)$/.exec(route);
      if (request.method === 'GET' && checkoutMatch) {
        const checkoutToken = decodeURIComponent(checkoutMatch[1]!);
        const allowExit = url.searchParams.get('allowExit') !== '0';
        let session: SimulatorSession | undefined;
        let error: string | undefined;
        try {
          session = await loadSession(checkoutToken);
        } catch (e) {
          error = e instanceof SimulatorInputError ? e.message : 'Invalid checkout token';
        }
        const html = renderCheckoutPage({
          checkoutToken,
          allowExit,
          processUrl: `${basePath}/process`,
          session,
          error,
          testCards: TEST_CARDS,
        });
        return new Response(html, {
          status: session ? 200 : 410,
          headers: {
            'content-type': 'text/html; charset=utf-8',
            'cache-control': 'no-store',
            'referrer-policy': 'no-referrer',
          },
        });
      }

      if (request.method === 'POST' && route === '/process') {
        const body = (await readJson(request)) as Record<string, unknown>;
        const event = await simulatePayment({
          checkoutToken: String(body.checkoutToken ?? ''),
          cardNumber: String(body.cardNumber ?? ''),
          cardExpiry: String(body.cardExpiry ?? ''),
          cardCvv: String(body.cardCvv ?? ''),
          cardHolderName: typeof body.cardHolderName === 'string' ? body.cardHolderName : undefined,
        });
        return json(200, { eventStatus: event.eventStatus, eventMessage: event.eventMessage });
      }

      return json(404, { errors: 'Not found' });
    } catch (error) {
      if (error instanceof SimulatorInputError) return json(error.status, { errors: error.errors });
      throw error;
    }
  }

  const simulatorFetch: typeof fetch = (input, init) => handle(new Request(input, init));

  return {
    basePath,
    apiBaseUrl: `https://helcim-simulator.invalid${basePath}/v2`,
    fetch: simulatorFetch,
    handle,
    simulatePayment,
    getSecretToken: (checkoutToken) => deriveSecretToken(signingSecret, checkoutToken),
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new SimulatorInputError(400, 'Request body must be JSON');
  }
}

function defaultExpiry(nowMs: number): string {
  const d = new Date(nowMs);
  return `12/${String((d.getUTCFullYear() + 1) % 100).padStart(2, '0')}`;
}

function checkExpiry(expiry: string, nowMs: number): string | undefined {
  const m = /^(\d{2})\s*\/\s*(\d{2})$/.exec(expiry.trim());
  if (!m) return 'Expiry must be MM/YY';
  const month = Number(m[1]);
  const year = 2000 + Number(m[2]);
  if (month < 1 || month > 12) return 'Expiry month must be 01-12';
  const now = new Date(nowMs);
  const endOfMonth = Date.UTC(year, month, 1); // first moment after the expiry month
  if (endOfMonth <= Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) {
    return 'Card has expired';
  }
  return undefined;
}

function buildTransaction(
  session: SimulatorSession,
  card: TestCard,
  cardHolderName: string | undefined,
  nowMs: number,
): HelcimTransaction {
  const digits = card.number;
  return {
    transactionId: 10_000_000 + Math.floor(Math.random() * 89_999_999),
    dateCreated: new Date(nowMs).toISOString().slice(0, 19).replace('T', ' '),
    cardBatchId: 1000 + Math.floor(Math.random() * 9000),
    status: 'APPROVED',
    type: session.paymentType,
    amount: session.amount,
    currency: session.currency,
    avsResponse: 'X',
    cvvResponse: 'M',
    approvalCode: randomHex(3).toUpperCase(),
    cardToken: randomHex(11),
    cardNumber: `${digits.slice(0, 6)}${'*'.repeat(digits.length - 10)}${digits.slice(-4)}`,
    cardHolderName: cardHolderName?.trim() || 'Test Customer',
    customerCode: session.customerCode ?? '',
    invoiceNumber: session.invoiceNumber ?? '',
    warning: '',
  };
}
