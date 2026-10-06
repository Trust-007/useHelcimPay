"""Generates test/fixtures/python-json.json from CPython's json module.

Each case records json.dumps(json.loads(input), separators=(',', ':')),
the exact snippet in Helcim's "Validate a HelcimPay.js Payment" docs.
Run: py scripts/gen-python-fixtures.py   (or python3 on macOS/Linux)
"""
import json
import pathlib

# Raw strings: the escapes below are JSON escapes, not Python ones.
inputs = [
    r'{"amount":10.00,"currency":"CAD"}',
    r'{"amount": 10.5, "qty": 3}',
    r'{"name":"Renée Café","url":"https://example.com/a/b"}',
    r'{"emoji":"😀","tab":"a\tb","nl":"a\nb","ctrl":"\u0001"}',
    r'{"quote":"say \"hi\"","backslash":"a\\b"}',
    r'{"nested":{"list":[1,2.0,{"x":null,"y":true,"z":false}]}}',
    r'{"empty":{},"emptyList":[]}',
    r'{"big":1e21,"small":0.1,"neg":-2.50}',
    r'{"transactionId":20163175,"dateCreated":"2024-05-01 10:22:13","cardBatchId":3421,"status":"APPROVED","type":"purchase","amount":15.45,"currency":"CAD","avsResponse":"X","cvvResponse":"M","approvalCode":"T3E5ST","cardToken":"27f0ee9bf5bd2b37849b41","cardNumber":"4242********4242","cardHolderName":"Jane O’Neil","customerCode":"CST1049","invoiceNumber":"INV-1043/2024","warning":""}',
]

cases = [
    {"input": s, "expected": json.dumps(json.loads(s), separators=(",", ":"))}
    for s in inputs
]
out = pathlib.Path(__file__).resolve().parent.parent / "test" / "fixtures" / "python-json.json"
out.write_text(json.dumps(cases, indent=2, ensure_ascii=True) + "\n", encoding="utf-8")
print(f"wrote {len(cases)} cases to {out}")
