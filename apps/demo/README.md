# use-helcim-pay demo

A small Next.js 16 store with a real checkout flow built on [`use-helcim-pay`](../../packages/use-helcim-pay). Build a cart, pay in the HelcimPay.js modal, and watch each step in the "Under the hood" panel.

> [!IMPORTANT]
> **Demo only.** The store is fictional and, in the default simulator mode, no real payments are processed. Never enter real card details. This is an unofficial project, not affiliated with, endorsed by, or sponsored by Helcim Inc. See the full [Disclaimer](../../README.md#disclaimer).

## Run locally

From the repository root:

```bash
npm install
npm run dev -w use-helcim-pay-demo
```

Open http://localhost:3000. With no configuration, the demo runs in **simulator mode** with development-only secrets.

Test cards (simulator): `4242 4242 4242 4242` is approved; `4000 0000 0000 0002` is declined. The full list is shown in the payment window. Use any future expiry and any CVV.

## Configuration

Copy `.env.example` to `.env.local` to override the defaults.

| Variable                 | Needed in production |                                                                                                  |
| ------------------------ | -------------------- | ------------------------------------------------------------------------------------------------ |
| `HELCIM_MODE`            | no                   | `mock` (simulator) or `live`. Defaults to `live` if `HELCIM_API_TOKEN` is set, otherwise `mock`. |
| `HELCIM_API_TOKEN`       | live mode            | Your Helcim API token.                                                                           |
| `CHECKOUT_COOKIE_SECRET` | **yes**              | 32+ random characters; encrypts the checkout session cookie.                                     |
| `MOCK_SIGNING_SECRET`    | mock mode            | 32+ random characters; signs simulator checkout tokens.                                          |

Generate a secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

In production (`NODE_ENV=production`), the checkout API refuses to run without these secrets. It logs which one is missing on the server and shows shoppers a generic "temporarily unavailable" message.

## Deploy to Vercel

1. Push the repository to GitHub.
2. In Vercel, click **Add New… → Project** and import `Trust-007/useHelcimPay`.
3. Set **Root Directory** to `apps/demo`. The framework preset (Next.js) is detected automatically. Leave the install and build commands at their defaults: Vercel installs the npm workspace from the repository root, and `npm run build` builds the library first (`prebuild`).
4. Under **Environment Variables**, add `CHECKOUT_COOKIE_SECRET` and `MOCK_SIGNING_SECRET`, each a freshly generated secret.
5. Click **Deploy**.

If the build fails with `Cannot find module 'use-helcim-pay'`, Vercel installed only the `apps/demo` folder. Set **Install Command** to `cd ../.. && npm ci` and redeploy.

To switch to a real Helcim account later, add `HELCIM_API_TOKEN` and redeploy. `HELCIM_MODE` switches to `live` automatically, and the simulator routes return 404.

## How it's wired

| File                                 |                                                                                                        |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `lib/helcim.ts`                      | Chooses mock or live mode and creates `createCheckoutHandlers` (the price comes from `lib/catalog.ts`) |
| `app/api/checkout/[action]/route.ts` | `POST /api/checkout/initialize` and `/validate`                                                        |
| `app/mock-helcim/[...path]/route.ts` | The simulator's routes (mock mode only)                                                                |
| `components/Storefront.tsx`          | `useHelcimPay` + `createCheckoutClient`, cart state, event log                                         |
| `components/CheckoutPanel.tsx`       | Button label and message for every status and error code                                               |
