import { isHelcimPayError, type HelcimCurrency, type HelcimTransaction } from '../types';
import { initializeCheckout, type HelcimCheckoutRequest } from './initializeCheckout';
import { seal, unseal } from './seal';
import { validateTransaction, type ValidationFailureReason } from './validateTransaction';

/** What to charge. Always computed on your server, never taken from the browser. */
export interface CheckoutOrder extends Partial<Pick<HelcimCheckoutRequest, 'paymentType'>> {
  amount: number;
  currency: HelcimCurrency;
  invoiceNumber?: string;
  customerCode?: string;
  /** Any other `initialize` field (e.g. `confirmationScreen`, `taxAmount`). */
  [key: string]: unknown;
}

export interface CheckoutHandlersOptions<TInput> {
  /** Your Helcim API token (server-side env var). */
  apiToken: string;
  /** At least 32 random characters. Encrypts the per-checkout cookie that holds the secret token. */
  cookieSecret: string;
  /**
   * Turns the browser's request body (e.g. cart item IDs) into the amount
   * to charge. Throw an `Error` to reject the request with HTTP 400; its
   * message is sent to the client.
   */
  getOrder: (input: TInput, request: Request) => CheckoutOrder | Promise<CheckoutOrder>;
  /** Runs after a transaction is verified. Fulfil the order here. Throwing turns the validation into a 500. */
  onVerified?: (event: {
    transaction: HelcimTransaction;
    order: CheckoutSummary;
    request: Request;
  }) => void | Promise<void>;
  /** Override for tests or the simulator. */
  apiBaseUrl?: string;
  fetch?: typeof fetch;
  /** Default `helcim_checkout`. */
  cookieName?: string;
  /** Cookie `Path`. Default `/`. */
  cookiePath?: string;
}

/** Body the hook's `validate` step posts (see `createCheckoutClient`). */
export interface ValidateRequestBody {
  checkoutToken: string;
  eventMessage: unknown;
}

export type ValidateResponseBody =
  | { valid: true; transaction: HelcimTransaction }
  | { valid: false; reason: ValidationFailureReason | 'NO_SESSION'; message: string };

/** The parts of the order that are kept with the checkout session and checked on validation. */
export interface CheckoutSummary {
  amount: number;
  currency: string;
  invoiceNumber?: string;
}

interface SealedCheckout {
  checkoutToken: string;
  secretToken: string;
  order: CheckoutSummary;
  exp: number;
}

const TTL_SECONDS = 60 * 60;

/**
 * Ready-made `initialize` and `validate` endpoints for HelcimPay.js. They
 * use the standard `Request`/`Response` types, so they work as Next.js App
 * Router route handlers, and in Remix, Hono, SvelteKit and Workers.
 *
 * - The amount comes from `getOrder()` on the server, never from the browser.
 * - The `secretToken` never reaches the browser. It is kept in an AES-GCM
 *   encrypted, httpOnly, SameSite=Strict cookie, so no database is needed.
 * - Validation checks the hash, the approval status, and the amount and
 *   currency against the original order. On success it clears the cookie,
 *   so the same receipt can't be replayed.
 *
 * @example
 * // app/api/checkout/[action]/route.ts
 * const { initialize, validate } = createCheckoutHandlers({ apiToken, cookieSecret, getOrder });
 */
export function createCheckoutHandlers<TInput = unknown>(options: CheckoutHandlersOptions<TInput>) {
  const { cookieSecret, cookieName = 'helcim_checkout', cookiePath = '/' } = options;
  if (!cookieSecret || cookieSecret.length < 32) {
    throw new Error('createCheckoutHandlers: cookieSecret must be at least 32 characters');
  }

  const cookie = (request: Request, value: string, maxAge: number) => {
    const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
    return `${cookieName}=${value}; Path=${cookiePath}; Max-Age=${maxAge}; HttpOnly; SameSite=Strict${secure}`;
  };

  async function initialize(request: Request): Promise<Response> {
    let input: TInput;
    try {
      input = (await request.json()) as TInput;
    } catch {
      return json(400, { error: 'Request body must be JSON' });
    }

    let order: CheckoutOrder;
    try {
      order = await options.getOrder(input, request);
    } catch (error) {
      return json(400, { error: error instanceof Error ? error.message : 'Invalid order' });
    }

    try {
      const session = await initializeCheckout({
        paymentType: 'purchase',
        ...order,
        apiToken: options.apiToken,
        apiBaseUrl: options.apiBaseUrl,
        fetch: options.fetch,
      });
      const sealed = await seal(cookieSecret, {
        checkoutToken: session.checkoutToken,
        secretToken: session.secretToken,
        order: {
          amount: order.amount,
          currency: order.currency,
          invoiceNumber: order.invoiceNumber,
        },
        exp: session.expiresAt.getTime(),
      } satisfies SealedCheckout);

      return json(
        200,
        { checkoutToken: session.checkoutToken, expiresAt: session.expiresAt.toISOString() },
        { 'set-cookie': cookie(request, sealed, TTL_SECONDS) },
      );
    } catch (error) {
      const message = isHelcimPayError(error) ? error.message : 'Could not start checkout';
      return json(502, { error: message, code: isHelcimPayError(error) ? error.code : 'UNKNOWN' });
    }
  }

  async function validate(request: Request): Promise<Response> {
    let body: Partial<ValidateRequestBody>;
    try {
      body = (await request.json()) as Partial<ValidateRequestBody>;
    } catch {
      return json(400, { error: 'Request body must be JSON' });
    }

    const raw = readCookie(request.headers.get('cookie'), cookieName);
    const checkout = raw ? await unseal<SealedCheckout>(cookieSecret, raw) : undefined;
    if (!checkout || checkout.exp < Date.now() || checkout.checkoutToken !== body.checkoutToken) {
      return json(400, {
        valid: false,
        reason: 'NO_SESSION',
        message: 'No matching checkout session. It may have expired or already been verified.',
      } satisfies ValidateResponseBody);
    }

    const result = await validateTransaction({
      eventMessage: body.eventMessage,
      secretToken: checkout.secretToken,
      expected: { amount: checkout.order.amount, currency: checkout.order.currency },
    });
    if (!result.valid) {
      return json(400, {
        valid: false,
        reason: result.reason,
        message: result.message,
      } satisfies ValidateResponseBody);
    }

    try {
      await options.onVerified?.({
        transaction: result.transaction,
        order: checkout.order,
        request,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Order fulfilment failed';
      return json(500, { error: message });
    }

    return json(
      200,
      { valid: true, transaction: result.transaction } satisfies ValidateResponseBody,
      {
        'set-cookie': cookie(request, '', 0),
      },
    );
  }

  return { initialize, validate };
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
  });
}

function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return undefined;
}
