# use-helcim-pay

A TypeScript-first React hook and server helpers for [HelcimPay.js](https://devdocs.helcim.com/docs/overview-of-helcimpayjs), Helcim's embedded payment modal.

> **Unofficial project.** Not affiliated with, endorsed by, or sponsored by Helcim Inc. See the [Disclaimer](#disclaimer).

```tsx
const { startCheckout, status, error, result } = useHelcimPay({ ...checkoutClient });
```

The package covers the three steps Helcim's docs leave you to wire up by hand:

1. **Initialize.** Create a checkout session on your server (the API token must never reach the browser).
2. **Render.** Load `start.js`, open the iframe, and listen for its `postMessage` events.
3. **Validate.** Verify the transaction hash on your server with the checkout's `secretToken`.

> **Status:** `0.1.0`, not yet published to npm. It was built and tested against Helcim's published documentation and a faithful simulator (see [`use-helcim-pay/testing`](#simulator-use-helcim-paytesting)), not yet against a live Helcim account. See [Limitations](#limitations).

## Contents

- [Entry points](#entry-points)
- [Quick start (Next.js App Router)](#quick-start-nextjs-app-router)
- [Client API](#client-api-use-helcim-pay)
- [Server API](#server-api-use-helcim-payserver)
- [Simulator](#simulator-use-helcim-paytesting)
- [Security model](#security-model)
- [Why the hash check is harder than it looks](#why-the-hash-check-is-harder-than-it-looks)
- [Limitations](#limitations)
- [Disclaimer](#disclaimer)

## Entry points

| Import                   | Runs in                         | What it has                                                                       |
| ------------------------ | ------------------------------- | --------------------------------------------------------------------------------- |
| `use-helcim-pay`         | Browser (marked `"use client"`) | `useHelcimPay`, `createCheckoutClient`, `loadHelcimPayScript`, types, errors      |
| `use-helcim-pay/server`  | Node ≥ 20, Edge, Workers        | `initializeCheckout`, `validateTransaction`, `createCheckoutHandlers`             |
| `use-helcim-pay/testing` | Anywhere                        | `createHelcimSimulator`, `TEST_CARDS`: a stand-in for Helcim, for demos and tests |

The server entry uses only Web standards (`fetch`, `Request`/`Response`, Web Crypto), with no Node built-ins. It ships ESM and CJS builds with type declarations. React 18 or later is an optional peer dependency (only the client entry needs it).

## Quick start (Next.js App Router)

**1. Server route.** One file handles both endpoints.

```ts
// app/api/checkout/[action]/route.ts
import { createCheckoutHandlers } from 'use-helcim-pay/server';

type Cart = { items: { id: string; qty: number }[] };

const { initialize, validate } = createCheckoutHandlers<Cart>({
  apiToken: process.env.HELCIM_API_TOKEN!,
  cookieSecret: process.env.CHECKOUT_COOKIE_SECRET!, // 32+ random characters
  // Price the order on the server. Never trust an amount from the browser.
  getOrder: (cart) => ({ amount: priceCart(cart), currency: 'CAD' }),
  onVerified: ({ transaction, order }) => markOrderPaid(transaction, order),
});

export async function POST(request: Request, ctx: RouteContext<'/api/checkout/[action]'>) {
  const { action } = await ctx.params;
  if (action === 'initialize') return initialize(request);
  if (action === 'validate') return validate(request);
  return new Response('Not found', { status: 404 });
}
```

**2. Client component.**

```tsx
'use client';
import { createCheckoutClient, useHelcimPay } from 'use-helcim-pay';

const checkoutClient = createCheckoutClient<Cart>({
  initializeUrl: '/api/checkout/initialize',
  validateUrl: '/api/checkout/validate',
});

export function PayButton({ cart }: { cart: Cart }) {
  const { startCheckout, status, error, result, isBusy, isOpen } = useHelcimPay({
    ...checkoutClient,
    onSuccess: ({ transaction }) => console.log('paid', transaction.transactionId),
  });

  if (status === 'success')
    return <p>Paid! Transaction {String(result?.transaction.transactionId)}</p>;

  return (
    <>
      <button disabled={isBusy || isOpen} onClick={() => startCheckout(cart)}>
        {status === 'initializing' ? 'Opening…' : status === 'validating' ? 'Verifying…' : 'Pay'}
      </button>
      {error && <p role="alert">{error.message}</p>}
    </>
  );
}
```

That's the whole integration. `createCheckoutHandlers` and `createCheckoutClient` are optional conveniences. The hook accepts any async functions, so you can use your own backend (Express, Rails, Laravel, and so on). See [Bring your own backend](#bring-your-own-backend).

## Client API (`use-helcim-pay`)

### `useHelcimPay(options)`

```ts
function useHelcimPay<TInput = void, TValidation = unknown>(
  options: UseHelcimPayOptions<TInput, TValidation>,
): UseHelcimPayReturn<TInput, TValidation>;
```

#### Options

| Option             | Type                                                                                                | Default               |                                                                                                                                                              |
| ------------------ | --------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `getCheckoutToken` | `(input: TInput, ctx: { signal: AbortSignal }) => Promise<{ checkoutToken, expiresAt? } \| string>` | **required**          | Asks **your server** for a checkout token. Receives whatever you pass to `startCheckout(input)`. The request is aborted on unmount or `reset()`.             |
| `validate`         | `(payload: { checkoutToken, eventMessage }) => Promise<TValidation>`                                | none                  | Sends the SUCCESS message to **your server** for hash validation. Rejecting, or resolving with `{ valid: false }`, fails the checkout. Strongly recommended. |
| `allowExit`        | `boolean`                                                                                           | `true`                | Whether the customer can close the modal.                                                                                                                    |
| `closeOnSuccess`   | `boolean`                                                                                           | `true`                | Remove the modal as soon as payment succeeds. Set `false` if you use Helcim's `confirmationScreen`; the hook then waits for its `HIDE`.                      |
| `scriptUrl`        | `string`                                                                                            | Helcim's `start.js`   | Override it to point at a simulator.                                                                                                                         |
| `allowedOrigins`   | `readonly string[] \| '*'`                                                                          | origin of `scriptUrl` | Origins whose `postMessage` events are accepted.                                                                                                             |
| `onSuccess`        | `(result: HelcimPayResult<TValidation>) => void`                                                    |                       | Called once, after validation.                                                                                                                               |
| `onDeclined`       | `(error: HelcimPayError) => void`                                                                   |                       | The card was declined (`ABORTED`). The modal stays open for another card.                                                                                    |
| `onClose`          | `() => void`                                                                                        |                       | The customer closed the modal without paying.                                                                                                                |
| `onError`          | `(error: HelcimPayError) => void`                                                                   |                       | Any failure other than a decline.                                                                                                                            |

Callbacks always use their latest values, so you don't need to memoize them.

#### Return value

| Field           | Type                                   |                                                                                                                       |
| --------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `startCheckout` | `(input: TInput) => Promise<void>`     | Starts a checkout. Ignored while one is already in progress.                                                          |
| `status`        | `HelcimPayStatus`                      | See the state machine below.                                                                                          |
| `error`         | `HelcimPayError \| null`               | Set for `declined` and `error`.                                                                                       |
| `result`        | `HelcimPayResult<TValidation> \| null` | Set on `success`: `{ checkoutToken, transaction, response?, validation?, verified }`.                                 |
| `checkoutToken` | `string \| null`                       | The current session's token.                                                                                          |
| `isBusy`        | `boolean`                              | `true` while `initializing`, `open` or `validating`.                                                                  |
| `isOpen`        | `boolean`                              | `true` while the modal is on screen. After a decline the modal may still be open, so check this rather than `status`. |
| `reset`         | `() => void`                           | Closes the modal, cancels pending work and returns to `idle`.                                                         |

#### State machine

```text
idle ──startCheckout──▶ initializing ──▶ open ──SUCCESS──▶ validating ──▶ success
                            │             │  ▲                  │
                            ▼             │  └─(retry card)─┐   ▼
                          error         ABORTED ──▶ declined  error
                                          │
                                         HIDE ──▶ closed
```

| Status         | Meaning                                                                                            |
| -------------- | -------------------------------------------------------------------------------------------------- |
| `idle`         | Nothing has happened yet.                                                                          |
| `initializing` | Loading `start.js` and fetching a checkout token (in parallel).                                    |
| `open`         | The payment modal is showing.                                                                      |
| `declined`     | The card was declined. The customer can try another card in the same modal (`isOpen`) or close it. |
| `validating`   | Payment approved; waiting for your server's verdict.                                               |
| `success`      | Approved, and verified if you passed `validate`.                                                   |
| `closed`       | The customer closed the modal without paying.                                                      |
| `error`        | Something failed; see `error.code`.                                                                |

#### Errors

Every error is a `HelcimPayError` (`instanceof Error`) with a stable `code`. Use `isHelcimPayError(value)` to narrow it; it works across bundles.

| `code`               | When                                                                           |
| -------------------- | ------------------------------------------------------------------------------ |
| `SCRIPT_LOAD_FAILED` | `start.js` failed to load (network, CSP or a content blocker).                 |
| `INIT_FAILED`        | `getCheckoutToken` rejected or returned no token.                              |
| `TOKEN_EXPIRED`      | The modal stayed open past the token's expiry (60 minutes by default).         |
| `DECLINED`           | The card was declined (`ABORTED`). `message` holds Helcim's text.              |
| `VALIDATION_FAILED`  | `validate` rejected or returned `{ valid: false }`.                            |
| `INVALID_MESSAGE`    | A SUCCESS message could not be parsed, and there was no validator to defer to. |
| `UNKNOWN`            | `appendHelcimPayIframe` threw.                                                 |

`HelcimPayError` also has `status` (the HTTP status, when relevant) and `details` (the raw body or cause).

### `createCheckoutClient(options)`

The browser half of `createCheckoutHandlers`. It returns `{ getCheckoutToken, validate }` for the hook.

```ts
createCheckoutClient<TInput>({
  initializeUrl: string;
  validateUrl: string;
  headers?: Record<string, string>; // e.g. a CSRF token
  fetch?: typeof fetch;
});
```

Requests are JSON `POST`s with `credentials: 'same-origin'`. A `{ valid: false }` response comes back as data; the hook turns it into `VALIDATION_FAILED` with the server's message. Other non-2xx responses throw a `HelcimPayError`.

### Other exports

- `loadHelcimPayScript(src?)` loads `start.js` once per URL and resolves with `{ appendHelcimPayIframe, removeHelcimPayIframe }`. On failure it removes the tag so a later call can retry.
- `parseEventMessage(eventMessage)` normalizes a SUCCESS message into `{ data, hash, rawData? }`.
- All types: `HelcimTransaction`, `HelcimPayStatus`, `HelcimPayResult`, `HelcimPayErrorCode`, and more.

### Bring your own backend

The hook only needs two async functions:

```ts
useHelcimPay({
  getCheckoutToken: async (cart, { signal }) => {
    const res = await fetch('/checkout', { method: 'POST', body: JSON.stringify(cart), signal });
    return res.json(); // { checkoutToken } — keep the secretToken on the server
  },
  validate: async ({ checkoutToken, eventMessage }) => {
    const res = await fetch('/checkout/verify', {
      method: 'POST',
      body: JSON.stringify({ checkoutToken, eventMessage }), // send eventMessage unmodified
    });
    return res.json(); // { valid: boolean, message? }
  },
});
```

If your backend isn't JavaScript, port the hash check carefully (see [below](#why-the-hash-check-is-harder-than-it-looks)).

## Server API (`use-helcim-pay/server`)

### `initializeCheckout(options)`

Calls `POST https://api.helcim.com/v2/helcim-pay/initialize`.

```ts
const { checkoutToken, secretToken, expiresAt } = await initializeCheckout({
  apiToken: process.env.HELCIM_API_TOKEN!,
  paymentType: 'purchase', // 'purchase' | 'preauth' | 'verify'
  amount: 19.99,
  currency: 'CAD', // 'CAD' | 'USD'
  invoiceNumber: 'INV-1043', // optional; other documented fields are typed or passed through
  // apiBaseUrl, fetch, signal: optional overrides
});
```

It throws `HelcimPayError('INIT_FAILED')` with Helcim's `errors` flattened into the message, plus `status` and `details`. **Send only `checkoutToken` to the browser.**

### `validateTransaction(options)`

```ts
const result = await validateTransaction({
  eventMessage, // exactly as the browser received it
  secretToken, // from initializeCheckout, kept server-side
  expected: { amount: 19.99, currency: 'CAD' }, // recommended
  requireApproved: true, // default
});

if (result.valid) {
  result.transaction; // HelcimTransaction
} else {
  result.reason; // 'MALFORMED_MESSAGE' | 'HASH_MISMATCH' | 'NOT_APPROVED' | 'AMOUNT_MISMATCH' | 'CURRENCY_MISMATCH'
}
```

It never throws. It compares hashes in constant time, and compares amounts in cents.

### `createCheckoutHandlers(options)`

Returns `{ initialize, validate }`, both `(request: Request) => Promise<Response>`. They work in the Next.js App Router, Remix, Hono, SvelteKit, Cloudflare Workers and Deno.

| Option                                        |                                                                                                                                                   |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apiToken`                                    | Your Helcim API token.                                                                                                                            |
| `cookieSecret`                                | 32+ characters. Encrypts the session cookie (AES-256-GCM).                                                                                        |
| `getOrder(input, request)`                    | Turns the browser's request body into `{ amount, currency, paymentType?, invoiceNumber?, … }`. Throw an `Error` to return a 400 with its message. |
| `onVerified({ transaction, order, request })` | Optional. Fulfil the order. If it throws, `validate` returns a 500 and keeps the session, so the client can retry.                                |
| `cookieName`, `cookiePath`                    | Default `helcim_checkout` and `/`.                                                                                                                |
| `apiBaseUrl`, `fetch`                         | Overrides, for example for the simulator.                                                                                                         |

What they do:

- **`initialize`** calls `getOrder`, then `initializeCheckout`. It stores `{ checkoutToken, secretToken, order, exp }` in an encrypted `HttpOnly; SameSite=Strict` cookie (`Secure` on HTTPS) and responds with `{ checkoutToken, expiresAt }`.
- **`validate`** decrypts the cookie, checks the checkout token matches, and runs `validateTransaction` against the **original order's** amount and currency. On success it responds `200 { valid: true, transaction }` and clears the cookie, so a receipt can't be replayed. On failure it responds `400 { valid: false, reason, message }`.

Also exported: `seal` / `unseal` (the cookie encryption), `sha256Hex`, `phpJsonEncode`, `parseEventMessage`.

## Simulator (`use-helcim-pay/testing`)

`createHelcimSimulator()` stands in for Helcim's backend and payment modal, following the published API. Your integration runs its real code paths with no Helcim account, in local dev, in CI, or in a public demo.

```ts
import { createHelcimSimulator } from 'use-helcim-pay/testing';

const simulator = createHelcimSimulator({
  signingSecret: process.env.MOCK_SIGNING_SECRET!, // 32+ random characters recommended
  basePath: '/mock-helcim',                        // default
});

// Serve it. In Next.js: app/mock-helcim/[...path]/route.ts
const handle = (request: Request) => simulator.handle(request);
export { handle as GET, handle as POST };

// Point the helpers at it:
createCheckoutHandlers({ apiToken: 'any', apiBaseUrl: simulator.apiBaseUrl, fetch: simulator.fetch, … });
useHelcimPay({ scriptUrl: '/mock-helcim/start.js', … });
```

**Routes** (under `basePath`):

| Route                            | Stands in for                                                  |
| -------------------------------- | -------------------------------------------------------------- |
| `POST /v2/helcim-pay/initialize` | the initialize API (same body, errors and response)            |
| `GET /start.js`                  | `start.js` (`appendHelcimPayIframe` / `removeHelcimPayIframe`) |
| `GET /checkout/:token`           | the payment modal in the iframe                                |
| `POST /process`                  | card processing (used by the modal)                            |

**How it behaves:**

- **Stateless.** The checkout token is a signed (HMAC) payload carrying the amount, currency and expiry, and the secret token is derived from it. It works on serverless platforms with no storage.
- **Real hashes.** The SUCCESS message is a JSON string `{"data":{"hash":…,"data":{…}}}`, hashed like Helcim's PHP backend (see below). `validateTransaction` is exercised for real.
- **Test cards only.** Any other number is rejected, so no one can type a real card into your demo.

| Card                  | Result                       |
| --------------------- | ---------------------------- |
| `4242 4242 4242 4242` | Approved (Visa)              |
| `5555 5555 5555 4444` | Approved (Mastercard)        |
| `4000 0000 0000 0002` | Declined                     |
| `4000 0000 0000 9995` | Declined: insufficient funds |
| `4000 0000 0000 0119` | Declined: processing error   |

Any future expiry (`MM/YY`) and any 3–4 digit CVV work.

For unit tests with no HTTP, `simulator.simulatePayment({ checkoutToken, cardNumber? })` returns `{ eventStatus, eventMessage }` directly, and `simulator.getSecretToken(checkoutToken)` returns the matching secret.

## Security model

- **The API token never leaves your server.** Initialization is server-side only; Helcim blocks browser calls with CORS anyway.
- **The `secretToken` never reaches the browser.** The hook only ever sees `checkoutToken`. `createCheckoutHandlers` keeps the secret in an encrypted, `HttpOnly` cookie.
- **The price comes from the server.** `getOrder` computes the amount. Validation checks the paid amount and currency against that order, so a valid receipt for a $1 checkout can't be used for a $500 order.
- **Receipts can't be replayed.** A successful validation clears the session.
- **Messages are filtered.** The hook ignores `postMessage` events from other origins, or for other checkout tokens.
- **The browser result is not proof.** Without `validate`, `result.verified` is `false` and a development warning is logged. Fulfil orders in `onVerified` (server-side), not in the client's `onSuccess`.

## Why the hash check is harder than it looks

Helcim's docs describe the check as `sha256(json_encode(data) + secretToken)`, with PHP and Python samples. A naive JavaScript port, `sha256(JSON.stringify(data) + secret)`, **fails intermittently**, because PHP's JSON output isn't JavaScript's:

|                                     | PHP `json_encode` | JavaScript `JSON.stringify` |
| ----------------------------------- | ----------------- | --------------------------- |
| `"a/b"`                             | `"a\/b"`          | `"a/b"`                     |
| `"Café"`                            | `"Caf\u00e9"`     | `"Café"`                    |
| `10.00` (a float)                   | `10.0`            | `10`                        |
| `{}` (after `json_decode(…, true)`) | `[]`              | `{}`                        |

So amounts ending in `.00`, invoice numbers containing `/`, or accented cardholder names each break a naive port. This package parses the raw message text, keeping number formatting (`JSON.parse` would lose it). It then re-encodes byte-for-byte the way PHP does (and Python, since Helcim documents both), and checks each candidate against the hash. Trying several encodings doesn't weaken the check: every candidate still needs your secret token to match.

The encoders are tested against real CPython `json.dumps` output (the fixtures are generated by `scripts/gen-python-fixtures.py`) and against documented PHP behaviour.

## Limitations

- **The live payload shape is unverified.** It was not tested against a live Helcim account. The `eventMessage` shape comes from Helcim's docs and from published integrations; the parser accepts every variant seen (string or object, `{hash, data}` top-level or nested). If you hit a live shape it rejects, please open an issue with a redacted example.
- **The origin check defaults to the script's origin.** It assumes the iframe is served from the same origin as `start.js` (`https://secure.helcim.app`). If Helcim serves it elsewhere, pass `allowedOrigins`.
- **One checkout at a time per hook instance.** This is by design.
- **The simulator's modal is not Helcim's UI.** It reproduces Helcim's API and events, not its appearance or its full field set (ACH, saved cards, digital wallets).

## Disclaimer

- **Not affiliated with Helcim.** This is an independent, unofficial open-source project. It is not affiliated with, endorsed by, sponsored by, or supported by Helcim Inc. For help with Helcim's products, contact Helcim directly.
- **Trademarks.** Helcim and HelcimPay are trademarks of Helcim Inc. They are used here only to identify the service this software works with (nominative use). No Helcim logos or brand assets are used.
- **Independent implementation.** The library and its simulator were written from Helcim's publicly available developer documentation. They contain no Helcim source code, and no Helcim software was copied, decompiled or reverse-engineered.
- **The demo is only a demo.** The demo store is fictional, sells nothing, and by default processes no real payments: checkout runs against the built-in simulator, which accepts only published test card numbers and does not store card details. Never enter real card details into the demo.
- **No warranty.** The software is provided "as is", without warranty of any kind, under the [MIT License](LICENSE). The authors are not liable for any claim, damages or other liability arising from its use.
- **Your responsibility.** Using this library does not make an integration compliant with Helcim's terms of service, PCI DSS, or any law or regulation. If you process real payments, you are responsible for your Helcim account, your integration's security, and your compliance obligations. Nothing in this repository is legal, financial or compliance advice.

## License

MIT
