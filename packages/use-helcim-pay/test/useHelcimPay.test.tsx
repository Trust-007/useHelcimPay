// @vitest-environment happy-dom
import { StrictMode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useHelcimPay, type UseHelcimPayOptions } from '../src';
import { resetHelcimPayScriptCache } from '../src/loadScript';

const ORIGIN = 'https://secure.helcim.app';
const TOKEN = 'ct_123';
const TRANSACTION = { transactionId: 42, amount: 15.45, currency: 'CAD', status: 'APPROVED' };
const SUCCESS_MESSAGE = JSON.stringify({ data: { hash: 'abc', data: TRANSACTION } });

const iframe = () => document.getElementById('helcimPayIframe');

/** Stands in for HelcimPay.js start.js. */
function installFakeHelcim() {
  window.appendHelcimPayIframe = vi.fn(() => {
    const frame = document.createElement('iframe');
    frame.id = 'helcimPayIframe';
    document.body.appendChild(frame);
  });
  window.removeHelcimPayIframe = vi.fn(() => iframe()?.remove());
}

function post(eventStatus: string, eventMessage: unknown = '', token = TOKEN, origin = ORIGIN) {
  act(() => {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { eventName: `helcim-pay-js-${token}`, eventStatus, eventMessage },
        origin,
      }),
    );
  });
}

type Opts = UseHelcimPayOptions<{ sku: string }, { valid: boolean; message?: string }>;

function setup(overrides: Partial<Opts> = {}, { strict = false } = {}) {
  const options: Opts = {
    getCheckoutToken: vi.fn(async () => ({ checkoutToken: TOKEN })),
    validate: vi.fn(async () => ({ valid: true })),
    onSuccess: vi.fn(),
    onDeclined: vi.fn(),
    onClose: vi.fn(),
    onError: vi.fn(),
    ...overrides,
  };
  const hook = renderHook(() => useHelcimPay(options), {
    wrapper: strict ? StrictMode : undefined,
  });
  return { options, hook, current: () => hook.result.current };
}

async function openCheckout(ctx: ReturnType<typeof setup>) {
  await act(() => ctx.current().startCheckout({ sku: 'tee' }));
  expect(ctx.current().status).toBe('open');
}

beforeEach(installFakeHelcim);
afterEach(() => {
  resetHelcimPayScriptCache();
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  delete window.appendHelcimPayIframe;
  delete window.removeHelcimPayIframe;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useHelcimPay', () => {
  it('starts idle', () => {
    const { current } = setup();
    expect(current()).toMatchObject({ status: 'idle', error: null, result: null, isBusy: false });
  });

  it('runs the full happy path: token → modal → SUCCESS → server validation', async () => {
    const ctx = setup();
    await openCheckout(ctx);

    expect(ctx.options.getCheckoutToken).toHaveBeenCalledWith(
      { sku: 'tee' },
      { signal: expect.any(AbortSignal) },
    );
    expect(window.appendHelcimPayIframe).toHaveBeenCalledWith(TOKEN, true);
    expect(ctx.current()).toMatchObject({ checkoutToken: TOKEN, isBusy: true });
    expect(iframe()).not.toBeNull();

    post('SUCCESS', SUCCESS_MESSAGE);
    await waitFor(() => expect(ctx.current().status).toBe('success'));

    // The raw eventMessage goes to the server untouched, so hash formatting survives.
    expect(ctx.options.validate).toHaveBeenCalledWith({
      checkoutToken: TOKEN,
      eventMessage: SUCCESS_MESSAGE,
    });
    expect(ctx.current().result).toMatchObject({
      checkoutToken: TOKEN,
      transaction: TRANSACTION,
      verified: true,
      validation: { valid: true },
    });
    expect(ctx.options.onSuccess).toHaveBeenCalledTimes(1);
    expect(iframe()).toBeNull();
    expect(ctx.current().isBusy).toBe(false);
  });

  it('shows the validating status while the server verifies', async () => {
    let resolve!: (v: { valid: boolean }) => void;
    const ctx = setup({ validate: () => new Promise((r) => (resolve = r)) });
    await openCheckout(ctx);
    post('SUCCESS', SUCCESS_MESSAGE);
    await waitFor(() => expect(ctx.current().status).toBe('validating'));
    await act(async () => resolve({ valid: true }));
    expect(ctx.current().status).toBe('success');
  });

  it('ignores a duplicate SUCCESS message', async () => {
    const ctx = setup();
    await openCheckout(ctx);
    post('SUCCESS', SUCCESS_MESSAGE);
    post('SUCCESS', SUCCESS_MESSAGE);
    await waitFor(() => expect(ctx.current().status).toBe('success'));
    expect(ctx.options.validate).toHaveBeenCalledTimes(1);
    expect(ctx.options.onSuccess).toHaveBeenCalledTimes(1);
  });

  it('fails when the server rejects the transaction', async () => {
    const ctx = setup({
      validate: vi.fn(async () => ({ valid: false, message: 'Hash mismatch' })),
    });
    await openCheckout(ctx);
    post('SUCCESS', SUCCESS_MESSAGE);
    await waitFor(() => expect(ctx.current().status).toBe('error'));
    expect(ctx.current().error).toMatchObject({
      code: 'VALIDATION_FAILED',
      message: 'Hash mismatch',
    });
    expect(ctx.options.onError).toHaveBeenCalledTimes(1);
    expect(ctx.options.onSuccess).not.toHaveBeenCalled();
  });

  it('fails when validate throws', async () => {
    const ctx = setup({
      validate: vi.fn(async () => {
        throw new Error('500');
      }),
    });
    await openCheckout(ctx);
    post('SUCCESS', SUCCESS_MESSAGE);
    await waitFor(() => expect(ctx.current().error?.code).toBe('VALIDATION_FAILED'));
  });

  it('succeeds unverified (with a dev warning) when no validate is given', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ctx = setup({ validate: undefined });
    await openCheckout(ctx);
    post('SUCCESS', SUCCESS_MESSAGE);
    await waitFor(() => expect(ctx.current().status).toBe('success'));
    expect(ctx.current().result).toMatchObject({ verified: false, transaction: TRANSACTION });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('not verified'));
  });

  it('fails on an unparseable SUCCESS message when there is no validator', async () => {
    const ctx = setup({ validate: undefined });
    await openCheckout(ctx);
    post('SUCCESS', 'not json');
    await waitFor(() => expect(ctx.current().error?.code).toBe('INVALID_MESSAGE'));
  });

  it('lets the server supply the transaction when the client cannot parse it', async () => {
    const ctx = setup({
      validate: vi.fn(async () => ({ valid: true, transaction: TRANSACTION })),
    });
    await openCheckout(ctx);
    post('SUCCESS', { some: 'unexpected shape' });
    await waitFor(() => expect(ctx.current().status).toBe('success'));
    expect(ctx.current().result?.transaction).toEqual(TRANSACTION);
  });

  it('handles a decline, then a successful retry inside the same modal', async () => {
    const ctx = setup();
    await openCheckout(ctx);

    post('ABORTED', 'HelcimPay.js transaction failed - DECLINED');
    expect(ctx.current().status).toBe('declined');
    expect(ctx.current().error).toMatchObject({
      code: 'DECLINED',
      message: expect.stringContaining('DECLINED'),
    });
    expect(ctx.options.onDeclined).toHaveBeenCalledTimes(1);
    expect(iframe()).not.toBeNull();

    post('SUCCESS', SUCCESS_MESSAGE);
    await waitFor(() => expect(ctx.current().status).toBe('success'));
    expect(ctx.current().error).toBeNull();
  });

  it('keeps the decline visible when the modal is closed after it', async () => {
    const ctx = setup();
    await openCheckout(ctx);
    post('ABORTED', 'declined');
    post('HIDE');
    expect(ctx.current().status).toBe('declined');
    expect(ctx.options.onClose).not.toHaveBeenCalled();
    expect(iframe()).toBeNull();

    // A fresh checkout can start afterwards.
    await openCheckout(ctx);
    expect(ctx.options.getCheckoutToken).toHaveBeenCalledTimes(2);
  });

  it('reports a close when the customer dismisses the modal', async () => {
    const ctx = setup();
    await openCheckout(ctx);
    post('HIDE');
    expect(ctx.current().status).toBe('closed');
    expect(ctx.options.onClose).toHaveBeenCalledTimes(1);
    expect(iframe()).toBeNull();
  });

  it('ignores messages for other tokens, foreign origins and unrelated events', async () => {
    const ctx = setup();
    await openCheckout(ctx);
    post('SUCCESS', SUCCESS_MESSAGE, 'other-token');
    post('SUCCESS', SUCCESS_MESSAGE, TOKEN, 'https://evil.example');
    act(() => {
      window.dispatchEvent(new MessageEvent('message', { data: 'hello', origin: ORIGIN }));
      window.dispatchEvent(new MessageEvent('message', { data: null, origin: ORIGIN }));
    });
    expect(ctx.current().status).toBe('open');
    expect(ctx.options.validate).not.toHaveBeenCalled();
  });

  it('uses scriptUrl origin for the origin check, and honours allowedOrigins', async () => {
    const ctx = setup({ scriptUrl: 'http://localhost:3000/mock-helcim/start.js' });
    await openCheckout(ctx);
    post('HIDE', '', TOKEN, ORIGIN); // real Helcim origin is not allowed here
    expect(ctx.current().status).toBe('open');
    post('HIDE', '', TOKEN, 'http://localhost:3000');
    expect(ctx.current().status).toBe('closed');

    const any = setup({ allowedOrigins: '*' });
    await openCheckout(any);
    post('HIDE', '', TOKEN, 'https://anything.example');
    expect(any.current().status).toBe('closed');
  });

  it('accepts a bare string token and passes allowExit', async () => {
    const ctx = setup({ getCheckoutToken: async () => 'plain', allowExit: false });
    await act(() => ctx.current().startCheckout({ sku: 'x' }));
    expect(window.appendHelcimPayIframe).toHaveBeenCalledWith('plain', false);
  });

  it.each([
    ['rejects', async () => Promise.reject(new Error('HTTP 500'))],
    ['returns no token', async () => ({ checkoutToken: '' })],
  ])('reports INIT_FAILED when getCheckoutToken %s', async (_label, getCheckoutToken) => {
    const ctx = setup({ getCheckoutToken });
    await act(() => ctx.current().startCheckout({ sku: 'x' }));
    expect(ctx.current()).toMatchObject({ status: 'error', error: { code: 'INIT_FAILED' } });
    expect(ctx.options.onError).toHaveBeenCalledTimes(1);
    expect(window.appendHelcimPayIframe).not.toHaveBeenCalled();
  });

  it('reports SCRIPT_LOAD_FAILED when HelcimPay.js cannot load', async () => {
    delete window.appendHelcimPayIframe;
    // Intercept the injected <script> and fail it, without a real network request.
    const container = document.createElement('div');
    vi.spyOn(document.head, 'appendChild').mockImplementation((node) => {
      container.appendChild(node);
      queueMicrotask(() => node.dispatchEvent(new Event('error')));
      return node;
    });
    const ctx = setup();
    await act(() => ctx.current().startCheckout({ sku: 'x' }));
    expect(ctx.current()).toMatchObject({ status: 'error', error: { code: 'SCRIPT_LOAD_FAILED' } });
    expect(container.querySelector('script')).toBeNull(); // removed, so a retry re-injects it
  });

  it('ignores startCheckout while a checkout is in progress', async () => {
    const ctx = setup();
    await openCheckout(ctx);
    await act(() => ctx.current().startCheckout({ sku: 'again' }));
    expect(ctx.options.getCheckoutToken).toHaveBeenCalledTimes(1);
  });

  it('expires the session when the checkout token expires', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const ctx = setup({
      getCheckoutToken: async () => ({ checkoutToken: TOKEN, expiresAt: Date.now() + 1000 }),
    });
    await act(() => ctx.current().startCheckout({ sku: 'x' }));
    expect(ctx.current().status).toBe('open');
    act(() => {
      vi.advanceTimersByTime(1001);
    });
    expect(ctx.current().error?.code).toBe('TOKEN_EXPIRED');
    expect(iframe()).toBeNull();
  });

  it('reset() closes the modal and returns to idle', async () => {
    const ctx = setup();
    await openCheckout(ctx);
    act(() => ctx.current().reset());
    expect(ctx.current()).toMatchObject({ status: 'idle', checkoutToken: null });
    expect(iframe()).toBeNull();
    post('SUCCESS', SUCCESS_MESSAGE); // old session's listener is gone
    expect(ctx.options.validate).not.toHaveBeenCalled();
  });

  it('cleans up the modal and listener on unmount', async () => {
    const ctx = setup();
    await openCheckout(ctx);
    ctx.hook.unmount();
    expect(iframe()).toBeNull();
    post('SUCCESS', SUCCESS_MESSAGE);
    expect(ctx.options.validate).not.toHaveBeenCalled();
  });

  it('aborts a pending token request on unmount', async () => {
    let signal!: AbortSignal;
    const ctx = setup({
      getCheckoutToken: (_input, ctx) => {
        signal = ctx.signal;
        return new Promise(() => {});
      },
    });
    act(() => void ctx.current().startCheckout({ sku: 'x' }));
    ctx.hook.unmount();
    expect(signal.aborted).toBe(true);
    expect(window.appendHelcimPayIframe).not.toHaveBeenCalled();
  });

  it('works under React StrictMode without double callbacks', async () => {
    const ctx = setup({}, { strict: true });
    await openCheckout(ctx);
    post('SUCCESS', SUCCESS_MESSAGE);
    await waitFor(() => expect(ctx.current().status).toBe('success'));
    expect(ctx.options.getCheckoutToken).toHaveBeenCalledTimes(1);
    expect(ctx.options.validate).toHaveBeenCalledTimes(1);
    expect(ctx.options.onSuccess).toHaveBeenCalledTimes(1);
  });

  it('always calls the latest callbacks', async () => {
    const first = vi.fn();
    const second = vi.fn();
    const hook = renderHook(
      ({ onClose }) => useHelcimPay({ getCheckoutToken: async () => TOKEN, onClose }),
      { initialProps: { onClose: first } },
    );
    await act(() => hook.result.current.startCheckout());
    hook.rerender({ onClose: second });
    post('HIDE');
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
