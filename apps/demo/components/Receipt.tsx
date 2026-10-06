'use client';

import { useEffect, useRef } from 'react';
import type { HelcimPayResult } from 'use-helcim-pay';
import { formatCents } from '@/lib/catalog';
import { CheckIcon } from './icons';

/** "424242******4242" → "4242 •••• 4242" */
function maskCard(cardNumber: unknown): string {
  const digits = String(cardNumber ?? '');
  if (digits.length < 8) return digits || '—';
  return `${digits.slice(0, 4)} •••• ${digits.slice(-4)}`;
}

export function Receipt({
  result,
  onNewOrder,
}: {
  result: HelcimPayResult<unknown>;
  onNewOrder: () => void;
}) {
  // Move focus to the confirmation so keyboard and screen-reader users land on it.
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);

  const tx = result.transaction;
  const currency = String(tx.currency ?? 'CAD');
  const rows: Array<[string, string]> = [
    ['Amount', `${formatCents(Math.round(Number(tx.amount) * 100), currency)} ${currency}`],
    ['Card', maskCard(tx.cardNumber)],
    ['Cardholder', String(tx.cardHolderName || '—')],
    ['Approval code', String(tx.approvalCode || '—')],
    ['Transaction ID', String(tx.transactionId)],
    ['Invoice', String(tx.invoiceNumber || '—')],
    ['Date', String(tx.dateCreated || '—')],
  ];

  return (
    <div className="px-5 py-8 sm:px-8">
      <div className="grid size-12 place-items-center rounded-full bg-success-bg text-success">
        <CheckIcon className="size-6" />
      </div>
      <h2
        ref={heading}
        tabIndex={-1}
        className="mt-4 text-xl font-semibold tracking-tight outline-none"
      >
        Payment confirmed
      </h2>
      <p className="mt-1 text-sm text-muted">
        {result.verified
          ? 'The card was approved, and our server checked the response hash against this checkout’s secret token before confirming the order.'
          : 'The card was approved. This response was not verified on a server.'}
      </p>

      <dl className="mt-6 divide-y divide-border rounded-lg border border-border text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-4 px-4 py-2.5">
            <dt className="text-muted">{label}</dt>
            <dd className="tabular truncate text-right font-medium">{value}</dd>
          </div>
        ))}
      </dl>

      {result.verified && (
        <p className="mt-4 inline-flex items-center gap-2 rounded-full bg-success-bg px-3 py-1 text-xs font-medium text-success">
          <CheckIcon className="size-3.5" />
          Hash verified server-side
        </p>
      )}

      <button
        type="button"
        onClick={onNewOrder}
        className="mt-8 w-full rounded-lg border border-border px-4 py-2.5 font-medium hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        Start a new order
      </button>
    </div>
  );
}
