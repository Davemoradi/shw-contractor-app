export default async function handler(req, res) {
  const ghlPayload = {
    firstName: 'Test',
    lastName: 'Contractor',
    name: 'Test Contractor',
    phone: '555-555-5555',
    email: 'test@testcompany.com',
    companyName: 'Test HVAC Services LLC',
    address1: '123 Main Street',
    city: 'Mahwah',
    state: 'NJ',
    zip: '07430',
    website: 'https://testhvac.com',
    source: 'SHW Vendor Packet',
    type: 'contractor',
    contractor_membership_tier: 'premium',
    contractor_plan_name: 'SHW Premium Service Network',
    contractor_plan_price: '$174.99/mo',
    paying_member: 'Yes',
    industry: 'HVAC Plumbing',
    coverage_areas: 'NJ NY | Bergen Passaic | Mahwah Ramsey',
    lead_id: 'SHW-VP-TEST-' + Date.now()
  };

  try {
    const resp = await fetch('https://services.leadconnectorhq.com/hooks/QfDToN545k1TOpFZa5AQ/webhook-trigger/44c356d5-2fb0-4e5a-9b80-a3237057bccb', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ghlPayload)
    });
    const text = await resp.text();
    return res.status(200).json({ success: true, ghlStatus: resp.status, ghlResponse: text, payloadSent: ghlPayload });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
