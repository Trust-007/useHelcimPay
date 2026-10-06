// @vitest-environment happy-dom
import { loadHelcimPayScript, resetHelcimPayScriptCache } from '../src/loadScript';
import { HelcimPayError } from '../src/types';

const SRC = 'https://secure.helcim.app/helcim-pay/services/start.js';
// Script tags go into a detached container, so the DOM never fetches them and
// each test decides when 'load' or 'error' fires.
let container: HTMLDivElement;
const scripts = () => Array.from(container.querySelectorAll<HTMLScriptElement>('script'));

beforeEach(() => {
  container = document.createElement('div');
  vi.spyOn(document.head, 'appendChild').mockImplementation((node) => container.appendChild(node));
});

afterEach(() => {
  resetHelcimPayScriptCache();
  vi.restoreAllMocks();
  delete window.appendHelcimPayIframe;
  delete window.removeHelcimPayIframe;
});

describe('loadHelcimPayScript', () => {
  it('resolves immediately when HelcimPay.js is already on the page', async () => {
    window.appendHelcimPayIframe = vi.fn();
    await expect(loadHelcimPayScript(SRC)).resolves.toMatchObject({
      appendHelcimPayIframe: window.appendHelcimPayIframe,
    });
    expect(scripts()).toHaveLength(0);
  });

  it('injects one script tag for concurrent callers and resolves on load', async () => {
    const a = loadHelcimPayScript(SRC);
    const b = loadHelcimPayScript(SRC);
    expect(a).toBe(b);
    expect(scripts()).toHaveLength(1);
    expect(scripts()[0]!.src).toBe(SRC);

    window.appendHelcimPayIframe = vi.fn();
    scripts()[0]!.dispatchEvent(new Event('load'));
    await expect(a).resolves.toHaveProperty('appendHelcimPayIframe');
  });

  it('fails if the script loads without defining the globals', async () => {
    const p = loadHelcimPayScript(SRC);
    scripts()[0]!.dispatchEvent(new Event('load'));
    await expect(p).rejects.toMatchObject({ code: 'SCRIPT_LOAD_FAILED' });
  });

  it('removes the failed tag so a later call can retry', async () => {
    const first = loadHelcimPayScript(SRC);
    scripts()[0]!.dispatchEvent(new Event('error'));
    await expect(first).rejects.toBeInstanceOf(HelcimPayError);
    expect(scripts()).toHaveLength(0);

    const retry = loadHelcimPayScript(SRC);
    expect(retry).not.toBe(first);
    window.appendHelcimPayIframe = vi.fn();
    scripts()[0]!.dispatchEvent(new Event('load'));
    await expect(retry).resolves.toBeDefined();
  });
});
