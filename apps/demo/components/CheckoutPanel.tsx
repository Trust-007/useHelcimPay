'use client';

import type { ReactNode } from 'react';
import type { HelcimPayError, UseHelcimPayReturn } from 'use-helcim-pay';
import { formatCents, type Cart } from '@/lib/catalog';
import { AlertIcon, LockIcon, Spinner } from './icons';

type Pay = UseHelcimPayReturn<Cart, unknown>;

/** What to tell the shopper for each error code. */
function describeError(error: HelcimPayError): { title: string; body: string } {
  switch (error.code) {
    case 'INIT_FAILED':
      return { title: "Checkout couldn't start", body: error.message };
    case 'SCRIPT_LOAD_FAILED':
      return {
        title: "The payment window didn't load",
        body: 'HelcimPay.js could not be loaded. Check your connection or pause content blockers, then try again.',
      };
    case 'TOKEN_EXPIRED':
      return {
        title: 'Checkout timed out',
        body: 'Secure checkout sessions last 60 minutes. Start again. You were not charged.',
      };
    case 'VALIDATION_FAILED':
      return {
        title: "We couldn't verify this payment",
        body: `${error.message} No order was placed.`,
      };
    case 'INVALID_MESSAGE':
      return { title: 'Unexpected response from the payment window', body: error.message };
    default:
      return { title: 'Something went wrong', body: error.message };
  }
}

export function CheckoutPanel({
  pay,
  totalCents,
  onPay,
}: {
  pay: Pay;
  totalCents: number;
  onPay: () => void;
}) {
  const { status, error, isOpen } = pay;
  const empty = totalCents === 0;
  const total = formatCents(totalCents);

  let label = `Pay ${total}`;
  let busy = false;
  if (status === 'initializing') {
    label = 'Opening secure checkout…';
    busy = true;
  } else if (status === 'validating') {
    label = 'Verifying payment…';
    busy = true;
  } else if (isOpen) {
    label = 'Complete payment in the secure window';
  } else if (status === 'declined' || status === 'error') {
    label = `Try again · ${total}`;
  }
  const disabled = empty || busy || isOpen;
  const described = status === 'error' && error ? describeError(error) : undefined;

  return (
    <div className="border-t border-border px-5 py-5">
      <dl className="flex items-baseline justify-between">
        <dt className="text-muted">Total</dt>
        <dd className="tabular text-2xl font-semibold tracking-tight">
          {total} <span className="text-sm font-normal text-muted">CAD</span>
        </dd>
      </dl>

      <div aria-live="polite">
        {status === 'declined' && error && (
          <Callout tone="danger" title="Card declined">
            {error.message.replace(/^HelcimPay\.js transaction failed - /, '')}.{' '}
            {isOpen
              ? 'Try another card in the payment window.'
              : 'Nothing was charged. You can try again.'}
          </Callout>
        )}
        {described && error && (
          <Callout tone="danger" title={described.title}>
            {described.body}
            <span className="mt-1 block font-mono text-xs opacity-80">{error.code}</span>
          </Callout>
        )}
        {status === 'closed' && (
          <Callout tone="neutral" title="Checkout closed">
            The payment window was closed before paying. Nothing was charged, and your cart is
            saved.
          </Callout>
        )}
        {status === 'validating' && (
          <Callout tone="neutral" title="Payment received">
            Confirming it with our server. This takes a moment.
          </Callout>
        )}
      </div>

      <button
        type="button"
        onClick={onPay}
        disabled={disabled}
        aria-busy={busy}
        className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-3 font-medium text-accent-fg transition-colors hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? <Spinner /> : <LockIcon className="size-4" />}
        {empty ? 'Add something to your cart' : label}
      </button>
      <p className="mt-3 text-center text-xs text-muted">
        Card details are entered in Helcim&apos;s secure window and never touch this site.
      </p>
    </div>
  );
}

function Callout({
  tone,
  title,
  children,
}: {
  tone: 'danger' | 'neutral';
  title: string;
  children: ReactNode;
}) {
  const styles =
    tone === 'danger'
      ? 'border-danger/30 bg-danger-bg text-danger'
      : 'border-border bg-surface-2 text-fg';
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={`mt-4 flex gap-3 rounded-lg border px-4 py-3 text-sm ${styles}`}
    >
      <AlertIcon className="mt-0.5 size-4 shrink-0" />
      <div>
        <p className="font-semibold">{title}</p>
        <p className="mt-0.5 opacity-90">{children}</p>
      </div>
    </div>
  );
}
