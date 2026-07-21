export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const sessionId = (req.query && req.query.session_id) || (req.body && req.body.session_id);

  if (!sessionId || typeof sessionId !== 'string' || !sessionId.startsWith('cs_')) {
    return res.status(400).json({ verified: false, reason: 'Missing or malformed session_id' });
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    console.error('STRIPE_SECRET_KEY is not set — cannot verify payments');
    return res.status(500).json({ verified: false, reason: 'Verification unavailable' });
  }

  try {
    // Ask Stripe directly. A forged or unpaid session cannot pass this.
    const resp = await fetch(
      'https://api.stripe.com/v1/checkout/sessions/' + encodeURIComponent(sessionId),
      { headers: { 'Authorization': 'Bearer ' + process.env.STRIPE_SECRET_KEY } }
    );

    if (!resp.ok) {
      const errText = await resp.text();
      console.error('Stripe session lookup failed:', resp.status, errText.slice(0, 200));
      return res.status(200).json({ verified: false, reason: 'Session not found' });
    }

    const session = await resp.json();

    // Must actually be paid — not just created
    const paid = session.payment_status === 'paid' || session.payment_status === 'no_payment_required';
    if (!paid) {
      console.log('Session not paid:', sessionId, '| status:', session.payment_status);
      return res.status(200).json({ verified: false, reason: 'Payment not completed' });
    }

    // Map the charged amount back to a plan
    const total = session.amount_total;
    let plan = '';
    if (total === 4999) plan = 'basic';
    else if (total === 12999) plan = 'premium';
    else {
      console.warn('Paid session with unrecognised amount:', total, '| session:', sessionId);
      plan = 'basic'; // paid something — let them in on the lower tier rather than blocking
    }

    const details = session.customer_details || {};
    const nameParts = (details.name || '').trim().split(' ');

    console.log('Payment verified:', sessionId, '| plan:', plan, '| amount:', total, '| email:', details.email);

    return res.status(200).json({
      verified: true,
      plan: plan,
      amount: total,
      email: (details.email || '').toLowerCase(),
      firstName: nameParts[0] || '',
      lastName: nameParts.slice(1).join(' ') || '',
      phone: (details.phone || '').replace(/\D/g, ''),
      customerId: session.customer || ''
    });
  } catch (err) {
    console.error('Payment verification error:', err.message);
    return res.status(200).json({ verified: false, reason: 'Verification error' });
  }
}
