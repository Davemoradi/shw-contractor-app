export default async function handler(req, res) {
  // Fires a full-field payload at GHL for mapping/verification.
  // ?stage=paid  -> post-payment variant
  // Each call uses a unique name + email so it always creates a NEW contact.
  const paid = (req.query && req.query.stage === 'paid');
  const stamp = Date.now().toString().slice(-6);
  const label = paid ? 'Paidtest' : 'Leadtest';

  const payload = {
    firstName: label,
    lastName: stamp,
    name: label + ' ' + stamp,
    email: label.toLowerCase() + stamp + '@shwtest.com',
    phone: '5555' + stamp,
    companyName: label + ' Co ' + stamp,
    address1: '123 Main Street',
    city: 'Mahwah',
    state: 'NJ',
    zip: '07430',
    website: 'https://testhvac.com',
    source: 'SHW Landing Page',
    type: 'contractor',

    industry: 'HVAC',
    coverage_areas: 'NJ NY | Bergen Passaic | Mahwah Ramsey',

    lead_status: paid ? 'Paid - Application Incomplete' : 'Started - Not Paid',
    lead_status_tag: paid ? 'SHW Lead - Paid No App' : 'SHW Lead - Started',

    paying_member: paid ? 'Yes' : 'No',
    contractor_membership_tier: paid ? 'basic' : '',
    contractor_plan_name: paid ? 'SHW Basic Plan' : 'Not selected yet',
    contractor_plan_price: paid ? '$49.99/mo' : '$0',

    salesperson: '',
    salesperson_tag: '',

    lead_id: (paid ? 'SHW-PAID-TEST-' : 'SHW-LP-TEST-') + Date.now()
  };

  try {
    const resp = await fetch('https://services.leadconnectorhq.com/hooks/QfDToN545k1TOpFZa5AQ/webhook-trigger/44c356d5-2fb0-4e5a-9b80-a3237057bccb', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const text = await resp.text();
    return res.status(200).json({
      success: true,
      stage: paid ? 'paid' : 'started',
      searchFor: payload.name,
      ghlStatus: resp.status,
      ghlResponse: text,
      payloadSent: payload
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
