# Changelog

All notable changes to `use-helcim-pay` are documented here. This project follows [Semantic Versioning](https://semver.org/).

## 0.1.0 (unreleased)

First release.

### Client (`use-helcim-pay`)

- `useHelcimPay()` hook with a typed state machine: `idle`, `initializing`, `open`, `declined`, `validating`, `success`, `closed` and `error`. It also exposes `isBusy` and `isOpen`.
- Loads `start.js` once, in parallel with the checkout token request, and safely during server rendering.
- Filters `postMessage` events by checkout token and origin, ignores duplicate SUCCESS messages, and doesn't double-fire callbacks under React StrictMode.
- Supports a card retry inside the same modal after a decline, and a `closeOnSuccess: false` mode for Helcim's confirmation screen.
- Closes the modal with `TOKEN_EXPIRED` when the checkout token expires.
- `createCheckoutClient()`, the browser half of `createCheckoutHandlers()`.
- `HelcimPayError` with stable error codes, and a cross-bundle `isHelcimPayError()`.

### Server (`use-helcim-pay/server`)

- `initializeCheckout()`: typed wrapper for `POST /v2/helcim-pay/initialize`, which normalizes Helcim's error formats.
- `validateTransaction()`: checks the response hash byte-for-byte the way Helcim's PHP backend (and Python) encode it, keeping float formatting. It compares in constant time and checks approval status, amount and currency.
- `createCheckoutHandlers()`: Web-standard `initialize` and `validate` handlers. The price comes from the server, the secret token lives in an AES-GCM encrypted cookie, and a successful validation clears it so receipts can't be replayed.

### Testing (`use-helcim-pay/testing`)

- `createHelcimSimulator()`: a stateless stand-in for Helcim's initialize API, `start.js` and payment modal, with real response hashes and test cards only.
