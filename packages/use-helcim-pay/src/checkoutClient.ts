import type { ValidateResponseBody } from './server/checkoutHandlers';
import { HelcimPayError } from './types';
import type { CheckoutTokenResult, ValidatePayload } from './useHelcimPay';

export interface CheckoutClientOptions {
  /** URL of your `initialize` handler, e.g. `/api/checkout/initialize`. */
  initializeUrl: string;
  /** URL of your `validate` handler, e.g. `/api/checkout/validate`. */
  validateUrl: string;
  /** Extra headers (e.g. CSRF token) for both requests. */
  headers?: Record<string, string>;
  fetch?: typeof fetch;
}

/**
 * The browser half of `createCheckoutHandlers`. It returns `getCheckoutToken`
 * and `validate` functions to spread straight into `useHelcimPay`.
 *
 * @example
 * const checkout = createCheckoutClient({
 *   initializeUrl: '/api/checkout/initialize',
 *   validateUrl: '/api/checkout/validate',
 * });
 * const pay = useHelcimPay({ ...checkout, onSuccess });
 */
export function createCheckoutClient<TInput = unknown>(options: CheckoutClientOptions) {
  const doFetch = options.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));

  const post = (url: string, body: unknown, signal?: AbortSignal) =>
    doFetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...options.headers },
      body: JSON.stringify(body ?? {}),
      credentials: 'same-origin',
      signal,
    });

  const readJson = (res: Response) =>
    res.json().catch(() => ({})) as Promise<Record<string, unknown>>;

  return {
    async getCheckoutToken(
      input: TInput,
      { signal }: { signal: AbortSignal },
    ): Promise<CheckoutTokenResult> {
      const res = await post(options.initializeUrl, input, signal);
      const body = await readJson(res);
      if (!res.ok || typeof body.checkoutToken !== 'string') {
        throw new HelcimPayError(
          'INIT_FAILED',
          typeof body.error === 'string'
            ? body.error
            : `Checkout failed to start (HTTP ${res.status})`,
          { status: res.status, details: body },
        );
      }
      return { checkoutToken: body.checkoutToken, expiresAt: body.expiresAt as string | undefined };
    },

    async validate(payload: ValidatePayload): Promise<ValidateResponseBody> {
      const res = await post(options.validateUrl, payload);
      const body = await readJson(res);
      // A 400 with `{ valid: false }` is a real verdict; the hook reports its message.
      if (typeof body.valid === 'boolean') return body as unknown as ValidateResponseBody;
      throw new HelcimPayError(
        'VALIDATION_FAILED',
        typeof body.error === 'string'
          ? body.error
          : `Payment verification failed (HTTP ${res.status})`,
        { status: res.status, details: body },
      );
    },
  };
}
