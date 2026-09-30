import 'server-only';
import { createCheckoutHandlers } from 'use-helcim-pay/server';
import { createHelcimSimulator, type HelcimSimulator } from 'use-helcim-pay/testing';
import { cartTotalCents, CURRENCY, type Cart } from './catalog';

export type HelcimMode = 'mock' | 'live';

export function helcimMode(): HelcimMode {
  const explicit = process.env.HELCIM_MODE?.trim().toLowerCase();
  if (explicit === 'mock' || explicit === 'live') return explicit;
  return process.env.HELCIM_API_TOKEN ? 'live' : 'mock';
}

export const SIMULATOR_BASE_PATH = '/mock-helcim';

/** Reads a secret. In development it falls back to a fixed value, so `npm run dev` just works. */
function secret(name: string, minLength: number): string {
  const value = process.env[name];
  if (value && value.length >= minLength) return value;
  if (process.env.NODE_ENV !== 'production') {
    return `dev-only-${name.toLowerCase()}-not-for-production-use`;
  }
  throw new Error(`Server misconfigured: ${name} must be set (at least ${minLength} characters).`);
}

let simulator: HelcimSimulator | undefined;
export function getSimulator(): HelcimSimulator {
  simulator ??= createHelcimSimulator({
    signingSecret: secret('MOCK_SIGNING_SECRET', 32),
    basePath: SIMULATOR_BASE_PATH,
  });
  return simulator;
}

let handlers: ReturnType<typeof createCheckoutHandlers<Cart>> | undefined;
export function getCheckoutHandlers() {
  if (handlers) return handlers;

  const mode = helcimMode();
  const connection =
    mode === 'live'
      ? { apiToken: secret('HELCIM_API_TOKEN', 1) }
      : {
          apiToken: 'simulator',
          apiBaseUrl: getSimulator().apiBaseUrl,
          fetch: getSimulator().fetch,
        };

  handlers = createCheckoutHandlers<Cart>({
    ...connection,
    cookieSecret: secret('CHECKOUT_COOKIE_SECRET', 32),
    cookiePath: '/api/checkout',
    getOrder: (cart) => ({
      paymentType: 'purchase',
      amount: cartTotalCents(cart) / 100,
      currency: CURRENCY,
      invoiceNumber: `DEMO-${Date.now().toString(36).toUpperCase()}`,
    }),
    onVerified: ({ transaction, order }) => {
      // A real store would mark the order paid and fulfil it here.
      console.info(
        `[demo] verified transaction ${String(transaction.transactionId)} for ${order.amount} ${order.currency} (${order.invoiceNumber})`,
      );
    },
  });
  return handlers;
}
