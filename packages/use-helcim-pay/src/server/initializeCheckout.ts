import {
  HelcimPayError,
  type HelcimCurrency,
  type HelcimPaymentMethod,
  type HelcimPaymentType,
} from '../types';

export const DEFAULT_HELCIM_API_BASE_URL = 'https://api.helcim.com/v2';

/** Body of `POST /v2/helcim-pay/initialize`. See Helcim's "Create a HelcimPay.js Checkout Session". */
export interface HelcimCheckoutRequest {
  paymentType: HelcimPaymentType;
  /** Amount in major units, e.g. `19.99`. Use `0` with `paymentType: 'verify'`. */
  amount: number;
  currency: HelcimCurrency;
  paymentMethod?: HelcimPaymentMethod;
  customerCode?: string;
  invoiceNumber?: string;
  language?: 'en' | 'fr';
  allowPartial?: 0 | 1;
  hasConvenienceFee?: 0 | 1;
  taxAmount?: number;
  hideExistingPaymentDetails?: 0 | 1;
  setAsDefaultPaymentMethod?: 0 | 1;
  terminalId?: number;
  /** Show Helcim's own confirmation screen after payment (it emits `HIDE` when closed). */
  confirmationScreen?: boolean;
  displayContactFields?: 0 | 1;
  customStyling?: Record<string, unknown>;
  /** Any other documented field not typed above; passed through unchanged. */
  [key: string]: unknown;
}

export interface HelcimCheckoutSession {
  /** Safe to send to the browser: it opens the payment modal. */
  checkoutToken: string;
  /** **Server-only.** Used to validate the transaction hash. */
  secretToken: string;
  /** When Helcim stops accepting this checkout token (60 minutes after creation). */
  expiresAt: Date;
}

export interface InitializeCheckoutOptions extends HelcimCheckoutRequest {
  /** Your Helcim API token. Keep it in a server-side env var. */
  apiToken: string;
  /** Override for tests or a simulator. Default `https://api.helcim.com/v2`. */
  apiBaseUrl?: string;
  /** Custom `fetch` (tests, instrumentation). Defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /** Abort the request. */
  signal?: AbortSignal;
}

const CHECKOUT_TOKEN_TTL_MS = 60 * 60 * 1000;

/**
 * Creates a HelcimPay.js checkout session. **Call this on your server only.**
 * It needs your API token, and Helcim blocks browser calls with CORS.
 *
 * @throws {HelcimPayError} code `INIT_FAILED`, with Helcim's error body in `details`.
 */
export async function initializeCheckout(
  options: InitializeCheckoutOptions,
): Promise<HelcimCheckoutSession> {
  const {
    apiToken,
    apiBaseUrl = DEFAULT_HELCIM_API_BASE_URL,
    fetch: fetchImpl = fetch,
    signal,
    ...body
  } = options;

  if (!apiToken) {
    throw new HelcimPayError('INIT_FAILED', 'Missing Helcim API token');
  }
  if (!Number.isFinite(body.amount) || body.amount < 0) {
    throw new HelcimPayError('INIT_FAILED', `Invalid amount: ${String(body.amount)}`);
  }

  let res: Response;
  try {
    res = await fetchImpl(`${apiBaseUrl.replace(/\/+$/, '')}/helcim-pay/initialize`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'api-token': apiToken,
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (cause) {
    throw new HelcimPayError('INIT_FAILED', 'Could not reach the Helcim API', { cause });
  }

  const payload: unknown = await res.json().catch(() => undefined);

  if (!res.ok) {
    throw new HelcimPayError('INIT_FAILED', describeHelcimErrors(payload, res.status), {
      status: res.status,
      details: payload,
    });
  }

  const { checkoutToken, secretToken } = (payload ?? {}) as Record<string, unknown>;
  if (typeof checkoutToken !== 'string' || typeof secretToken !== 'string') {
    throw new HelcimPayError(
      'INIT_FAILED',
      'Helcim response did not include checkoutToken/secretToken',
      {
        status: res.status,
        details: payload,
      },
    );
  }

  return { checkoutToken, secretToken, expiresAt: new Date(Date.now() + CHECKOUT_TOKEN_TTL_MS) };
}

/** Helcim returns `errors` as a string, an array, or a field→message map. Flatten it into one line. */
function describeHelcimErrors(payload: unknown, status: number): string {
  const errors = (payload as { errors?: unknown } | undefined)?.errors;
  let detail: string | undefined;
  if (typeof errors === 'string') detail = errors;
  else if (Array.isArray(errors)) detail = errors.map(String).join('; ');
  else if (errors && typeof errors === 'object') {
    detail = Object.entries(errors as Record<string, unknown>)
      .map(([field, msg]) => `${field}: ${String(msg)}`)
      .join('; ');
  }
  return `Helcim initialize failed (HTTP ${status})${detail ? `: ${detail}` : ''}`;
}
