import { HelcimPayError } from './types';

export const DEFAULT_HELCIM_PAY_SCRIPT_URL =
  'https://secure.helcim.app/helcim-pay/services/start.js';

/** Globals defined by HelcimPay.js `start.js`. */
export interface HelcimPayGlobals {
  appendHelcimPayIframe: (checkoutToken: string, allowExit?: boolean) => void;
  removeHelcimPayIframe?: () => void;
}

declare global {
  interface Window {
    appendHelcimPayIframe?: HelcimPayGlobals['appendHelcimPayIframe'];
    removeHelcimPayIframe?: HelcimPayGlobals['removeHelcimPayIframe'];
  }
}

const pending = new Map<string, Promise<HelcimPayGlobals>>();

function globalsIfReady(): HelcimPayGlobals | undefined {
  if (typeof window.appendHelcimPayIframe !== 'function') return undefined;
  return {
    appendHelcimPayIframe: window.appendHelcimPayIframe,
    removeHelcimPayIframe: window.removeHelcimPayIframe,
  };
}

/**
 * Loads HelcimPay.js once per URL and resolves with its globals.
 *
 * - It resolves right away if `appendHelcimPayIframe` already exists (e.g.
 *   you added the `<script>` tag yourself).
 * - Concurrent callers share one `<script>` tag and one promise.
 * - On failure the tag and the cache entry are removed, so a later call retries.
 *
 * @throws {HelcimPayError} code `SCRIPT_LOAD_FAILED`.
 */
export function loadHelcimPayScript(
  src: string = DEFAULT_HELCIM_PAY_SCRIPT_URL,
): Promise<HelcimPayGlobals> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.reject(
      new HelcimPayError('SCRIPT_LOAD_FAILED', 'HelcimPay.js can only be loaded in a browser'),
    );
  }

  const ready = globalsIfReady();
  if (ready) return Promise.resolve(ready);

  const existing = pending.get(src);
  if (existing) return existing;

  const promise = new Promise<HelcimPayGlobals>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.dataset.helcimPay = '';

    const fail = (message: string, cause?: unknown) => {
      pending.delete(src);
      script.remove();
      reject(new HelcimPayError('SCRIPT_LOAD_FAILED', message, { cause }));
    };

    script.addEventListener('load', () => {
      const globals = globalsIfReady();
      if (globals) resolve(globals);
      else fail(`${src} loaded but did not define appendHelcimPayIframe()`);
    });
    script.addEventListener('error', (event) => fail(`Failed to load ${src}`, event));

    document.head.appendChild(script);
  });

  pending.set(src, promise);
  return promise;
}

/** Test helper: forget cached script loads. */
export function resetHelcimPayScriptCache(): void {
  pending.clear();
}
