import {
  encodeJson,
  fromValue,
  parseJson,
  type JsonEncodeStyle,
  type JsonNode,
} from '../shared/json';
import { parseEventMessage } from '../shared/parseEventMessage';
import {
  isHelcimPayError,
  type HelcimTransaction,
  type HelcimPayTransactionResponse,
} from '../types';
import { sha256Hex, timingSafeEqual } from './crypto';

export type ValidationFailureReason =
  'MALFORMED_MESSAGE' | 'HASH_MISMATCH' | 'NOT_APPROVED' | 'AMOUNT_MISMATCH' | 'CURRENCY_MISMATCH';

export type ValidateTransactionResult =
  | {
      valid: true;
      transaction: HelcimTransaction;
      /** Which JSON encoding reproduced Helcim's hash (useful when debugging). */
      encoding: JsonEncodeStyle;
    }
  | {
      valid: false;
      reason: ValidationFailureReason;
      message: string;
      /** The parsed transaction, when the message could be parsed at all. */
      transaction?: HelcimTransaction;
    };

export interface ValidateTransactionOptions {
  /**
   * The SUCCESS `eventMessage` exactly as the browser received it. Pass it
   * unmodified, ideally the original string, so number formatting survives.
   */
  eventMessage: unknown;
  /** The `secretToken` from `initializeCheckout()` for this checkout. Never send it to the browser. */
  secretToken: string;
  /**
   * What the server expects this transaction to be. Checking this stops a
   * valid receipt for a $1 checkout from being replayed against a $500 order.
   */
  expected?: {
    amount?: number;
    currency?: string;
  };
  /** Reject transactions whose `status` is present and not `APPROVED`. Default `true`. */
  requireApproved?: boolean;
  /**
   * Keys whose integral numbers should be encoded as floats (`10` → `10.0`).
   * Only used when `eventMessage` arrives as an already-parsed object, since
   * the original formatting is lost then. Default `['amount']`.
   */
  floatKeys?: readonly string[];
}

const STYLES: readonly JsonEncodeStyle[] = ['php', 'python', 'js'];

/**
 * Verifies a HelcimPay.js transaction response on your server.
 *
 * It re-computes `sha256(json_encode(data) + secretToken)` the way Helcim's
 * PHP backend does and compares it with the `hash` in the response using a
 * constant-time comparison. Then it optionally checks the approval status,
 * amount and currency.
 *
 * It never throws for bad input. Every failure comes back as `{ valid: false, reason }`.
 */
export async function validateTransaction(
  options: ValidateTransactionOptions,
): Promise<ValidateTransactionResult> {
  const { secretToken, expected, requireApproved = true, floatKeys = ['amount'] } = options;

  let response: HelcimPayTransactionResponse;
  try {
    response = parseEventMessage(options.eventMessage);
  } catch (error) {
    return {
      valid: false,
      reason: 'MALFORMED_MESSAGE',
      message: isHelcimPayError(error) ? error.message : 'Could not parse eventMessage',
    };
  }
  const { data: transaction, hash } = response;

  const node: JsonNode = response.rawData
    ? parseJson(response.rawData)
    : fromValue(transaction, new Set(floatKeys));

  // Helcim documents both PHP and Python as the reference, and they differ
  // on '/' escaping, so try each encoding. This is still safe: every
  // candidate needs the secret token to produce a matching hash.
  const tried = new Set<string>();
  let matched: JsonEncodeStyle | undefined;
  for (const style of STYLES) {
    const json = encodeJson(node, style);
    if (tried.has(json)) continue;
    tried.add(json);
    const candidate = await sha256Hex(json + secretToken);
    if (timingSafeEqual(candidate, hash.toLowerCase())) {
      matched = style;
      break;
    }
  }
  if (!matched) {
    return {
      valid: false,
      reason: 'HASH_MISMATCH',
      message: 'Transaction hash does not match; the response may have been tampered with.',
      transaction,
    };
  }

  if (requireApproved && transaction.status !== undefined && transaction.status !== 'APPROVED') {
    return {
      valid: false,
      reason: 'NOT_APPROVED',
      message: `Transaction status is ${String(transaction.status)}`,
      transaction,
    };
  }

  if (expected?.amount !== undefined && !sameAmount(transaction.amount, expected.amount)) {
    return {
      valid: false,
      reason: 'AMOUNT_MISMATCH',
      message: `Expected amount ${expected.amount}, got ${String(transaction.amount)}`,
      transaction,
    };
  }

  if (
    expected?.currency !== undefined &&
    String(transaction.currency ?? '').toUpperCase() !== expected.currency.toUpperCase()
  ) {
    return {
      valid: false,
      reason: 'CURRENCY_MISMATCH',
      message: `Expected currency ${expected.currency}, got ${String(transaction.currency)}`,
      transaction,
    };
  }

  return { valid: true, transaction, encoding: matched };
}

/** Compares money amounts in cents, to avoid float noise like 0.1 + 0.2. */
function sameAmount(actual: unknown, expected: number): boolean {
  const n = typeof actual === 'string' ? Number(actual) : actual;
  return (
    typeof n === 'number' &&
    Number.isFinite(n) &&
    Math.round(n * 100) === Math.round(expected * 100)
  );
}
