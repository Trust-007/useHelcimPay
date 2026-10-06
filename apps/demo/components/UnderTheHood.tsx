'use client';

import { useEffect, useRef, useState } from 'react';
import type { HelcimPayError, HelcimPayStatus } from 'use-helcim-pay';
import { AlertIcon, CheckIcon, Spinner } from './icons';

export interface LogEntry {
  id: number;
  at: Date;
  tone: 'info' | 'step' | 'ok' | 'warn' | 'error';
  text: string;
}

type StepState = 'todo' | 'active' | 'done' | 'failed' | 'stopped';

function steps(mode: 'mock' | 'live') {
  const helcim = mode === 'mock' ? 'simulated Helcim' : 'Helcim';
  return [
    { title: 'Create checkout session', where: `Server → ${helcim} initialize API` },
    {
      title: 'Customer pays',
      where: `${mode === 'mock' ? 'Simulated ' : ''}HelcimPay.js modal (iframe)`,
    },
    { title: 'Verify response hash', where: 'Server, using the secret token' },
    { title: 'Order confirmed', where: 'Receipt shown' },
  ];
}

/** Maps the hook's status to a state for each of the four steps. */
function stepStates(status: HelcimPayStatus, error: HelcimPayError | null): StepState[] {
  switch (status) {
    case 'idle':
      return ['todo', 'todo', 'todo', 'todo'];
    case 'initializing':
      return ['active', 'todo', 'todo', 'todo'];
    case 'open':
      return ['done', 'active', 'todo', 'todo'];
    case 'declined':
      return ['done', 'failed', 'todo', 'todo'];
    case 'closed':
      return ['done', 'stopped', 'todo', 'todo'];
    case 'validating':
      return ['done', 'done', 'active', 'todo'];
    case 'success':
      return ['done', 'done', 'done', 'done'];
    case 'error': {
      const code = error?.code;
      if (code === 'INIT_FAILED' || code === 'SCRIPT_LOAD_FAILED')
        return ['failed', 'todo', 'todo', 'todo'];
      if (code === 'VALIDATION_FAILED') return ['done', 'done', 'failed', 'todo'];
      return ['done', 'failed', 'todo', 'todo'];
    }
  }
}

const CLIENT_CODE = `'use client';
import { createCheckoutClient, useHelcimPay } from 'use-helcim-pay';

const client = createCheckoutClient<Cart>({
  initializeUrl: '/api/checkout/initialize',
  validateUrl: '/api/checkout/validate',
});

export function CheckoutButton({ cart }: { cart: Cart }) {
  const { startCheckout, status, error, isBusy } = useHelcimPay({
    ...client,
    onSuccess: ({ transaction }) => showReceipt(transaction),
  });

  return (
    <button disabled={isBusy} onClick={() => startCheckout(cart)}>
      {status === 'validating' ? 'Verifying…' : 'Pay'}
    </button>
  );
}`;

const SERVER_CODE = `// app/api/checkout/[action]/route.ts
import { createCheckoutHandlers } from 'use-helcim-pay/server';

const { initialize, validate } = createCheckoutHandlers<Cart>({
  apiToken: process.env.HELCIM_API_TOKEN!,
  cookieSecret: process.env.CHECKOUT_COOKIE_SECRET!,
  // The price is computed here, never trusted from the browser.
  getOrder: (cart) => ({ amount: priceOf(cart), currency: 'CAD' }),
  onVerified: ({ transaction }) => markOrderPaid(transaction),
});

export async function POST(req: Request, ctx: RouteContext<'/api/checkout/[action]'>) {
  const { action } = await ctx.params;
  return action === 'initialize' ? initialize(req) : validate(req);
}`;

export function UnderTheHood({
  mode,
  status,
  error,
  log,
}: {
  mode: 'mock' | 'live';
  status: HelcimPayStatus;
  error: HelcimPayError | null;
  log: LogEntry[];
}) {
  const states = stepStates(status, error);
  const [tab, setTab] = useState<'client' | 'server'>('client');
  const logEnd = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const el = logEnd.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log.length]);

  return (
    <aside aria-labelledby="hood-heading" className="flex min-w-0 flex-col gap-4">
      <div className="rounded-xl border border-border bg-surface p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 id="hood-heading" className="font-semibold">
            Under the hood
          </h2>
          <code className="rounded-md bg-surface-2 px-2 py-0.5 font-mono text-xs text-muted">
            status: <span className="text-fg">{status}</span>
          </code>
        </div>

        <ol className="mt-4 space-y-3">
          {steps(mode).map((step, i) => (
            <li key={step.title} className="flex gap-3">
              <StepMarker state={states[i]!} index={i} />
              <div className="min-w-0">
                <p className={`text-sm font-medium ${states[i] === 'todo' ? 'text-muted' : ''}`}>
                  {step.title}
                  {states[i] === 'stopped' && (
                    <span className="font-normal text-muted"> (closed)</span>
                  )}
                  {states[i] === 'failed' && (
                    <span className="font-normal text-danger"> (failed)</span>
                  )}
                </p>
                <p className="text-xs text-muted">{step.where}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>

      <div className="rounded-xl border border-border bg-surface">
        <h3 className="border-b border-border px-5 py-3 text-sm font-semibold">Event log</h3>
        <ol
          ref={logEnd}
          className="max-h-56 space-y-1.5 overflow-y-auto px-5 py-3 font-mono text-xs"
          aria-label="Checkout events"
        >
          {log.map((entry) => (
            <li key={entry.id} className="flex gap-2">
              <time className="tabular shrink-0 text-muted" dateTime={entry.at.toISOString()}>
                {entry.at.toLocaleTimeString([], { hour12: false })}
              </time>
              <span className={TONE[entry.tone]}>{entry.text}</span>
            </li>
          ))}
        </ol>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <div
          role="tablist"
          aria-label="Example code"
          className="flex border-b border-border text-sm"
        >
          {(['client', 'server'] as const).map((key) => (
            <button
              key={key}
              role="tab"
              type="button"
              aria-selected={tab === key}
              aria-controls="code-panel"
              onClick={() => setTab(key)}
              className={`px-4 py-2.5 font-medium focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent ${
                tab === key ? 'border-b-2 border-accent text-fg' : 'text-muted hover:text-fg'
              }`}
            >
              {key === 'client' ? 'Client (hook)' : 'Server (route)'}
            </button>
          ))}
        </div>
        <pre
          id="code-panel"
          role="tabpanel"
          tabIndex={0}
          className="max-h-80 overflow-auto bg-code-bg p-4 font-mono text-xs leading-relaxed text-code-fg"
        >
          <code>{tab === 'client' ? CLIENT_CODE : SERVER_CODE}</code>
        </pre>
      </div>
    </aside>
  );
}

const TONE: Record<LogEntry['tone'], string> = {
  info: 'text-muted',
  step: 'text-fg',
  ok: 'text-success',
  warn: 'text-danger',
  error: 'text-danger',
};

function StepMarker({ state, index }: { state: StepState; index: number }) {
  const base = 'mt-0.5 grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold';
  switch (state) {
    case 'done':
      return (
        <span className={`${base} bg-success-bg text-success`} aria-label="done">
          <CheckIcon className="size-3.5" />
        </span>
      );
    case 'active':
      return (
        <span className={`${base} bg-accent text-accent-fg`} aria-label="in progress">
          <Spinner className="size-3" />
        </span>
      );
    case 'failed':
      return (
        <span className={`${base} bg-danger-bg text-danger`} aria-label="failed">
          <AlertIcon className="size-3.5" />
        </span>
      );
    default:
      return (
        <span
          className={`${base} border border-border text-muted`}
          aria-label={state === 'stopped' ? 'closed' : 'not started'}
        >
          {index + 1}
        </span>
      );
  }
}
