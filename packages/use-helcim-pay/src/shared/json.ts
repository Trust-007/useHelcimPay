/**
 * A tiny JSON parser/encoder that keeps what `JSON.parse` throws away.
 *
 * Helcim's transaction hash is `sha256(json_encode(data) + secretToken)`,
 * computed by a PHP backend. `JSON.stringify(JSON.parse(text))` does not give
 * back the same bytes as PHP's `json_encode(json_decode(text, true))`:
 *
 *  - PHP escapes `/` as `\/` and every non-ASCII char as `\uXXXX`.
 *  - PHP keeps floats as floats: `10.00` round-trips to `10.0`, but
 *    JavaScript turns it into `10`.
 *  - With `assoc = true`, PHP turns `{}` and `{"0":..,"1":..}` into lists.
 *
 * So we parse into a small AST that remembers whether each number was written
 * as a float. Then the encoders below can reproduce PHP's (and Python's)
 * output byte-for-byte.
 */

export type JsonNode =
  | { kind: 'object'; entries: Array<[string, JsonNode]>; start: number; end: number }
  | { kind: 'array'; items: JsonNode[]; start: number; end: number }
  | { kind: 'string'; value: string; start: number; end: number }
  | { kind: 'number'; raw: string; start: number; end: number }
  | { kind: 'boolean'; value: boolean; start: number; end: number }
  | { kind: 'null'; start: number; end: number };

const NUMBER_RE = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const WS_RE = /[ \t\n\r]*/y;

/** Parses JSON text into an AST with source spans. Throws `SyntaxError` on bad input. */
export function parseJson(text: string): JsonNode {
  let pos = 0;

  const skipWs = () => {
    WS_RE.lastIndex = pos;
    WS_RE.exec(text);
    pos = WS_RE.lastIndex;
  };

  const fail = (what: string): never => {
    throw new SyntaxError(`Invalid JSON: ${what} at position ${pos}`);
  };

  const parseString = (): JsonNode & { kind: 'string' } => {
    const start = pos;
    pos++; // opening quote
    while (pos < text.length) {
      const ch = text.charCodeAt(pos);
      if (ch === 0x22) {
        pos++;
        // Let the platform decode the escapes; it is exact and fast.
        return {
          kind: 'string',
          value: JSON.parse(text.slice(start, pos)) as string,
          start,
          end: pos,
        };
      }
      if (ch === 0x5c) pos += 2;
      else if (ch < 0x20) fail('control character in string');
      else pos++;
    }
    return fail('unterminated string');
  };

  const parseValue = (): JsonNode => {
    skipWs();
    const start = pos;
    const ch = text[pos];
    if (ch === '{') {
      pos++;
      const entries: Array<[string, JsonNode]> = [];
      skipWs();
      if (text[pos] === '}') {
        pos++;
        return { kind: 'object', entries, start, end: pos };
      }
      for (;;) {
        skipWs();
        if (text[pos] !== '"') fail('expected string key');
        const key = parseString().value;
        skipWs();
        if (text[pos] !== ':') fail("expected ':'");
        pos++;
        entries.push([key, parseValue()]);
        skipWs();
        if (text[pos] === ',') {
          pos++;
          continue;
        }
        if (text[pos] === '}') {
          pos++;
          return { kind: 'object', entries, start, end: pos };
        }
        fail("expected ',' or '}'");
      }
    }
    if (ch === '[') {
      pos++;
      const items: JsonNode[] = [];
      skipWs();
      if (text[pos] === ']') {
        pos++;
        return { kind: 'array', items, start, end: pos };
      }
      for (;;) {
        items.push(parseValue());
        skipWs();
        if (text[pos] === ',') {
          pos++;
          continue;
        }
        if (text[pos] === ']') {
          pos++;
          return { kind: 'array', items, start, end: pos };
        }
        fail("expected ',' or ']'");
      }
    }
    if (ch === '"') return parseString();
    if (text.startsWith('true', pos)) {
      pos += 4;
      return { kind: 'boolean', value: true, start, end: pos };
    }
    if (text.startsWith('false', pos)) {
      pos += 5;
      return { kind: 'boolean', value: false, start, end: pos };
    }
    if (text.startsWith('null', pos)) {
      pos += 4;
      return { kind: 'null', start, end: pos };
    }
    NUMBER_RE.lastIndex = pos;
    const m = NUMBER_RE.exec(text);
    if (m) {
      pos = NUMBER_RE.lastIndex;
      return { kind: 'number', raw: m[0], start, end: pos };
    }
    return fail('unexpected token');
  };

  const node = parseValue();
  skipWs();
  if (pos !== text.length) fail('trailing characters');
  return node;
}

/**
 * Builds an AST from an already-parsed JS value. Number formatting is lost
 * here. Integral numbers under a key in `floatKeys` are marked as floats, so
 * `{ amount: 10 }` can still encode as PHP's `10.0`.
 */
export function fromValue(value: unknown, floatKeys: ReadonlySet<string> = new Set()): JsonNode {
  const span = { start: -1, end: -1 };
  const walk = (v: unknown, key: string | undefined): JsonNode => {
    if (v === null) return { kind: 'null', ...span };
    if (typeof v === 'string') return { kind: 'string', value: v, ...span };
    if (typeof v === 'boolean') return { kind: 'boolean', value: v, ...span };
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) return { kind: 'null', ...span };
      const raw =
        Number.isInteger(v) && key !== undefined && floatKeys.has(key) ? `${v}.0` : String(v);
      return { kind: 'number', raw, ...span };
    }
    if (Array.isArray(v)) {
      return {
        kind: 'array',
        items: v.map((item) => walk(item === undefined ? null : item, undefined)),
        ...span,
      };
    }
    if (typeof v === 'object') {
      const entries: Array<[string, JsonNode]> = [];
      for (const [k, child] of Object.entries(v as Record<string, unknown>)) {
        if (child === undefined || typeof child === 'function') continue;
        entries.push([k, walk(child, k)]);
      }
      return { kind: 'object', entries, ...span };
    }
    return { kind: 'null', ...span };
  };
  return walk(value, undefined);
}

/** Converts an AST back to a plain JS value (numbers become JS numbers). */
export function toValue(node: JsonNode): unknown {
  switch (node.kind) {
    case 'object': {
      const out: Record<string, unknown> = {};
      for (const [k, v] of node.entries) out[k] = toValue(v);
      return out;
    }
    case 'array':
      return node.items.map(toValue);
    case 'number':
      return Number(node.raw);
    case 'null':
      return null;
    default:
      return node.value;
  }
}

/**
 * Which reference implementation to match:
 *  - `php`: `json_encode(json_decode($json, true))`, the PHP sample in Helcim's docs.
 *  - `python`: `json.dumps(json.loads(s), separators=(',', ':'))`, the Python sample.
 *  - `js`: `JSON.stringify(JSON.parse(s))`.
 */
export type JsonEncodeStyle = 'php' | 'python' | 'js';

const hex4 = (code: number) => code.toString(16).padStart(4, '0');

function encodeString(value: string, style: JsonEncodeStyle): string {
  if (style === 'js') return JSON.stringify(value);
  let out = '"';
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    const ch = value[i]!;
    if (ch === '"') out += '\\"';
    else if (ch === '\\') out += '\\\\';
    else if (ch === '/' && style === 'php') out += '\\/';
    else if (ch === '\b') out += '\\b';
    else if (ch === '\f') out += '\\f';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    // Both PHP and Python (ensure_ascii) escape anything outside printable
    // ASCII. They work in UTF-16 code units, so astral chars become surrogate
    // pairs, just like iterating a JS string.
    else if (code < 0x20 || code > 0x7f) out += `\\u${hex4(code)}`;
    else out += ch;
  }
  return out + '"';
}

function encodeNumber(raw: string, style: JsonEncodeStyle): string {
  const isFloat = /[.eE]/.test(raw);
  const n = Number(raw);
  if (style === 'js' || !isFloat) return style === 'js' ? String(n) : raw;
  // PHP >= 7.1 (serialize_precision = -1) and Python both print the shortest
  // round-trip repr, which is what JS gives. Integral floats get a ".0".
  let s = String(n);
  if (/^-?\d+$/.test(s)) s += '.0';
  else if (style === 'php' && /^-?\d+e/.test(s)) s = s.replace('e', '.0e');
  return s;
}

/** True when PHP's `json_decode(..., true)` would turn this object into a list. */
function isPhpList(entries: Array<[string, JsonNode]>): boolean {
  return entries.every(([k], i) => k === String(i));
}

export function encodeJson(node: JsonNode, style: JsonEncodeStyle): string {
  switch (node.kind) {
    case 'object': {
      if (style === 'php' && isPhpList(node.entries)) {
        return `[${node.entries.map(([, v]) => encodeJson(v, style)).join(',')}]`;
      }
      const parts = node.entries.map(
        ([k, v]) => `${encodeString(k, style)}:${encodeJson(v, style)}`,
      );
      return `{${parts.join(',')}}`;
    }
    case 'array':
      return `[${node.items.map((item) => encodeJson(item, style)).join(',')}]`;
    case 'string':
      return encodeString(node.value, style);
    case 'number':
      return encodeNumber(node.raw, style);
    case 'boolean':
      return node.value ? 'true' : 'false';
    case 'null':
      return 'null';
  }
}

/** Shorthand for PHP-compatible `json_encode` of a JS value. */
export function phpJsonEncode(value: unknown, floatKeys?: Iterable<string>): string {
  return encodeJson(fromValue(value, new Set(floatKeys)), 'php');
}
