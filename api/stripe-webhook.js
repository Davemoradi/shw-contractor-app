import crypto from 'crypto';

// Stripe signature verification needs the raw body, so disable Vercel's parser.
export const config = { api: { bodyParser: false } };

const GHL_WEBHOOK = 'https://services.leadconnectorhq.com/hooks/QfDToN545k1TOpFZa5AQ/webhook-trigger/44c356d5-2fb0-4e5a-9b80-a3237057bccb';

// ── Decline codes → plain-English reasons ───────────────────────────────
const DECLINE_REASONS = {
  insufficient_funds:        'Insufficient Funds',
  expired_card:              'Expired Card',
  incorrect_cvc:             'Wrong CVC Code',
  invalid_cvc:               'Invalid CVC Code',
  incorrect_number:          'Invalid Card Number',
  invalid_number:            'Invalid Card Number',
  incorrect_zip:             'ZIP Code Mismatch (AVS)',
  invalid_expiry_month:      'Invalid Expiration Month',
  invalid_expiry_year:       'Invalid Expiration Year',
  card_declined:             'Card Declined by Bank',
  do_not_honor:              'Bank Declined (Do Not Honor)',
  generic_decline:           'Card Declined',
  lost_card:                 'Card Reported Lost',
  stolen_card:               'Card Reported Stolen',
  pickup_card:               'Card Flagged by Issuer',
  restricted_card:           'Restricted Card',
  card_velocity_exceeded:    'Card Limit Exceeded',
  withdrawal_count_limit_exceeded: 'Withdrawal Limit Exceeded',
  currency_not_supported:    'Currency Not Supported',
  fraudulent:                'Flagged as Fraudulent',
  merchant_blacklist:        'Blocked by Fraud Rules',
  processing_error:          'Processing Error - Retry',
  issuer_not_available:      'Bank Unreachable - Retry',
  try_again_later:           'Temporary Decline - Retry',
  authentication_required:   'Bank Requires Authentication (3DS)',
  call_issuer:               'Customer Must Call Their Bank',
  service_not_allowed:       'Card Type Not Accepted',
  transaction_not_allowed:   'Transaction Not Permitted',
  new_account_information_available: 'Card Replaced - Needs Update'
};

// Reasons the customer can fix themselves vs. ones that just need a retry
const CUSTOMER_ACTION = [
  'expired_card', 'incorrect_cvc', 'invalid_cvc', 'incorrect_number', 'invalid_number',
  'incorrect_zip', 'invalid_expiry_month', 'invalid_expiry_year', 'lost_card',
  'stolen_card', 'insufficient_funds', 'call_issuer', 'new_account_information_available'
];

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function verifyStripeSignature(rawBody, sigHeader, secret) {
  if (!sigHeader || !secret) return false;
  const parts = {};
  sigHeader.split(',').forEach(p => {
    const [k, v] = p.split('=');
    if (k === 't') parts.t = v;
    if (k === 'v1') parts.v1 = v;
  });
  if (!parts.t || !parts.v1) return false;

  // Reject anything older than 5 minutes to block replay attacks
  const age = Math.abs(Math.floor(Date.now() / 1000) - parseInt(parts.t, 10));
  if (age > 300) return false;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(parts.t + '.' + rawBody, 'utf8')
    .digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1));
  } catch (e) {
    return false;
  }
}

async function sendToGHL(payload) {
  try {
    const resp = await fetch(GHL_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    console.log('Stripe -> GHL:', resp.status, '|', payload.email, '|', payload.payment_status);
    return resp.status;
  } catch (err) {
    console.error('GHL send failed:', err.message);
    return 0;
  }
}

function money(cents, currency) {
  if (cents == null) return '';
  return '$' + (cents / 100).toFixed(2) + (currency && currency !== 'usd' ? ' ' + currency.toUpperCase() : '');
}

function cardInfo(pmDetails) {
  const card = pmDetails && pmDetails.card;
  if (!card) return { last4: '', brand: '', exp: '', avs: '', cvc: '' };
  const checks = card.checks || {};
  return {
    last4: card.last4 || '',
    brand: card.brand ? card.brand.charAt(0).toUpperCase() + card.brand.slice(1) : '',
    exp: (card.exp_month && card.exp_year) ? String(card.exp_month).padStart(2, '0') + '/' + card.exp_year : '',
    avs: checks.address_postal_code_check || checks.address_line1_check || '',
    cvc: checks.cvc_check || ''
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const rawBody = await readRawBody(req);
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!verifyStripeSignature(rawBody, req.headers['stripe-signature'], secret)) {
    console.error('Stripe signature verification FAILED — request rejected');
    return res.status(400).json({ error: 'Invalid signature' });
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch (e) {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  const obj = event.data && event.data.object ? event.data.object : {};
  console.log('Stripe event:', event.type, '| id:', event.id);

  try {
    switch (event.type) {

      // ── Payment succeeded at checkout ──────────────────────────────
      case 'checkout.session.completed': {
        const email = obj.customer_details && obj.customer_details.email ? obj.customer_details.email : obj.customer_email;
        if (!email) break;
        await sendToGHL({
          email: email,
          payment_status: 'Active',
          payment_failure_reason: '',
          payment_action_needed: 'No',
          last_payment_amount: money(obj.amount_total, obj.currency),
          last_payment_date: new Date(event.created * 1000).toISOString().split('T')[0],
          stripe_customer_id: obj.customer || '',
          paying_member: 'Yes',
          lead_status: '3 - Paid, App Pending',
          lead_status_tag: 'SHW Lead - Paid Pending',
          source: 'Stripe Checkout'
        });
        break;
      }

      // ── Renewal succeeded ──────────────────────────────────────────
      case 'invoice.payment_succeeded': {
        const email = obj.customer_email;
        if (!email) break;
        await sendToGHL({
          email: email,
          payment_status: 'Active',
          payment_failure_reason: '',
          payment_action_needed: 'No',
          last_payment_amount: money(obj.amount_paid, obj.currency),
          last_payment_date: new Date(event.created * 1000).toISOString().split('T')[0],
          next_billing_date: obj.lines && obj.lines.data && obj.lines.data[0] && obj.lines.data[0].period
            ? new Date(obj.lines.data[0].period.end * 1000).toISOString().split('T')[0] : '',
          stripe_customer_id: obj.customer || '',
          paying_member: 'Yes',
          source: 'Stripe Renewal'
        });
        break;
      }

      // ── Charge failed — richest decline detail lives here ──────────
      case 'charge.failed': {
        const email = (obj.billing_details && obj.billing_details.email) || obj.receipt_email;
        if (!email) break;

        const code = obj.failure_code || (obj.outcome && obj.outcome.reason) || 'generic_decline';
        const reason = DECLINE_REASONS[code] || (obj.failure_message || 'Card Declined');
        const card = cardInfo(obj.payment_method_details);

        // Surface an AVS/CVC mismatch even when Stripe reports a generic decline
        let avsNote = '';
        if (card.avs === 'fail') avsNote = ' (ZIP/address did not match)';
        else if (card.cvc === 'fail') avsNote = ' (CVC did not match)';

        await sendToGHL({
          email: email,
          payment_status: 'Payment Failed',
          payment_failure_reason: reason + avsNote,
          payment_failure_code: code,
          payment_action_needed: CUSTOMER_ACTION.indexOf(code) !== -1 ? 'Yes' : 'No',
          issuer_message: (obj.outcome && obj.outcome.seller_message) || obj.failure_message || '',
          card_brand: card.brand,
          card_last4: card.last4,
          card_expiration: card.exp,
          avs_check: card.avs,
          cvc_check: card.cvc,
          last_failed_amount: money(obj.amount, obj.currency),
          last_failed_date: new Date(event.created * 1000).toISOString().split('T')[0],
          stripe_customer_id: obj.customer || '',
          lead_status: '6 - Payment Failed',
          lead_status_tag: 'SHW Lead - Payment Failed',
          source: 'Stripe Decline'
        });
        break;
      }

      // ── Subscription invoice failed (includes retry schedule) ──────
      case 'invoice.payment_failed': {
        const email = obj.customer_email;
        if (!email) break;
        await sendToGHL({
          email: email,
          payment_status: 'Payment Failed',
          payment_failure_reason: 'Subscription payment failed',
          payment_action_needed: 'Yes',
          failed_attempt_count: String(obj.attempt_count || 1),
          next_retry_date: obj.next_payment_attempt
            ? new Date(obj.next_payment_attempt * 1000).toISOString().split('T')[0] : 'No further retries',
          last_failed_amount: money(obj.amount_due, obj.currency),
          last_failed_date: new Date(event.created * 1000).toISOString().split('T')[0],
          stripe_customer_id: obj.customer || '',
          lead_status: '6 - Payment Failed',
          lead_status_tag: 'SHW Lead - Payment Failed',
          source: 'Stripe Decline'
        });
        break;
      }

      // ── Card expiring within the month ─────────────────────────────
      case 'customer.source.expiring': {
        const card = obj;
        await sendToGHL({
          email: card.owner && card.owner.email ? card.owner.email : '',
          payment_status: 'Card Expiring Soon',
          payment_failure_reason: 'Card on file expires ' + card.exp_month + '/' + card.exp_year,
          payment_action_needed: 'Yes',
          card_last4: card.last4 || '',
          card_expiration: card.exp_month + '/' + card.exp_year,
          stripe_customer_id: card.customer || '',
          source: 'Stripe Card Expiring'
        });
        break;
      }

      // ── Subscription cancelled ─────────────────────────────────────
      case 'customer.subscription.deleted': {
        await sendToGHL({
          email: '',
          stripe_customer_id: obj.customer || '',
          payment_status: 'Cancelled',
          payment_action_needed: 'No',
          paying_member: 'No',
          cancelled_date: new Date(event.created * 1000).toISOString().split('T')[0],
          lead_status: '7 - Cancelled',
          lead_status_tag: 'SHW Lead - Cancelled',
          source: 'Stripe Cancellation'
        });
        break;
      }

      // ── Subscription went past due / unpaid ────────────────────────
      case 'customer.subscription.updated': {
        if (obj.status === 'past_due' || obj.status === 'unpaid') {
          await sendToGHL({
            email: '',
            stripe_customer_id: obj.customer || '',
            payment_status: obj.status === 'past_due' ? 'Past Due' : 'Unpaid',
            payment_action_needed: 'Yes',
            lead_status: '6 - Payment Failed',
            lead_status_tag: 'SHW Lead - Payment Failed',
            source: 'Stripe Subscription Status'
          });
        }
        break;
      }

      default:
        console.log('Unhandled Stripe event:', event.type);
    }

    // Always 200 so Stripe stops retrying a delivered event
    return res.status(200).json({ received: true, type: event.type });
  } catch (err) {
    console.error('Stripe webhook handler error:', err.message);
    return res.status(200).json({ received: true, error: err.message });
  }
}
