import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_HELCIM_PAY_SCRIPT_URL, loadHelcimPayScript } from './loadScript';
import { parseEventMessage } from './shared/parseEventMessage';
import {
  HelcimPayError,
  isHelcimPayError,
  type HelcimPayMessageEventData,
  type HelcimPayTransactionResponse,
  type HelcimTransaction,
} from './types';

/**
 * - `idle`: nothing happening yet.
 * - `initializing`: loading HelcimPay.js and getting a checkout token.
 * - `open`: the payment modal is showing.
 * - `validating`: payment approved; waiting for your server to verify it.
 * - `success`: payment approved (and verified, if you passed `validate`).
 * - `declined`: the card was declined (ABORTED). The modal may still be open for a retry.
 * - `closed`: the customer closed the modal without paying.
 * - `error`: something failed; see `error.code`.
 */
export type HelcimPayStatus =
  'idle' | 'initializing' | 'open' | 'validating' | 'success' | 'declined' | 'closed' | 'error';

export interface CheckoutTokenResult {
  checkoutToken: string;
  /** When the token expires. Defaults to 60 minutes after it's received. */
  expiresAt?: Date | string | number;
}

export interface ValidatePayload {
  checkoutToken: string;
  /** The SUCCESS `eventMessage`, unmodified. Send it to your server as-is. */
  eventMessage: unknown;
}

export interface HelcimPayResult<TValidation = unknown> {
  checkoutToken: string;
  /** The transaction parsed from the event (or from your `validate` result). */
  transaction: HelcimTransaction;
  /** The parsed `{ data, hash }`, when the client could parse it. */
  response?: HelcimPayTransactionResponse;
  /** Whatever your `validate` callback returned. */
  validation?: TValidation;
  /** `true` when `validate` ran and did not reject. */
  verified: boolean;
}

export interface UseHelcimPayOptions<TInput = void, TValidation = unknown> {
  /**
   * Gets a checkout token from **your server** (which calls `initializeCheckout`).
   * It receives whatever you pass to `startCheckout(input)`.
   */
  getCheckoutToken: (
    input: TInput,
    context: { signal: AbortSignal },
  ) => Promise<CheckoutTokenResult | string>;
  /**
   * Verifies the transaction on **your server** (which calls `validateTransaction`).
   * Reject, or resolve with `{ valid: false }`, to fail the checkout. Strongly
   * recommended: without it, a SUCCESS message is trusted as-is.
   */
  validate?: (payload: ValidatePayload) => Promise<TValidation>;
  /** Let the customer close the modal. Default `true`. */
  allowExit?: boolean;
  /** Remove the modal as soon as payment succeeds. Default `true`. Set `false` with `confirmationScreen: true`. */
  closeOnSuccess?: boolean;
  /** HelcimPay.js script URL. Override it to point at a simulator. */
  scriptUrl?: string;
  /**
   * Origins allowed to post HelcimPay.js messages. Defaults to the origin of
   * `scriptUrl`. Pass `'*'` to disable the check (not recommended).
   */
  allowedOrigins?: readonly string[] | '*';
  onSuccess?: (result: HelcimPayResult<TValidation>) => void;
  onDeclined?: (error: HelcimPayError) => void;
  onClose?: () => void;
  onError?: (error: HelcimPayError) => void;
}

export interface UseHelcimPayReturn<TInput, TValidation> {
  /** Starts a checkout. It does nothing while one is already in progress. */
  startCheckout: (input: TInput) => Promise<void>;
  status: HelcimPayStatus;
  error: HelcimPayError | null;
  result: HelcimPayResult<TValidation> | null;
  /** The current session's checkout token, if any. */
  checkoutToken: string | null;
  /** `true` while initializing, open or validating. */
  isBusy: boolean;
  /** Closes any open modal, cancels pending work, and returns to `idle`. */
  reset: () => void;
}

interface State<TValidation> {
  status: HelcimPayStatus;
  error: HelcimPayError | null;
  result: HelcimPayResult<TValidation> | null;
  checkoutToken: string | null;
}

const INITIAL_STATE: State<never> = {
  status: 'idle',
  error: null,
  result: null,
  checkoutToken: null,
};

const TOKEN_TTL_MS = 60 * 60 * 1000;
const BUSY: ReadonlySet<HelcimPayStatus> = new Set(['initializing', 'open', 'validating']);

/** One checkout attempt. Anything tied to an old session is ignored once a new one starts. */
interface Session {
  id: number;
  /** Synchronous source of truth for message handling. React state only mirrors it. */
  phase: HelcimPayStatus;
  checkoutToken?: string;
  abort: AbortController;
  cleanup: Array<() => void>;
}

function removeIframe() {
  if (typeof window === 'undefined') return;
  try {
    window.removeHelcimPayIframe?.();
  } catch {
    // Helcim's implementation references its own listener; ignore its errors.
  }
  document.getElementById('helcimPayIframe')?.remove();
}

function isDev(): boolean {
  return typeof process === 'undefined' || process.env?.NODE_ENV !== 'production';
}

function toHelcimPayError(error: unknown, fallback: HelcimPayError['code']): HelcimPayError {
  if (isHelcimPayError(error)) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new HelcimPayError(fallback, message, { cause: error });
}

/**
 * React hook for HelcimPay.js. It loads the script, gets a checkout token from
 * your server, opens the payment modal, listens for its messages, and
 * optionally sends the result to your server for hash validation.
 *
 * @example
 * const { startCheckout, status, error, result } = useHelcimPay({
 *   getCheckoutToken: (cart) => postJson('/api/checkout', cart),
 *   validate: (payload) => postJson('/api/validate', payload),
 * });
 */
export function useHelcimPay<TInput = void, TValidation = unknown>(
  options: UseHelcimPayOptions<TInput, TValidation>,
): UseHelcimPayReturn<TInput, TValidation> {
  const [state, setState] = useState<State<TValidation>>(INITIAL_STATE);

  // Always read the latest options without making callbacks depend on them.
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  const sessionRef = useRef<Session | null>(null);
  const nextIdRef = useRef(0);
  const mountedRef = useRef(false);

  const endSession = useCallback((session: Session | null) => {
    if (!session) return;
    session.abort.abort();
    for (const fn of session.cleanup.splice(0)) fn();
    if (sessionRef.current === session) sessionRef.current = null;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const session = sessionRef.current;
      if (session?.checkoutToken) removeIframe();
      endSession(session);
    };
  }, [endSession]);

  const startCheckout = useCallback(
    async (input: TInput) => {
      if (sessionRef.current) return; // already in progress

      const session: Session = {
        id: ++nextIdRef.current,
        phase: 'initializing',
        abort: new AbortController(),
        cleanup: [],
      };
      sessionRef.current = session;
      const isCurrent = () => mountedRef.current && sessionRef.current === session;
      const update = (next: Partial<State<TValidation>>) => {
        if (!isCurrent()) return;
        if (next.status) session.phase = next.status;
        setState((prev) => ({ ...prev, ...next }));
      };
      const fail = (error: HelcimPayError, { close = true } = {}) => {
        if (!isCurrent()) return;
        if (close) removeIframe();
        update({ status: 'error', error });
        endSession(session);
        optionsRef.current.onError?.(error);
      };

      if (mountedRef.current) setState({ ...INITIAL_STATE, status: 'initializing' });

      const opts = optionsRef.current;
      const scriptUrl = opts.scriptUrl ?? DEFAULT_HELCIM_PAY_SCRIPT_URL;

      let globals: Awaited<ReturnType<typeof loadHelcimPayScript>>;
      let token: CheckoutTokenResult;
      try {
        const [loaded, rawToken] = await Promise.all([
          loadHelcimPayScript(scriptUrl),
          opts.getCheckoutToken(input, { signal: session.abort.signal }).catch((e: unknown) => {
            throw toHelcimPayError(e, 'INIT_FAILED');
          }),
        ]);
        globals = loaded;
        token = typeof rawToken === 'string' ? { checkoutToken: rawToken } : rawToken;
        if (!token?.checkoutToken) {
          throw new HelcimPayError(
            'INIT_FAILED',
            'getCheckoutToken() did not return a checkoutToken',
          );
        }
      } catch (error) {
        fail(toHelcimPayError(error, 'INIT_FAILED'), { close: false });
        return;
      }
      if (!isCurrent()) return;

      const { checkoutToken } = token;
      session.checkoutToken = checkoutToken;
      const eventName = `helcim-pay-js-${checkoutToken}`;
      const allowed = opts.allowedOrigins ?? [new URL(scriptUrl, window.location.href).origin];

      const onSuccessMessage = async (eventMessage: unknown) => {
        const { validate, closeOnSuccess = true } = optionsRef.current;
        session.phase = 'validating';
        if (closeOnSuccess) removeIframe();

        let response: HelcimPayTransactionResponse | undefined;
        try {
          response = parseEventMessage(eventMessage);
        } catch (error) {
          // Without a server validator we have nothing to trust.
          if (!validate) return fail(toHelcimPayError(error, 'INVALID_MESSAGE'));
        }

        let validation: TValidation | undefined;
        if (validate) {
          update({ status: 'validating', error: null });
          try {
            validation = await validate({ checkoutToken, eventMessage });
          } catch (error) {
            return fail(toHelcimPayError(error, 'VALIDATION_FAILED'));
          }
          if (!isCurrent()) return;
          const v = validation as { valid?: unknown; message?: unknown } | null | undefined;
          if (v && typeof v === 'object' && v.valid === false) {
            return fail(
              new HelcimPayError(
                'VALIDATION_FAILED',
                typeof v.message === 'string' ? v.message : 'Server rejected the transaction',
                { details: validation },
              ),
            );
          }
        } else if (isDev()) {
          console.warn(
            '[use-helcim-pay] No `validate` callback: the payment result was not verified on your server.',
          );
        }

        const transaction =
          response?.data ??
          ((validation as { transaction?: HelcimTransaction } | undefined)?.transaction as
            HelcimTransaction | undefined);
        if (!transaction) {
          return fail(new HelcimPayError('INVALID_MESSAGE', 'No transaction data in the response'));
        }

        const result: HelcimPayResult<TValidation> = {
          checkoutToken,
          transaction,
          response,
          validation,
          verified: Boolean(validate),
        };
        update({ status: 'success', error: null, result });
        endSession(session);
        optionsRef.current.onSuccess?.(result);
      };

      const onMessage = (event: MessageEvent) => {
        if (!isCurrent()) return;
        if (allowed !== '*' && !allowed.includes(event.origin)) return;
        const data = event.data as Partial<HelcimPayMessageEventData> | null;
        if (!data || typeof data !== 'object' || data.eventName !== eventName) return;

        const { phase } = session;
        const live = phase === 'open' || phase === 'declined';
        if (!live) return; // e.g. a HIDE after SUCCESS while validating

        switch (data.eventStatus) {
          case 'SUCCESS':
            void onSuccessMessage(data.eventMessage);
            return;
          case 'ABORTED': {
            const error = new HelcimPayError(
              'DECLINED',
              typeof data.eventMessage === 'string' ? data.eventMessage : 'Payment was declined',
              { details: data.eventMessage },
            );
            update({ status: 'declined', error });
            optionsRef.current.onDeclined?.(error);
            return;
          }
          case 'HIDE':
            // The modal closed. After a decline, keep the decline visible.
            removeIframe();
            if (phase === 'open') update({ status: 'closed' });
            endSession(session);
            if (phase === 'open') optionsRef.current.onClose?.();
            return;
        }
      };

      window.addEventListener('message', onMessage);
      session.cleanup.push(() => window.removeEventListener('message', onMessage));

      const expiresAt =
        token.expiresAt !== undefined
          ? new Date(token.expiresAt).getTime()
          : Date.now() + TOKEN_TTL_MS;
      const timer = setTimeout(
        () =>
          fail(
            new HelcimPayError('TOKEN_EXPIRED', 'The checkout session expired. Please try again.'),
          ),
        Math.max(0, expiresAt - Date.now()),
      );
      session.cleanup.push(() => clearTimeout(timer));

      update({ status: 'open', checkoutToken });
      try {
        globals.appendHelcimPayIframe(checkoutToken, opts.allowExit ?? true);
      } catch (error) {
        fail(toHelcimPayError(error, 'UNKNOWN'));
      }
    },
    [endSession],
  );

  const reset = useCallback(() => {
    const session = sessionRef.current;
    if (session?.checkoutToken) removeIframe();
    endSession(session);
    setState(INITIAL_STATE);
  }, [endSession]);

  return {
    startCheckout,
    status: state.status,
    error: state.error,
    result: state.result,
    checkoutToken: state.checkoutToken,
    isBusy: BUSY.has(state.status),
    reset,
  };
}
