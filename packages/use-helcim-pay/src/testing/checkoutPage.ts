import { scriptSafeJson } from './startScript';
import type { TestCard } from './testCards';
import type { SimulatorSession } from './token';

export interface CheckoutPageInput {
  checkoutToken: string;
  allowExit: boolean;
  processUrl: string;
  /** Undefined when the token is invalid or expired; `error` explains why. */
  session?: SimulatorSession;
  error?: string;
  testCards: readonly TestCard[];
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

function formatMoney(amount: number, currency: string): string {
  const formatted = new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
  }).format(amount);
  return `${formatted} ${currency}`;
}

const groupCard = (n: string) => n.replace(/(\d{4})(?=\d)/g, '$1 ');

/**
 * The payment modal shown inside the simulator iframe. It is self-contained
 * HTML/CSS/JS with no external requests, and looks and behaves like a
 * hosted card form. It posts the same `helcim-pay-js-<token>` events as
 * HelcimPay.js.
 */
export function renderCheckoutPage(input: CheckoutPageInput): string {
  const { session, allowExit } = input;
  const isVerify = session?.paymentType === 'verify';
  const amountLabel = session ? formatMoney(session.amount, session.currency) : '';
  const nextYear = String((new Date().getUTCFullYear() + 1) % 100).padStart(2, '0');

  const config = scriptSafeJson({
    checkoutToken: input.checkoutToken,
    eventName: `helcim-pay-js-${input.checkoutToken}`,
    processUrl: input.processUrl,
    allowExit,
    testExpiry: `12/${nextYear}`,
  });

  const closeButton = allowExit
    ? `<button type="button" class="close" data-close aria-label="Close payment window">&times;</button>`
    : '';

  const testCardButtons = input.testCards
    .map(
      (card) => `<li><button type="button" class="test-card" data-card="${card.number}">
        <span class="mono">${groupCard(card.number)}</span>
        <span class="tc-meta">${escapeHtml(card.brand)} &middot; <span class="tc-${card.outcome}">${escapeHtml(card.label)}</span></span>
      </button></li>`,
    )
    .join('');

  const body = session
    ? `
    <section id="form-view">
      <header class="head">
        <p class="merchant"><svg aria-hidden="true" viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5Zm-3 8V7a3 3 0 1 1 6 0v3H9Z"/></svg> Secure checkout</p>
        <h1 id="title">${isVerify ? 'Save your card' : escapeHtml(amountLabel)}</h1>
        ${session.invoiceNumber ? `<p class="sub">Invoice ${escapeHtml(session.invoiceNumber)}</p>` : ''}
        ${closeButton}
      </header>
      <p class="badge" role="note"><strong>Simulator</strong> Test mode. No real Helcim account, no real charge.</p>

      <form id="pay-form" novalidate>
        <div id="alert" class="alert" role="alert" hidden></div>

        <label for="cardNumber">Card number</label>
        <input id="cardNumber" name="cardNumber" inputmode="numeric" autocomplete="cc-number" placeholder="4242 4242 4242 4242" maxlength="23" aria-describedby="cardNumber-err" required>
        <p class="field-err" id="cardNumber-err"></p>

        <div class="row">
          <div>
            <label for="cardExpiry">Expiry</label>
            <input id="cardExpiry" name="cardExpiry" inputmode="numeric" autocomplete="cc-exp" placeholder="MM/YY" maxlength="5" aria-describedby="cardExpiry-err" required>
            <p class="field-err" id="cardExpiry-err"></p>
          </div>
          <div>
            <label for="cardCvv">CVV</label>
            <input id="cardCvv" name="cardCvv" inputmode="numeric" autocomplete="cc-csc" placeholder="123" maxlength="4" aria-describedby="cardCvv-err" required>
            <p class="field-err" id="cardCvv-err"></p>
          </div>
        </div>

        <label for="cardHolderName">Name on card</label>
        <input id="cardHolderName" name="cardHolderName" autocomplete="cc-name" placeholder="Jane Doe">

        <button type="submit" id="pay" class="pay">
          <span class="spinner" aria-hidden="true"></span>
          <span id="pay-label">${isVerify ? 'Verify card' : `Pay ${escapeHtml(amountLabel)}`}</span>
        </button>
      </form>

      <details class="cards" open>
        <summary>Test cards (click one to fill the form)</summary>
        <ul>${testCardButtons}</ul>
      </details>
    </section>

    <section id="done-view" hidden aria-live="polite">
      <div class="done-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="30" height="30"><path fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" d="M5 12.5l4.5 4.5L19 7.5"/></svg></div>
      <h1 id="done-title">${isVerify ? 'Card verified' : 'Payment approved'}</h1>
      <p class="sub" id="done-detail"></p>
      <button type="button" class="pay" data-close>Close</button>
    </section>`
    : `
    <section>
      <header class="head">
        <h1>Checkout unavailable</h1>
        ${closeButton}
      </header>
      <div class="alert" role="alert">${escapeHtml(input.error ?? 'Invalid checkout token')}. Please close this window and start again.</div>
      ${allowExit ? '<button type="button" class="pay" data-close>Close</button>' : ''}
    </section>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>HelcimPay.js simulator</title>
<style>
  /* No color-scheme here on purpose: an iframe only stays transparent when its
     document and the <iframe> element (color-scheme: normal, set by start.js)
     use the same scheme. Dark mode is handled by the tokens below instead. */
  :root {
    --bg: #ffffff; --fg: #0f172a; --muted: #64748b; --line: #e2e8f0; --field: #f8fafc;
    --accent: #1d4ed8; --accent-fg: #ffffff; --danger: #b91c1c; --danger-bg: #fef2f2;
    --ok: #15803d; --ok-bg: #f0fdf4; --warn-bg: #fffbeb; --warn-fg: #92400e; --warn-line: #fde68a;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0f172a; --fg: #e2e8f0; --muted: #94a3b8; --line: #1e293b; --field: #111c33;
      --accent: #3b82f6; --danger: #fca5a5; --danger-bg: #3a1212; --ok: #4ade80; --ok-bg: #0f2a1a;
      --warn-bg: #2a2110; --warn-fg: #fcd34d; --warn-line: #4a3a12;
    }
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; }
  body {
    font: 15px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    background: rgba(15, 23, 42, 0.55); display: flex; align-items: center; justify-content: center;
    padding: 16px; animation: fade .15s ease-out;
  }
  .dialog {
    position: relative; width: min(420px, 100%); max-height: calc(100vh - 32px); overflow: auto;
    background: var(--bg); color: var(--fg); border-radius: 14px; padding: 22px;
    box-shadow: 0 24px 60px rgba(0,0,0,.35); animation: rise .2s ease-out;
  }
  @keyframes fade { from { opacity: 0 } }
  @keyframes rise { from { transform: translateY(12px); opacity: 0 } }
  @media (prefers-reduced-motion: reduce) { body, .dialog { animation: none } }
  .head { padding-right: 36px; }
  .merchant { display: flex; align-items: center; gap: 6px; margin: 0 0 4px; color: var(--muted); font-size: 13px; }
  h1 { margin: 0; font-size: 24px; letter-spacing: -.01em; font-variant-numeric: tabular-nums; }
  .sub { margin: 4px 0 0; color: var(--muted); font-size: 13px; }
  .close {
    position: absolute; top: 14px; right: 14px; width: 34px; height: 34px; border-radius: 8px;
    border: 0; background: transparent; color: var(--muted); font-size: 24px; line-height: 1; cursor: pointer;
  }
  .close:hover { background: var(--field); color: var(--fg); }
  .badge {
    margin: 16px 0; padding: 8px 10px; border-radius: 8px; font-size: 12.5px;
    background: var(--warn-bg); color: var(--warn-fg); border: 1px solid var(--warn-line);
  }
  .badge strong { text-transform: uppercase; letter-spacing: .06em; font-size: 11px; margin-right: 6px; }
  label { display: block; font-size: 13px; font-weight: 600; margin: 12px 0 5px; }
  input {
    width: 100%; font: inherit; color: var(--fg); background: var(--field); padding: 10px 12px;
    border: 1px solid var(--line); border-radius: 8px; outline: none;
  }
  input:focus-visible { border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 25%, transparent); }
  input[aria-invalid="true"] { border-color: var(--danger); }
  #cardNumber, #cardExpiry, #cardCvv { font-variant-numeric: tabular-nums; letter-spacing: .02em; }
  .row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .field-err { margin: 4px 0 0; min-height: 0; color: var(--danger); font-size: 12.5px; }
  .field-err:empty { display: none; }
  .alert { padding: 10px 12px; border-radius: 8px; background: var(--danger-bg); color: var(--danger); font-size: 13.5px; margin: 4px 0 8px; }
  .pay {
    margin-top: 18px; width: 100%; display: inline-flex; align-items: center; justify-content: center; gap: 8px;
    padding: 12px 16px; font: inherit; font-weight: 600; border: 0; border-radius: 10px; cursor: pointer;
    background: var(--accent); color: var(--accent-fg);
  }
  .pay:hover { filter: brightness(1.08); }
  .pay:focus-visible { outline: 3px solid color-mix(in srgb, var(--accent) 40%, transparent); outline-offset: 2px; }
  .pay[disabled] { opacity: .7; cursor: progress; }
  .spinner { display: none; width: 16px; height: 16px; border-radius: 50%; border: 2px solid currentColor; border-right-color: transparent; animation: spin .7s linear infinite; }
  .pay[aria-busy="true"] .spinner { display: inline-block; }
  @keyframes spin { to { transform: rotate(360deg) } }
  .cards { margin-top: 18px; border-top: 1px solid var(--line); padding-top: 12px; font-size: 13px; }
  .cards summary { cursor: pointer; color: var(--muted); }
  .cards ul { list-style: none; margin: 8px 0 0; padding: 0; display: grid; gap: 6px; }
  .test-card {
    width: 100%; display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap; text-align: left;
    font: inherit; color: var(--fg); background: var(--field); border: 1px solid var(--line); border-radius: 8px; padding: 7px 10px; cursor: pointer;
  }
  .test-card:hover { border-color: var(--accent); }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12.5px; }
  .tc-meta { color: var(--muted); }
  .tc-approved { color: var(--ok); font-weight: 600; }
  .tc-declined, .tc-insufficient-funds, .tc-processing-error { color: var(--danger); font-weight: 600; }
  #done-view { text-align: center; padding: 12px 0 4px; }
  .done-icon { width: 56px; height: 56px; margin: 0 auto 12px; border-radius: 50%; display: grid; place-items: center; background: var(--ok-bg); color: var(--ok); }
  [hidden] { display: none !important; }
</style>
</head>
<body>
<div class="dialog" role="dialog" aria-modal="true" aria-labelledby="title">
${body}
</div>
<script>
(function () {
  var CFG = ${config};
  var $ = function (id) { return document.getElementById(id); };

  function post(status, message) {
    window.parent.postMessage({ eventName: CFG.eventName, eventStatus: status, eventMessage: message }, '*');
  }
  function close() { post('HIDE', ''); }

  document.querySelectorAll('[data-close]').forEach(function (el) { el.addEventListener('click', close); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && CFG.allowExit) close(); });

  var form = $('pay-form');
  if (!form) return;

  var num = $('cardNumber'), exp = $('cardExpiry'), cvv = $('cardCvv'), name = $('cardHolderName');
  var pay = $('pay'), alertBox = $('alert');

  num.addEventListener('input', function () {
    var d = num.value.replace(/\\D/g, '').slice(0, 19);
    num.value = d.replace(/(\\d{4})(?=\\d)/g, '$1 ');
  });
  exp.addEventListener('input', function (e) {
    var d = exp.value.replace(/\\D/g, '').slice(0, 4);
    exp.value = d.length > 2 || (d.length === 2 && e.inputType !== 'deleteContentBackward') ? d.slice(0, 2) + '/' + d.slice(2) : d;
  });
  cvv.addEventListener('input', function () { cvv.value = cvv.value.replace(/\\D/g, '').slice(0, 4); });

  document.querySelectorAll('.test-card').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var n = btn.getAttribute('data-card');
      num.value = n.replace(/(\\d{4})(?=\\d)/g, '$1 ');
      exp.value = CFG.testExpiry;
      cvv.value = '123';
      if (!name.value) name.value = 'Test Customer';
      clearErrors();
      pay.focus();
    });
  });

  function setFieldError(field, message) {
    var input = $(field), err = $(field + '-err');
    if (!input || !err) return false;
    input.setAttribute('aria-invalid', 'true');
    err.textContent = message;
    return true;
  }
  function clearErrors() {
    alertBox.hidden = true;
    alertBox.textContent = '';
    ['cardNumber', 'cardExpiry', 'cardCvv'].forEach(function (f) {
      $(f).removeAttribute('aria-invalid');
      $(f + '-err').textContent = '';
    });
  }
  function showAlert(message) {
    alertBox.textContent = message;
    alertBox.hidden = false;
  }
  function setBusy(busy) {
    pay.disabled = busy;
    pay.setAttribute('aria-busy', busy ? 'true' : 'false');
  }

  function validate() {
    var ok = true;
    function check(valid, field, message) {
      if (!valid) { setFieldError(field, message); ok = false; }
    }
    check(num.value.replace(/\\D/g, '').length >= 12, 'cardNumber', 'Enter a card number');
    check(/^\\d{2}\\/\\d{2}$/.test(exp.value), 'cardExpiry', 'Use MM/YY');
    check(/^\\d{3,4}$/.test(cvv.value), 'cardCvv', '3 or 4 digits');
    return ok;
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    clearErrors();
    if (!validate()) {
      var first = form.querySelector('[aria-invalid="true"]');
      if (first) first.focus();
      return;
    }
    setBusy(true);
    fetch(CFG.processUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        checkoutToken: CFG.checkoutToken,
        cardNumber: num.value,
        cardExpiry: exp.value,
        cardCvv: cvv.value,
        cardHolderName: name.value
      })
    })
      .then(function (res) {
        return res.json().then(function (body) { return { res: res, body: body }; });
      })
      .then(function (r) {
        setBusy(false);
        var body = r.body || {};
        if (!r.res.ok) {
          var errors = body.errors;
          if (errors && typeof errors === 'object') {
            var shown = false;
            Object.keys(errors).forEach(function (k) { shown = setFieldError(k, errors[k]) || shown; });
            if (!shown) showAlert(Object.values(errors).join(' '));
          } else {
            showAlert(typeof errors === 'string' ? errors : 'Payment could not be processed.');
          }
          return;
        }
        if (body.eventStatus === 'SUCCESS') {
          post('SUCCESS', body.eventMessage);
          try {
            var tx = JSON.parse(body.eventMessage).data.data;
            $('done-detail').textContent = 'Approval code ' + tx.approvalCode + ' \\u00b7 Transaction ' + tx.transactionId;
          } catch (err) { /* detail is optional */ }
          $('form-view').hidden = true;
          $('done-view').hidden = false;
          var doneBtn = document.querySelector('#done-view [data-close]');
          if (doneBtn) doneBtn.focus();
        } else {
          post('ABORTED', body.eventMessage);
          showAlert(String(body.eventMessage || 'Payment declined').replace(/^HelcimPay\\.js transaction failed - /, '') + '. Try another card.');
          num.focus();
        }
      })
      .catch(function () {
        setBusy(false);
        showAlert('Could not reach the payment server. Check your connection and try again.');
      });
  });

  // preventScroll: focusing inside the iframe must not scroll the parent page.
  num.focus({ preventScroll: true });
})();
</script>
</body>
</html>`;
}
