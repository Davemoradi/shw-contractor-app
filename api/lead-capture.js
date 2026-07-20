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

    // stage: 'started'  = filled the landing form, has not paid
    //        'paid'     = payment completed, application not yet submitted
    const stage = d.stage === 'paid' ? 'paid' : 'started';

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

    const payload = {
      firstName: d.firstName || '',
      lastName: d.lastName || '',
      name: [d.firstName, d.lastName].filter(Boolean).join(' '),
      email: d.email,
      phone: d.phone || '',
      companyName: d.companyName || '',
      zip: d.zip || '',
      industry: d.trade || '',
      source: spDisplay ? 'SHW Landing Page - ' + spDisplay : 'SHW Landing Page',
      type: 'contractor',

      // Funnel stage — lets GHL route these differently
      lead_status: paid ? 'Paid - Application Incomplete' : 'Started - Not Paid',
      lead_status_tag: paid ? 'SHW Lead - Paid No App' : 'SHW Lead - Started',

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

    console.log('Lead capture -> GHL:', ghlResp.status,
      '| stage:', stage,
      '| email:', d.email,
      '| plan:', plan || 'none',
      '| trade:', d.trade || 'none',
      '| zip:', d.zip || 'none');

    return res.status(200).json({ success: true, stage: stage, ghlStatus: ghlResp.status });
  } catch (err) {
    console.error('Lead capture error:', err.message);
    // Never block the funnel on a CRM failure
    return res.status(200).json({ success: false, error: err.message });
  }
}
