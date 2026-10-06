/**
 * Types shared by the client hook and the server helpers.
 *
 * Field names follow Helcim's published docs for the HelcimPay.js transaction
 * response. Helcim may add fields at any time, so every response type keeps an
 * index signature rather than pretending to be exhaustive.
 */

/** Statuses emitted by the HelcimPay.js iframe via `window.postMessage`. */
export type HelcimPayEventStatus = 'SUCCESS' | 'ABORTED' | 'HIDE';

/** The raw `event.data` payload posted by the HelcimPay.js iframe. */
export interface HelcimPayMessageEventData {
  /** Always `'helcim-pay-js-' + checkoutToken`. */
  eventName: string;
  eventStatus: HelcimPayEventStatus;
  /**
   * On SUCCESS: the transaction response, usually as a JSON string.
   * On ABORTED: an error string such as
   * `"HelcimPay.js transaction failed - ..."`.
   */
  eventMessage: unknown;
}

/** Card transaction data returned by HelcimPay.js on a successful payment. */
export interface HelcimTransaction {
  transactionId: string | number;
  dateCreated?: string;
  cardBatchId?: string | number;
  status?: 'APPROVED' | 'DECLINED' | (string & {});
  type?: 'purchase' | 'preauth' | 'verify' | (string & {});
  amount?: number | string;
  currency?: 'CAD' | 'USD' | (string & {});
  avsResponse?: string;
  cvvResponse?: string;
  approvalCode?: string;
  cardToken?: string;
  /** Masked card number, e.g. `"4242********4242"`. */
  cardNumber?: string;
  cardHolderName?: string;
  customerCode?: string;
  invoiceNumber?: string;
  warning?: string;
  [key: string]: unknown;
}

/**
 * A transaction response normalized out of `eventMessage`. `data` is the
 * transaction and `hash` is Helcim's SHA-256 over it plus your `secretToken`.
 */
export interface HelcimPayTransactionResponse {
  data: HelcimTransaction;
  hash: string;
  /**
   * The exact JSON text of `data` as Helcim sent it, when it was delivered as
   * a string. Server-side validation uses it to keep number formatting
   * (`10.00` vs `10`), which matters for the hash.
   */
  rawData?: string;
}

export type HelcimPaymentType = 'purchase' | 'preauth' | 'verify';
export type HelcimCurrency = 'CAD' | 'USD';
export type HelcimPaymentMethod = 'cc' | 'ach' | 'cc-ach';

export type HelcimPayErrorCode =
  | 'SCRIPT_LOAD_FAILED'
  | 'INIT_FAILED'
  | 'TOKEN_EXPIRED'
  | 'DECLINED'
  | 'VALIDATION_FAILED'
  | 'INVALID_MESSAGE'
  | 'UNKNOWN';

/** Every error surfaced by this package is a `HelcimPayError` with a stable `code`. */
export class HelcimPayError extends Error {
  override readonly name = 'HelcimPayError';
  readonly code: HelcimPayErrorCode;
  /** HTTP status, when the error came from an HTTP call. */
  readonly status?: number;
  /** Raw details (e.g. Helcim's `errors` body), for logging. */
  readonly details?: unknown;

  constructor(
    code: HelcimPayErrorCode,
    message: string,
    options: { status?: number; details?: unknown; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.code = code;
    this.status = options.status;
    this.details = options.details;
  }
}

/**
 * Type guard for `HelcimPayError`. It is duck-typed, so it also works across
 * the separately bundled client and `/server` entries, and across realms.
 */
export function isHelcimPayError(value: unknown): value is HelcimPayError {
  return (
    value instanceof HelcimPayError ||
    (value instanceof Error &&
      value.name === 'HelcimPayError' &&
      typeof (value as { code?: unknown }).code === 'string')
  );
}
