'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createCheckoutClient, useHelcimPay } from 'use-helcim-pay';
import type { ValidateResponseBody } from 'use-helcim-pay/server';
import {
  cartTotalCents,
  DEFAULT_CART,
  formatCents,
  MAX_QTY,
  PRODUCTS,
  type Cart,
  type Product,
} from '@/lib/catalog';
import { CheckoutPanel } from './CheckoutPanel';
import { MinusIcon, MugIcon, PlusIcon, StickersIcon, ToteIcon } from './icons';
import { Receipt } from './Receipt';
import { UnderTheHood, type LogEntry } from './UnderTheHood';

const ICONS = { tote: ToteIcon, mug: MugIcon, stickers: StickersIcon } as const;
const stripPrefix = (message: string) =>
  message.replace(/^HelcimPay\.js transaction failed - /, '');

export function Storefront({ mode, scriptUrl }: { mode: 'mock' | 'live'; scriptUrl?: string }) {
  const [qty, setQty] = useState<Record<string, number>>(DEFAULT_CART);
  const [log, setLog] = useState<LogEntry[]>([]);
  const logId = useRef(0);

  const addLog = useCallback((tone: LogEntry['tone'], text: string) => {
    setLog((prev) => [...prev.slice(-24), { id: ++logId.current, at: new Date(), tone, text }]);
  }, []);

  // Timestamps only exist on the client (so server HTML matches), and the ref
  // keeps StrictMode's double effect from logging this twice.
  const greeted = useRef(false);
  useEffect(() => {
    if (greeted.current) return;
    greeted.current = true;
    addLog(
      'info',
      mode === 'mock' ? 'Ready. Using the HelcimPay.js simulator.' : 'Ready. Using live Helcim.',
    );
  }, [mode, addLog]);

  // The two server endpoints come from createCheckoutHandlers() on the server.
  const client = useMemo(
    () =>
      createCheckoutClient<Cart>({
        initializeUrl: '/api/checkout/initialize',
        validateUrl: '/api/checkout/validate',
      }),
    [],
  );

  const pay = useHelcimPay<Cart, ValidateResponseBody>({
    ...client,
    scriptUrl,
    onDeclined: (error) => addLog('warn', `Card declined: ${stripPrefix(error.message)}`),
    onClose: () => addLog('info', 'Customer closed the payment window. Nothing was charged.'),
    onSuccess: (result) =>
      addLog(
        'ok',
        `Server verified the hash. Transaction ${String(result.transaction.transactionId)} is paid.`,
      ),
    onError: (error) => addLog('error', `${error.code}: ${error.message}`),
  });

  // Log each status change, so the panel mirrors the hook's state machine.
  const { status } = pay;
  useEffect(() => {
    const messages: Partial<Record<typeof status, string>> = {
      initializing:
        'POST /api/checkout/initialize → server gets a checkout token; payment script loads',
      open: 'appendHelcimPayIframe(checkoutToken): payment window open',
      validating: 'SUCCESS event → POST /api/checkout/validate (hash checked on the server)',
    };
    const message = messages[status];
    if (message) addLog('step', message);
  }, [status, addLog]);

  const cart: Cart = {
    items: PRODUCTS.filter((p) => (qty[p.id] ?? 0) > 0).map((p) => ({ id: p.id, qty: qty[p.id]! })),
  };
  const totalCents = cart.items.length ? cartTotalCents(cart) : 0;
  const locked = pay.isBusy || pay.isOpen || pay.status === 'success';

  const change = (id: string, delta: number) =>
    setQty((prev) => ({
      ...prev,
      [id]: Math.min(MAX_QTY, Math.max(0, (prev[id] ?? 0) + delta)),
    }));

  const newOrder = () => {
    pay.reset();
    setQty(DEFAULT_CART);
    addLog('info', 'Started a new order.');
  };

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
      <section
        aria-labelledby="cart-heading"
        className="min-w-0 self-start rounded-xl border border-border bg-surface"
      >
        {pay.status === 'success' && pay.result ? (
          <Receipt result={pay.result} onNewOrder={newOrder} />
        ) : (
          <>
            <div className="flex items-baseline justify-between border-b border-border px-5 py-4">
              <h2 id="cart-heading" className="font-semibold">
                Your cart
              </h2>
              <span className="text-sm text-muted">Prices in CAD</span>
            </div>
            <ul className="divide-y divide-border">
              {PRODUCTS.map((product) => (
                <ProductRow
                  key={product.id}
                  product={product}
                  qty={qty[product.id] ?? 0}
                  disabled={locked}
                  onChange={(delta) => change(product.id, delta)}
                />
              ))}
            </ul>
            <CheckoutPanel
              pay={pay}
              mode={mode}
              totalCents={totalCents}
              onPay={() => void pay.startCheckout(cart)}
            />
          </>
        )}
      </section>

      <UnderTheHood mode={mode} status={pay.status} error={pay.error} log={log} />
    </div>
  );
}

function ProductRow({
  product,
  qty,
  disabled,
  onChange,
}: {
  product: Product;
  qty: number;
  disabled: boolean;
  onChange: (delta: number) => void;
}) {
  const Icon = ICONS[product.icon];
  const stepper =
    'grid size-8 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-fg disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-accent';
  return (
    <li className="flex items-center gap-4 px-5 py-4">
      <span
        className="grid size-12 shrink-0 place-items-center rounded-lg"
        style={{
          backgroundColor: `color-mix(in srgb, ${product.tint} 14%, transparent)`,
          color: product.tint,
        }}
      >
        <Icon className="size-6" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-medium">{product.name}</p>
        <p className="text-sm text-pretty text-muted sm:truncate">{product.blurb}</p>
      </div>
      <div className="flex flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-4">
        <span className="tabular text-sm text-muted sm:w-16 sm:text-right">
          {formatCents(product.priceCents)}
        </span>
        <div
          className="flex items-center rounded-lg border border-border"
          role="group"
          aria-label={`${product.name} quantity`}
        >
          <button
            type="button"
            className={stepper}
            onClick={() => onChange(-1)}
            disabled={disabled || qty === 0}
            aria-label={`Remove one ${product.name}`}
          >
            <MinusIcon className="size-4" />
          </button>
          <output className="tabular w-6 text-center text-sm font-medium">{qty}</output>
          <button
            type="button"
            className={stepper}
            onClick={() => onChange(1)}
            disabled={disabled || qty >= MAX_QTY}
            aria-label={`Add one ${product.name}`}
          >
            <PlusIcon className="size-4" />
          </button>
        </div>
      </div>
    </li>
  );
}
