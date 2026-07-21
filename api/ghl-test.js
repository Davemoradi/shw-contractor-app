export default async function handler(req, res) {
  // Fires a full-field payload at GHL so every variable appears in the mapping reference.
  // ?stage=lead | app | paid | paidcomplete | freecomplete   (default: paidcomplete)
  const stage = (req.query && req.query.stage) || 'paidcomplete';
  const stamp = Date.now().toString().slice(-6);

  const CFG = {
    lead:         { label: 'S1lead', status: '1 - Lead, Not Paid',            tag: 'SHW Lead - Not Paid',      paying: 'No',  tier: '',        plan: 'Not selected yet',            price: '$0' },
    app:          { label: 'S2app',  status: '2 - App Started, Not Paid',     tag: 'SHW Lead - App Started',   paying: 'No',  tier: 'free',    plan: 'Free Network Contractor',     price: '$0' },
    paid:         { label: 'S3paid', status: '3 - Paid, App Pending',         tag: 'SHW Lead - Paid Pending',  paying: 'Yes', tier: 'basic',   plan: 'SHW Basic Plan',              price: '$49.99/mo' },
    paidcomplete: { label: 'S4done', status: '4 - Paid, App Complete',        tag: 'SHW Lead - Paid Complete', paying: 'Yes', tier: 'premium', plan: 'SHW Premium Service Network', price: '$129.99/mo' },
    freecomplete: { label: 'S5free', status: '5 - Free, App Complete',        tag: 'SHW Lead - Free Complete', paying: 'No',  tier: 'free',    plan: 'Free Network Contractor',     price: '$0' }
  };

  const cfg = CFG[stage];
  if (!cfg) return res.status(400).json({ error: 'stage must be one of: ' + Object.keys(CFG).join(', ') });

  const payload = {
    firstName: cfg.label,
    lastName: stamp,
    name: cfg.label + ' ' + stamp,
    email: cfg.label.toLowerCase() + stamp + '@shwtest.com',
    phone: '5555' + stamp,
    mobile_phone: '9735551234',
    companyName: cfg.label + ' Co ' + stamp,
    address1: '123 Main Street',
    city: 'Mahwah',
    state: 'NJ',
    zip: '07430',
    website: 'https://testhvac.com',
    source: 'SHW Landing Page',
    type: 'contractor',

    industry: 'HVAC, Plumbing, Garage Door',
    coverage_areas: 'NJ, NY, PA | Bergen Passaic | Mahwah Ramsey',

    lead_status: cfg.status,
    lead_status_tag: cfg.tag,

    paying_member: cfg.paying,
    contractor_membership_tier: cfg.tier,
    contractor_plan_name: cfg.plan,
    contractor_plan_price: cfg.price,

    salesperson: '',
    salesperson_tag: '',

    lead_id: 'SHW-TEST-' + Date.now()
  };

  try {
    const resp = await fetch('https://services.leadconnectorhq.com/hooks/QfDToN545k1TOpFZa5AQ/webhook-trigger/44c356d5-2fb0-4e5a-9b80-a3237057bccb', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const text = await resp.text();
    return res.status(200).json({ success: true, stage: stage, searchFor: payload.name, ghlStatus: resp.status, ghlResponse: text, payloadSent: payload });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
