import { encodeJson, fromValue, parseJson, phpJsonEncode, toValue } from '../src/shared/json';
import pythonCases from './fixtures/python-json.json';

/** Builds a JSON `\uXXXX` escape without writing one literally in source. */
const u = (hex: string) => '\\' + 'u' + hex;

describe('parseJson', () => {
  it('round-trips values like JSON.parse', () => {
    const text = '{"a":[1,2.5,{"b":null}],"c":"x\\ny","d":true,"e":false,"f":-0.001e3}';
    expect(toValue(parseJson(text))).toEqual(JSON.parse(text));
  });

  it('records source spans for nested values', () => {
    const text = '{ "hash": "abc", "data": { "amount": 10.00 } }';
    const root = parseJson(text);
    if (root.kind !== 'object') throw new Error('expected object');
    const data = root.entries.find(([k]) => k === 'data')![1];
    expect(text.slice(data.start, data.end)).toBe('{ "amount": 10.00 }');
  });

  it('keeps number lexemes as written', () => {
    const root = parseJson('[10.00, 3, 1e21]');
    if (root.kind !== 'array') throw new Error('expected array');
    expect(root.items.map((n) => (n.kind === 'number' ? n.raw : null))).toEqual([
      '10.00',
      '3',
      '1e21',
    ]);
  });

  it.each(['', '{', '{"a":}', '[1,]', '{"a":1} x', '"unterminated', 'tru', '{a:1}'])(
    'rejects invalid JSON %j',
    (bad) => {
      expect(() => parseJson(bad)).toThrow(SyntaxError);
    },
  );
});

describe("encodeJson('python') matches CPython json.dumps(json.loads(s), separators=(',', ':'))", () => {
  it.each(pythonCases.map((c) => [c.input, c.expected] as const))('%s', (input, expected) => {
    expect(encodeJson(parseJson(input), 'python')).toBe(expected);
  });
});

describe("encodeJson('php') matches PHP json_encode(json_decode($s, true))", () => {
  const cases: Array<[string, string]> = [
    ['{"amount":10.00,"currency":"CAD"}', '{"amount":10.0,"currency":"CAD"}'],
    ['{"url":"https://example.com/a/b"}', '{"url":"https:\\/\\/example.com\\/a\\/b"}'],
    ['{"name":"Renée Café"}', `{"name":"Ren${u('00e9')}e Caf${u('00e9')}"}`],
    ['{"emoji":"😀"}', `{"emoji":"${u('d83d')}${u('de00')}"}`],
    [`{"ctrl":"${u('001f')}","tab":"a\\tb"}`, `{"ctrl":"${u('001f')}","tab":"a\\tb"}`],
    // json_decode(..., true) turns {} into an empty array, and sequential keys into a list.
    ['{"empty":{},"list":{"0":"a","1":"b"}}', '{"empty":[],"list":["a","b"]}'],
    ['{"big":1e21,"neg":-2.50,"int":7}', '{"big":1.0e+21,"neg":-2.5,"int":7}'],
    ['{ "spaced" : [ 1 , 2 ] }', '{"spaced":[1,2]}'],
  ];
  it.each(cases)('%s', (input, expected) => {
    expect(encodeJson(parseJson(input), 'php')).toBe(expected);
  });
});

describe("encodeJson('js')", () => {
  it('matches JSON.stringify(JSON.parse(s))', () => {
    for (const { input } of pythonCases) {
      expect(encodeJson(parseJson(input), 'js')).toBe(JSON.stringify(JSON.parse(input)));
    }
  });
});

describe('phpJsonEncode / fromValue', () => {
  it('encodes integral floatKeys as floats', () => {
    expect(phpJsonEncode({ amount: 10, qty: 2 }, ['amount'])).toBe('{"amount":10.0,"qty":2}');
  });

  it('drops undefined and functions like JSON.stringify', () => {
    expect(phpJsonEncode({ a: undefined, b: () => 1, c: [undefined] })).toBe('{"c":[null]}');
  });

  it('builds nodes without source spans', () => {
    expect(fromValue('x')).toMatchObject({ kind: 'string', start: -1 });
  });
});
