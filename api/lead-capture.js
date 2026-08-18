export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const d = req.body || {};

    if (!d.email || !d.email.includes('@')) {
      return res.status(400).json({ error: 'A valid email is required' });
    }

    // stage: 'started'      = filled the landing form, has not paid
    //        'app_started'  = began the application, not submitted
    //        'paid'         = payment completed, application not yet submitted
    const VALID = ['started', 'app_started', 'paid'];
    const stage = VALID.indexOf(d.stage) !== -1 ? d.stage : 'started';

    // ── Trade ────────────────────────────────────────────────────────────────
    // Trade is required by the front end on both index.html (step 1) and
    // apply.html (step 1). We deliberately do NOT reject the request when it's
    // missing: the browser calls this with .catch() swallowing errors, so a 400
    // here would silently destroy the lead instead of saving it. Better to store
    // the lead with a flagged placeholder and log it loudly so it can be chased.
    const trade = (d.trade || '').trim();
    const tradeMissing = trade === '';
    const tradeValue = tradeMissing ? 'Not specified' : trade;

    if (tradeMissing) {
      console.warn(
        'Lead capture: MISSING TRADE — front-end validation may have been bypassed.',
        '| stage:', stage,
        '| email:', d.email,
        '| zip:', d.zip || 'none'
      );
    }

    // ── Phone vs mobile ──────────────────────────────────────────────────────
    // SMS campaigns pull from the `phone` field, so it must hold an SMS-reachable
    // number. Contractors' business lines are frequently landlines, and landlines
    // in the send list are what destroyed delivery rates previously. Mobile always
    // wins; the business line is preserved separately rather than overwriting it.
    const mobileDigits = (d.mobile || '').replace(/\D/g, '');
    const phoneDigits  = (d.phone  || '').replace(/\D/g, '');
    const smsNumber    = mobileDigits || phoneDigits;
    const businessOnly = (d.businessPhone || '').replace(/\D/g, '');

    const planNames = {
      'basic': 'SHW Basic Plan',
      'premium': 'SHW Premium Service Network',
      'free': 'Free Network Contractor'
    };
    const planPrices = {
      'basic': '$49.99/mo',
      'premium': '$129.99/mo',
      'free': '$0'
    };

    const spRaw = (d.salesperson || '').toLowerCase().trim();
    const spDisplay = spRaw ? spRaw.charAt(0).toUpperCase() + spRaw.slice(1) : '';

    const paid = stage === 'paid';
    const plan = d.plan || '';

    const STATUS = {
      'started':     { label: '1 - Lead, Not Paid',        tag: 'SHW Lead - Not Paid' },
      'app_started': { label: '2 - App Started, Not Paid', tag: 'SHW Lead - App Started' },
      'paid':        { label: '3 - Paid, App Pending',     tag: 'SHW Lead - Paid Pending' }
    }[stage];

    const payload = {
      firstName: d.firstName || '',
      lastName: d.lastName || '',
      name: [d.firstName, d.lastName].filter(Boolean).join(' '),
      email: (d.email || '').trim().toLowerCase(),
      phone: smsNumber,
      mobile: mobileDigits,
      business_phone: businessOnly && businessOnly !== smsNumber ? businessOnly : '',
      sms_ready: mobileDigits ? 'Yes' : 'No',
      companyName: d.companyName || '',
      zip: d.zip || '',

      // Trade is sent under BOTH keys on purpose. GHL inbound webhooks only expose
      // fields that were present in the sample payload at mapping time, and the
      // original code sent this as `industry` only. Sending both means the mapping
      // works whether the GHL custom field was wired to `industry` or to `trade`.
      industry: tradeValue,
      trade: tradeValue,
      trade_missing: tradeMissing ? 'Yes' : 'No',

      source: spDisplay ? 'SHW Landing Page - ' + spDisplay : 'SHW Landing Page',
      type: 'contractor',

      // Funnel stage — lets GHL route these differently
      lead_status: STATUS.label,
      lead_status_tag: STATUS.tag,

      // Plan + payment state
      paying_member: paid ? 'Yes' : 'No',
      contractor_membership_tier: plan,
      contractor_plan_name: plan ? (planNames[plan] || 'Unknown') : 'Not selected yet',
      contractor_plan_price: plan ? (planPrices[plan] || '$0') : '$0',

      salesperson: spDisplay,
      salesperson_tag: spDisplay ? 'Sold by ' + spDisplay : '',
      lead_id: (paid ? 'SHW-PAID-' : 'SHW-LP-') + Date.now()
    };

    const ghlResp = await fetch('https://services.leadconnectorhq.com/hooks/QfDToN545k1TOpFZa5AQ/webhook-trigger/44c356d5-2fb0-4e5a-9b80-a3237057bccb', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    // Surface a non-2xx from GHL in the logs — previously any status was logged
    // identically, so a rejected webhook looked the same as a successful one.
    if (!ghlResp.ok) {
      console.error('Lead capture: GHL webhook returned', ghlResp.status, 'for', d.email);
    }

    console.log('Lead capture -> GHL:', ghlResp.status,
      '| stage:', stage,
      '| email:', d.email,
      '| plan:', plan || 'none',
      '| trade:', tradeValue,
      '| sms_ready:', mobileDigits ? 'Yes' : 'No',
      '| zip:', d.zip || 'none');

    return res.status(200).json({
      success: true,
      stage: stage,
      trade: tradeValue,
      ghlStatus: ghlResp.status
    });
  } catch (err) {
    console.error('Lead capture error:', err.message);
    // Never block the funnel on a CRM failure
    return res.status(200).json({ success: false, error: err.message });
  }
}
