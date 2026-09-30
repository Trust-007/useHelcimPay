import { Storefront } from '@/components/Storefront';
import { GitHubIcon } from '@/components/icons';
import { helcimMode, SIMULATOR_BASE_PATH } from '@/lib/helcim';

const REPO_URL = 'https://github.com/Trust-007/useHelcimPay';

export default function Home() {
  const mode = helcimMode();

  return (
    <div className="mx-auto flex min-h-dvh max-w-6xl flex-col px-4 sm:px-6">
      <header className="flex items-center justify-between gap-4 py-5">
        <a href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span
            aria-hidden="true"
            className="grid size-7 place-items-center rounded-md bg-accent font-mono text-xs text-accent-fg"
          >
            uH
          </span>
          useHelcimPay
          <span className="rounded-full border border-border px-2 py-0.5 text-xs font-medium text-muted">
            demo
          </span>
        </a>
        <a
          href={REPO_URL}
          className="inline-flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted hover:bg-surface-2 hover:text-fg focus-visible:outline-2 focus-visible:outline-accent"
        >
          <GitHubIcon className="size-4" />
          <span className="hidden sm:inline">Source on GitHub</span>
          <span className="sm:hidden">GitHub</span>
        </a>
      </header>

      <section className="pb-6 pt-4 sm:pt-8">
        <h1 className="max-w-2xl text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          A React hook for HelcimPay.js
        </h1>
        <p className="mt-3 max-w-2xl text-pretty text-muted">
          Helcim&apos;s payment modal is vanilla JavaScript.{' '}
          <code className="font-mono text-fg">useHelcimPay()</code> handles checkout initialization,
          the payment iframe and server-side hash validation, with full TypeScript types. Build a
          cart and check out below; the right-hand panel shows each step as it happens.
        </p>
      </section>

      {mode === 'mock' ? (
        <aside
          role="note"
          className="mb-6 rounded-lg border border-warn-border bg-warn-bg px-4 py-3 text-sm text-warn"
        >
          <strong className="font-semibold">Simulator mode.</strong> This demo runs against a
          built-in HelcimPay.js simulator that follows Helcim&apos;s published API. There is no
          Helcim account and no real charge. Use test card{' '}
          <span className="font-mono tabular">4242 4242 4242 4242</span>, any future expiry and any
          CVV, or pick another test card in the payment window.
        </aside>
      ) : (
        <aside
          role="note"
          className="mb-6 rounded-lg border border-border bg-surface px-4 py-3 text-sm text-muted"
        >
          <strong className="font-semibold text-fg">Live Helcim.</strong> Payments go to a Helcim
          test account. Use Helcim&apos;s test cards only.
        </aside>
      )}

      <main className="flex-1">
        <Storefront
          mode={mode}
          scriptUrl={mode === 'mock' ? `${SIMULATOR_BASE_PATH}/start.js` : undefined}
        />
      </main>

      <footer className="mt-12 border-t border-border py-6 text-sm text-muted">
        Built with{' '}
        <a className="underline underline-offset-2 hover:text-fg" href={REPO_URL}>
          use-helcim-pay
        </a>
        . Not affiliated with Helcim.
      </footer>
    </div>
  );
}
