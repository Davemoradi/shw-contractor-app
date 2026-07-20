export default async function handler(req, res) {
  // Fires a full-field payload at GHL for mapping/verification.
  // ?stage=paid      -> paid, application not yet submitted
  // ?stage=complete  -> application submitted
  // Each call uses a unique name + email so it always creates a NEW contact.
  const stage = (req.query && req.query.stage) || 'started';
  const stamp = Date.now().toString().slice(-6);

  const cfg = {
    started:  { label: 'Leadtest',  status: 'Started - Not Paid',            tag: 'SHW Lead - Started',  paying: 'No',  tier: '',      plan: 'Not selected yet',            price: '$0' },
    paid:     { label: 'Paidtest',  status: 'Paid - Application Incomplete', tag: 'SHW Lead - Paid No App', paying: 'Yes', tier: 'basic', plan: 'SHW Basic Plan',           price: '$49.99/mo' },
    complete: { label: 'Donetest',  status: 'Complete - Application Submitted', tag: 'SHW Lead - Complete', paying: 'Yes', tier: 'basic', plan: 'SHW Basic Plan',           price: '$49.99/mo' }
  }[stage] || null;

  if (!cfg) return res.status(400).json({ error: 'stage must be started, paid, or complete' });

  const payload = {
    firstName: cfg.label,
    lastName: stamp,
    name: cfg.label + ' ' + stamp,
    email: cfg.label.toLowerCase() + stamp + '@shwtest.com',
    phone: '5555' + stamp,
    companyName: cfg.label + ' Co ' + stamp,
    address1: '123 Main Street',
    city: 'Mahwah',
    state: 'NJ',
    zip: '07430',
    website: 'https://testhvac.com',
    source: 'SHW Landing Page',
    type: 'contractor',

    industry: 'HVAC',
    coverage_areas: 'NJ NY | Bergen Passaic | Mahwah Ramsey',

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
