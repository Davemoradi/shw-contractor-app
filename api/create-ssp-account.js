export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const data = req.body;
    const SUPABASE_URL = process.env.SUPABASE_URL || 'https://kasqtxwbsmjlisbnebku.supabase.co';
    const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!SUPABASE_SERVICE_KEY) {
      console.error('Missing SUPABASE_SERVICE_ROLE_KEY');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    // Generate a temporary password (contractor will reset via email)
    const tempPassword = 'SHW-' + Math.random().toString(36).substring(2, 10) + '!' + Math.floor(Math.random() * 99);

    // 1) Create auth user in Supabase
    const authResp = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'apikey': SUPABASE_SERVICE_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: data.email,
        password: tempPassword,
        email_confirm: true,
        user_metadata: {
          company_name: data.companyName,
          owner_name: data.ownerName,
          phone: data.phone,
          source: data.source || 'SHW Vendor Packet'
        }
      })
    });

    const authResult = await authResp.json();

    if (!authResp.ok) {
      // If user already exists, that's fine — just log it
      if (authResult.msg?.includes('already') || authResult.message?.includes('already')) {
        console.log('User already exists:', data.email);
        return res.status(200).json({ success: true, message: 'Account already exists', existing: true });
      }
      console.error('Supabase auth error:', authResult);
      throw new Error(authResult.msg || authResult.message || 'Failed to create user');
    }

    const userId = authResult.id;

    // 2) Insert into contractors table
    const contractorResp = await fetch(`${SUPABASE_URL}/rest/v1/contractors`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'apikey': SUPABASE_SERVICE_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({
        id: userId,
        email: data.email,
        company_name: data.companyName,
        owner_name: data.ownerName,
        phone: data.phone,
        zip: data.zip,
        state: data.state,
        city: data.city,
        address: data.address,
        services: data.natureOfBusiness || '',
        coverage_areas: data.coverageAreas || '',
        plan: 'premium-ssp',
        source: data.source || 'SHW Vendor Packet',
        status: 'pending',
        created_at: new Date().toISOString()
      })
    });

    if (!contractorResp.ok) {
      const contractorErr = await contractorResp.text();
      console.error('Supabase contractor insert error:', contractorErr);
      // Don't throw — auth user was created, contractor row is secondary
    }

    // 3) Send password reset email so they can set their own password
    await fetch(`${SUPABASE_URL}/auth/v1/recover`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: data.email
      })
    });

    return res.status(200).json({
      success: true,
      message: 'SSP account created. Password reset email sent.',
      userId: userId
    });

  } catch (error) {
    console.error('SSP account creation error:', error);
    return res.status(500).json({ error: 'Failed to create SSP account: ' + error.message });
  }
}
