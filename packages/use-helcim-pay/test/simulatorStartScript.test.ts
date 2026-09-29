// @vitest-environment happy-dom
import { renderStartScript } from '../src/testing/startScript';

// Run the simulator's start.js in a DOM and check it defines the same
// globals as HelcimPay.js.
const BASE = `${window.location.origin}/mock-helcim/checkout/`;
const frame = () => document.getElementById('helcimPayIframe') as HTMLIFrameElement | null;

beforeEach(() => {
  // Keep the DOM from actually navigating the iframe.
  vi.spyOn(document.body, 'appendChild').mockImplementation((node) => {
    if (node instanceof HTMLIFrameElement) node.removeAttribute('src');
    return Node.prototype.appendChild.call(document.body, node) as never;
  });
  new Function(renderStartScript(BASE))();
});

afterEach(() => {
  window.removeHelcimPayIframe?.();
  delete window.appendHelcimPayIframe;
  delete window.removeHelcimPayIframe;
  vi.restoreAllMocks();
});

function hide(token: string, origin = window.location.origin) {
  window.dispatchEvent(
    new MessageEvent('message', {
      data: { eventName: `helcim-pay-js-${token}`, eventStatus: 'HIDE', eventMessage: '' },
      origin,
    }),
  );
}

describe('simulator start.js', () => {
  it('appends a full-screen iframe for the checkout token', () => {
    let src = '';
    vi.mocked(document.body.appendChild).mockImplementation((node) => {
      src = (node as HTMLIFrameElement).src;
      (node as HTMLIFrameElement).removeAttribute('src');
      return Node.prototype.appendChild.call(document.body, node) as never;
    });
    window.appendHelcimPayIframe!('tok/1', false);
    expect(frame()).not.toBeNull();
    expect(src).toBe(`${BASE}tok%2F1?allowExit=0`);
    expect(frame()!.style.position).toBe('fixed');
  });

  it('defaults allowExit to true', () => {
    let src = '';
    vi.mocked(document.body.appendChild).mockImplementation((node) => {
      src = (node as HTMLIFrameElement).src;
      (node as HTMLIFrameElement).removeAttribute('src');
      return Node.prototype.appendChild.call(document.body, node) as never;
    });
    window.appendHelcimPayIframe!('tok');
    expect(src).toMatch(/allowExit=1$/);
  });

  it('removes itself on HIDE for its own token and origin only', () => {
    window.appendHelcimPayIframe!('tok');
    hide('other');
    hide('tok', 'https://evil.example');
    expect(frame()).not.toBeNull();
    hide('tok');
    expect(frame()).toBeNull();
  });

  it('replaces an existing iframe and supports removeHelcimPayIframe()', () => {
    window.appendHelcimPayIframe!('a');
    window.appendHelcimPayIframe!('b');
    expect(document.querySelectorAll('#helcimPayIframe')).toHaveLength(1);
    window.removeHelcimPayIframe!();
    expect(frame()).toBeNull();
  });
});
