/** JSON that is safe to embed inside a `<script>` element. */
export function scriptSafeJson(value: unknown): string {
  // Escape "<" so a value can never close the script tag ("</script>").
  return JSON.stringify(value).replace(/</g, '\\' + 'u003c');
}

/**
 * The simulator's version of `start.js`. It defines the same globals as
 * HelcimPay.js: `appendHelcimPayIframe(checkoutToken, allowExit = true)` and
 * `removeHelcimPayIframe()`. Like the real script, it removes the iframe
 * when the modal posts `HIDE`.
 */
export function renderStartScript(checkoutBaseUrl: string): string {
  return `/* HelcimPay.js simulator (use-helcim-pay/testing). Not the real Helcim script. */
(function () {
  var CHECKOUT_BASE = ${scriptSafeJson(checkoutBaseUrl)};
  var current = null;

  function watchForExit(event) {
    if (!current) return;
    if (event.origin !== new URL(CHECKOUT_BASE).origin) return;
    var data = event.data;
    if (data && data.eventName === 'helcim-pay-js-' + current && data.eventStatus === 'HIDE') {
      window.removeHelcimPayIframe();
    }
  }

  window.appendHelcimPayIframe = function (checkoutToken, allowExit) {
    if (allowExit === undefined) allowExit = true;
    window.removeHelcimPayIframe();
    var frame = document.createElement('iframe');
    frame.id = 'helcimPayIframe';
    frame.title = 'HelcimPay.js payment (simulator)';
    frame.src = CHECKOUT_BASE + encodeURIComponent(checkoutToken) + '?allowExit=' + (allowExit ? '1' : '0');
    frame.setAttribute('allowtransparency', 'true');
    frame.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;border:0;margin:0;padding:0;z-index:2147483647;background:transparent;color-scheme:normal;';
    document.body.appendChild(frame);
    current = checkoutToken;
    window.addEventListener('message', watchForExit, false);
  };

  window.removeHelcimPayIframe = function () {
    var frame = document.getElementById('helcimPayIframe');
    if (frame) frame.remove();
    window.removeEventListener('message', watchForExit, false);
    current = null;
  };
})();
`;
}
