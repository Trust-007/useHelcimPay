import {
  HelcimPayError,
  type HelcimPayTransactionResponse,
  type HelcimTransaction,
} from '../types';
import { parseJson, toValue, type JsonNode } from './json';

/**
 * Normalizes a HelcimPay.js SUCCESS `eventMessage` into `{ data, hash, rawData }`.
 *
 * Helcim's docs describe the message as a JSON string of the transaction
 * response. Integrations in the wild handle it as a string and as an object,
 * with `{ hash, data }` either at the top level or nested one level deeper
 * under `data`. We accept all of these shapes.
 *
 * @throws {HelcimPayError} with code `INVALID_MESSAGE` if no `{ hash, data }` pair is found.
 */
export function parseEventMessage(eventMessage: unknown): HelcimPayTransactionResponse {
  if (typeof eventMessage === 'string') {
    let root: JsonNode;
    try {
      root = parseJson(eventMessage);
    } catch (cause) {
      throw new HelcimPayError('INVALID_MESSAGE', 'eventMessage is not valid JSON', { cause });
    }
    const found = findResponseNode(root, eventMessage);
    if (!found) throw invalid();
    return {
      data: toValue(found.data) as HelcimTransaction,
      hash: found.hash,
      rawData: found.source.slice(found.data.start, found.data.end),
    };
  }

  if (eventMessage && typeof eventMessage === 'object') {
    const found = findResponseValue(eventMessage as Record<string, unknown>);
    if (!found) throw invalid();
    return found;
  }

  throw invalid();
}

const invalid = () =>
  new HelcimPayError(
    'INVALID_MESSAGE',
    'eventMessage does not contain a { hash, data } transaction response',
  );

interface FoundNode {
  data: JsonNode;
  hash: string;
  /** The JSON text that `data`'s spans point into. */
  source: string;
}

function findResponseNode(node: JsonNode, source: string, depth = 0): FoundNode | undefined {
  if (node.kind !== 'object' || depth > 2) return undefined;
  const get = (key: string) => node.entries.find(([k]) => k === key)?.[1];
  const hash = get('hash');
  const data = get('data');
  if (hash?.kind === 'string' && data?.kind === 'object') return { data, hash: hash.value, source };
  // A JSON string that itself holds JSON (double-encoded).
  if (data?.kind === 'string') {
    try {
      return findResponseNode(parseJson(data.value), data.value, depth + 1);
    } catch {
      return undefined;
    }
  }
  return data ? findResponseNode(data, source, depth + 1) : undefined;
}

function findResponseValue(
  value: Record<string, unknown>,
  depth = 0,
): HelcimPayTransactionResponse | undefined {
  if (depth > 2) return undefined;
  const { hash, data } = value;
  if (typeof hash === 'string' && data && typeof data === 'object' && !Array.isArray(data)) {
    return { data: data as HelcimTransaction, hash };
  }
  if (typeof data === 'string') {
    try {
      return parseEventMessage(data);
    } catch {
      return undefined;
    }
  }
  if (data && typeof data === 'object')
    return findResponseValue(data as Record<string, unknown>, depth + 1);
  return undefined;
}
