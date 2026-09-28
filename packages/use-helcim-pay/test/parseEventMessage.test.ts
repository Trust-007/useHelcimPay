import { parseEventMessage } from '../src/shared/parseEventMessage';
import { HelcimPayError } from '../src/types';

const data = { transactionId: 1, amount: 10, status: 'APPROVED' };

describe('parseEventMessage', () => {
  it('parses a JSON string with top-level { hash, data } and keeps the raw data text', () => {
    const msg = '{"hash":"h1","data":{"transactionId":1,"amount":10.00}}';
    expect(parseEventMessage(msg)).toEqual({
      hash: 'h1',
      data: { transactionId: 1, amount: 10 },
      rawData: '{"transactionId":1,"amount":10.00}',
    });
  });

  it('unwraps { data: { hash, data } } nesting', () => {
    const msg = JSON.stringify({ data: { hash: 'h2', data } });
    expect(parseEventMessage(msg)).toMatchObject({ hash: 'h2', data });
  });

  it('unwraps double-encoded JSON and points rawData at the inner text', () => {
    const inner = '{"hash":"h3","data":{"amount":5.50}}';
    const msg = JSON.stringify({ data: inner });
    expect(parseEventMessage(msg)).toMatchObject({ hash: 'h3', rawData: '{"amount":5.50}' });
  });

  it('accepts already-parsed objects (no rawData)', () => {
    const parsed = parseEventMessage({ data: { hash: 'h4', data } });
    expect(parsed).toEqual({ hash: 'h4', data });
  });

  it.each([
    ['not json', 'nope'],
    ['missing hash', '{"data":{"a":1}}'],
    ['array data', '{"hash":"x","data":[1]}'],
    ['number', 42],
    ['null', null],
    ['declined error string', 'HelcimPay.js transaction failed - card declined'],
  ])('throws INVALID_MESSAGE for %s', (_label, input) => {
    expect(() => parseEventMessage(input)).toThrow(HelcimPayError);
    try {
      parseEventMessage(input);
    } catch (e) {
      expect((e as HelcimPayError).code).toBe('INVALID_MESSAGE');
    }
  });
});
