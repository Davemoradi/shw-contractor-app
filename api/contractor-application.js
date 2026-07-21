export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const data = req.body;

    // Build attachments from base64 files
    const attachments = [];
    if (data.files && Array.isArray(data.files)) {
      console.log('Files received:', data.files.length);
      for (const file of data.files) {
        if (file.base64 && file.name) {
          const content = file.base64.split(',').pop();
          console.log('Attaching:', file.name, '(' + file.category + ')', Math.round(content.length / 1024) + 'KB base64');
          attachments.push({
            filename: file.category + ' - ' + file.name,
            content: content,
            content_type: file.type || 'application/octet-stream'
          });
        }
      }
    } else {
      console.log('No files array in request body');
    }
    console.log('Total attachments to send:', attachments.length);

    // Build HTML email body
    const html = buildEmailHTML(data);

    // Send via Resend API
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM || 'SHW Contractor App <onboarding@resend.dev>',
        to: [process.env.NOTIFY_EMAIL || 'serviceprovider@selecthomewarranty.com'],
        cc: [],
        subject: `New Contractor Application — ${data.companyName || 'Unknown Company'}${data.docsMissing ? ' [DOCS MISSING]' : ''}`,
        html: html,
        attachments: attachments
      })
    });

    const result = await response.json();

    if (!response.ok) {
      const errMsg = JSON.stringify(result);
      console.error('Resend error:', errMsg);
      console.error('RESEND_FROM:', process.env.RESEND_FROM);
      console.error('NOTIFY_EMAIL:', process.env.NOTIFY_EMAIL);
      throw new Error(result.message || errMsg || 'Email send failed');
    }

    // Confirmation to the contractor — separate from the internal notification
    try {
      if (data.email && data.email.includes('@')) {
        const confResp = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            from: process.env.RESEND_FROM || 'Select Home Warranty <noreply@selectservicepros.com>',
            to: [data.email],
            subject: 'We received your application — Select Home Warranty',
            html: buildConfirmationHTML(data)
          })
        });
        console.log('Contractor confirmation:', confResp.status, '->', data.email);
      }
    } catch (confErr) {
      console.error('Confirmation email failed (non-blocking):', confErr.message);
    }

    // Send to GHL webhook (server-side, no CORS issues)
    try {
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
      // Capitalize salesperson code for display (e.g. "celia" -> "Celia")
      // GHL matches on raw digits — strip display formatting like (555) 555-5555
      const digits = (v) => (v || '').replace(/\D/g, '');
      const isPaid = (data.selectedPlan === 'basic' || data.selectedPlan === 'premium');
      const spRaw = (data.salesperson || '').toLowerCase().trim();
      const spDisplay = spRaw ? spRaw.charAt(0).toUpperCase() + spRaw.slice(1) : '';

      // Full application as readable text — posted to GHL as a note
      const na = (v) => (v === undefined || v === null || v === '') ? '—' : v;
      const licLines = (data.licenses || []).map((l, i) => {
        const bits = [l.authority, l.type, l.number ? '#' + l.number : '', l.permits ? 'Permits: ' + l.permits : ''].filter(Boolean);
        return bits.length ? '  ' + (i + 1) + '. ' + bits.join(' | ') : '';
      }).filter(Boolean).join('\n');
      const covLines = Object.entries(data.coverageItems || {})
        .map(([cat, items]) => Array.isArray(items) && items.length ? '  ' + cat.toUpperCase() + ': ' + items.join(', ') : '')
        .filter(Boolean).join('\n');
      const mkLabels = { '0-25': '$0-25', '25-50': '$25-50', '50-100': '$50-100', '100-150': '$100-150', '150+': 'Over $150' };
      const mkLine = Object.entries(data.partsMarkup || {})
        .map(([k, v]) => (mkLabels[k] || k) + ': ' + v + '%').join(' | ');

      const applicationSummary = [
        '=== CONTRACTOR APPLICATION ===',
        'Submitted: ' + new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }) + ' ET',
        'Plan: ' + (planNames[data.selectedPlan] || 'Unknown') + ' (' + (planPrices[data.selectedPlan] || '$0') + ')',
        '',
        '--- BUSINESS ---',
        'Company: ' + na(data.companyName),
        'DBA: ' + na(data.dba),
        'Address: ' + na(data.address) + ', ' + na(data.city) + ', ' + na(data.state) + ' ' + na(data.zip),
        'Business Phone: ' + na(data.phone),
        'Mobile: ' + na(data.mobile),
        'Email: ' + na(data.email),
        'Website: ' + na(data.website),
        'Google Business Profile: ' + na(data.googleBusinessProfile),
        'Owner: ' + na(data.ownerName) + ' | Cell: ' + na(data.ownerCell),
        'Trades: ' + na(data.natureOfBusiness),
        'Years in Business: ' + na(data.yearsInBusiness),
        'Tax ID / EIN: ' + na(data.taxId),
        'Business Type: ' + na(data.businessType),
        '',
        '--- OPERATIONS ---',
        'Technicians: ' + na(data.numTechnicians) + ' (uniformed: ' + na(data.uniformedTechnicians) + ')',
        'Vehicles: ' + na(data.vehicles),
        'Hours M-F: ' + na(data.hoursMF),
        'Hours Sat: ' + na(data.hoursSat) + ' | Sun: ' + na(data.hoursSun) + ' | Holiday: ' + na(data.hoursHoliday),
        'Phone answered by: ' + na(data.phoneHandler),
        'After-hours / emergency: ' + na(data.emergencyHandler),
        'Scheduling system: ' + na(data.schedulingSystem),
        'Payment methods accepted: ' + na(data.creditCards),
        'Will install SHW parts: ' + na(data.installSHWParts),
        'Other warranty companies: ' + na(data.otherWarrantyCompanies),
        '',
        '--- LICENSES ---',
        licLines || '  None provided',
        '',
        '--- RATES ---',
        'Service Call — Regular: $' + na(data.serviceCallRegular) + ' | SHW: $' + na(data.serviceCallSHW),
        'Hourly Labor — Regular: $' + na(data.laborRateRegular) + ' | SHW: $' + na(data.laborRateSHW),
        'Parts Mark-up: ' + (mkLine || '—'),
        'Sales Tax: ' + na(data.salesTax) + '%',
        '',
        '--- COVERAGE AREA ---',
        'States: ' + na(data.coverageStates),
        'Counties: ' + na(data.coverageCounties),
        'Cities: ' + na(data.coverageCities),
        '',
        '--- SERVICES OFFERED ---',
        covLines || '  None selected',
        '',
        '--- AGREEMENT ---',
        'Agreed to MSA: ' + (data.agreedToTerms ? 'Yes' : 'No'),
        'Signed by: ' + na(data.signatureName) + ' on ' + na(data.signatureDate),
        '',
        '--- DOCUMENTS ---',
        'Received: ' + ((data.files || []).map(f => f.category).filter(Boolean).join(', ') || 'None'),
        'Outstanding: ' + (data.docsMissing || 'None — all documents received')
      ].join('\n');

      const ghlPayload = {
        firstName: data.ownerName ? data.ownerName.split(' ')[0] : '',
        lastName: data.ownerName ? data.ownerName.split(' ').slice(1).join(' ') : '',
        name: data.ownerName,
        phone: digits(data.phone),
        mobile_phone: digits(data.mobile),
        email: (data.email || '').trim().toLowerCase(),
        companyName: data.companyName,
        address1: data.address,
        city: data.city,
        state: data.state,
        zip: data.zip,
        website: data.website,
        source: spDisplay ? 'SHW Vendor Packet - ' + spDisplay : 'SHW Vendor Packet',
        type: 'contractor',
        contractor_membership_tier: data.selectedPlan,
        contractor_plan_name: planNames[data.selectedPlan] || 'Unknown',
        contractor_plan_price: planPrices[data.selectedPlan] || '$0',
        paying_member: isPaid ? 'Yes' : 'No',
        industry: data.natureOfBusiness,
        coverage_areas: [data.coverageStates, data.coverageCounties, data.coverageCities].filter(Boolean).join(' | '),

        // Final funnel stage — paying members and free contractors tracked separately
        lead_status: isPaid ? '4 - Paid, App Complete' : '5 - Free, App Complete',
        lead_status_tag: isPaid ? 'SHW Lead - Paid Complete' : 'SHW Lead - Free Complete',

        application_summary: applicationSummary,

        // Filterable operational fields
        years_in_business: data.yearsInBusiness || '',
        num_technicians: data.numTechnicians || '',
        service_call_fee: data.serviceCallSHW || '',
        labor_rate: data.laborRateSHW || '',
        business_type: data.businessType || '',
        owner_name: data.ownerName || '',
        coverage_counties: data.coverageCounties || '',
        coverage_cities: data.coverageCities || '',

        docs_status: data.docsMissing ? 'Incomplete' : 'Complete',
        docs_missing: data.docsMissing || '',
        salesperson: spDisplay,
        salesperson_tag: spDisplay ? 'Sold by ' + spDisplay : '',
        lead_id: 'SHW-VP-' + Date.now()
      };
      const ghlResp = await fetch('https://services.leadconnectorhq.com/hooks/QfDToN545k1TOpFZa5AQ/webhook-trigger/44c356d5-2fb0-4e5a-9b80-a3237057bccb', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ghlPayload)
      });
      console.log('GHL webhook response:', ghlResp.status, '| plan:', data.selectedPlan, '| status:', isPaid ? '4-Paid Complete' : '5-Free Complete', '| salesperson:', spDisplay || 'none');
    } catch (ghlErr) {
      console.error('GHL webhook error (non-blocking):', ghlErr.message);
    }

    return res.status(200).json({ success: true, message: 'Application submitted successfully' });
  } catch (error) {
    console.error('Email send error:', error);
    return res.status(500).json({ error: error.message || 'Failed to submit application. Please try again.' });
  }
}

function buildEmailHTML(d) {
  const s = `style="border:1px solid #ddd;border-collapse:collapse;padding:8px 12px;text-align:left;font-size:14px;"`;
  const sh = `style="border:1px solid #ddd;border-collapse:collapse;padding:8px 12px;text-align:left;font-size:14px;background:#f0f2f5;font-weight:600;width:220px;"`;
  const row = (label, val) => `<tr><td ${sh}>${label}</td><td ${s}>${val ? val : '<span style="color:#999;font-style:italic">Not provided</span>'}</td></tr>`;

  let coverageHTML = '';
  if (d.coverageItems && typeof d.coverageItems === 'object') {
    const cats = Object.entries(d.coverageItems);
    if (cats.length > 0) {
      coverageHTML = cats.map(([cat, items]) => {
        if (Array.isArray(items) && items.length > 0) {
          return `<strong>${cat}:</strong> ${items.join(', ')}`;
        }
        return '';
      }).filter(Boolean).join('<br>');
    }
  }

  let licensesHTML = '';
  if (d.licenses && Array.isArray(d.licenses)) {
    licensesHTML = d.licenses.map((lic, i) => {
      const bits = [];
      if (lic.authority) bits.push(lic.authority);
      if (lic.type) bits.push(lic.type);
      if (lic.number) bits.push('#' + lic.number);
      if (lic.permits) bits.push('Permits: ' + lic.permits);
      return bits.length ? `<strong>License ${i + 1}:</strong> ${bits.join(' &nbsp;|&nbsp; ')}` : '';
    }).filter(Boolean).join('<br>');
  }

  const TIERS = [
    { key: '0-25',    label: '$0.00 &ndash; $25.00',     max: 50 },
    { key: '25-50',   label: '$25.01 &ndash; $50.00',    max: 40 },
    { key: '50-100',  label: '$50.01 &ndash; $100.00',   max: 30 },
    { key: '100-150', label: '$100.01 &ndash; $150.00',  max: 25 },
    { key: '150+',    label: 'Above $150.00',            max: 10 }
  ];
  let markupHTML = '';
  let markupOver = false;
  if (d.partsMarkup && typeof d.partsMarkup === 'object' && Object.keys(d.partsMarkup).length) {
    const rows = TIERS.map(t => {
      const raw = d.partsMarkup[t.key];
      if (raw === undefined || raw === '') {
        return `<tr><td style="padding:6px 10px;border:1px solid #ddd;font-size:13px;">${t.label}</td><td style="padding:6px 10px;border:1px solid #ddd;font-size:13px;color:#888;">${t.max}%</td><td style="padding:6px 10px;border:1px solid #ddd;font-size:13px;color:#999;font-style:italic;">Not provided</td></tr>`;
      }
      const val = parseFloat(raw);
      const over = !isNaN(val) && val > t.max;
      if (over) markupOver = true;
      const style = over
        ? 'padding:6px 10px;border:1px solid #ddd;font-size:13px;color:#c62828;font-weight:700;background:#fdecea;'
        : 'padding:6px 10px;border:1px solid #ddd;font-size:13px;';
      return `<tr><td style="padding:6px 10px;border:1px solid #ddd;font-size:13px;">${t.label}</td><td style="padding:6px 10px;border:1px solid #ddd;font-size:13px;color:#888;">${t.max}%</td><td style="${style}">${raw}%${over ? ' &#9888; over max' : ''}</td></tr>`;
    }).join('');
    markupHTML = `<table style="width:100%;border-collapse:collapse;margin:4px 0;">
      <tr>
        <th style="padding:6px 10px;border:1px solid #ddd;background:#f0f2f5;font-size:12px;text-align:left;">Parts Cost Tier</th>
        <th style="padding:6px 10px;border:1px solid #ddd;background:#f0f2f5;font-size:12px;text-align:left;">SHW Max</th>
        <th style="padding:6px 10px;border:1px solid #ddd;background:#f0f2f5;font-size:12px;text-align:left;">Contractor</th>
      </tr>${rows}</table>` +
      (markupOver ? '<div style="margin-top:6px;font-size:12px;color:#c62828;font-weight:600;">&#9888; One or more tiers exceed the SHW maximum &mdash; needs review before approval.</div>' : '');
  }

  let filesHTML = '';
  if (d.files && Array.isArray(d.files)) {
    filesHTML = d.files.map(f => `📎 ${f.name} (${f.category || 'document'})`).join('<br>');
  }

  const planBg = d.selectedPlan === 'premium' ? '#f05528' : d.selectedPlan === 'basic' ? '#2557a7' : '#666';
  const planLabel = d.selectedPlan === 'basic' ? 'SHW Basic Plan — $49.99/mo'
    : d.selectedPlan === 'premium' ? 'SHW Premium Service Network — $129.99/mo'
    : 'Free Network Contractor (no plan selected)';

  return `
    <div style="font-family:'DM Sans',Arial,sans-serif;max-width:700px;margin:0 auto;color:#333;">
      <div style="background:#1a2b5f;padding:24px;text-align:center;">
        <h1 style="color:#fff;margin:0;font-size:22px;">New Contractor Application</h1>
        <p style="color:#c0c4cc;margin:8px 0 0;font-size:14px;">Select Home Warranty — Service Provider Application</p>
      </div>

      <div style="padding:24px;">
        <div style="background:${planBg};color:#fff;padding:12px 16px;border-radius:6px;margin-bottom:20px;font-size:15px;font-weight:600;">
          Selected Plan: ${planLabel}
        </div>
        ${d.salesperson ? `<div style="background:#f0f2f5;border-left:4px solid #1a2b5f;padding:10px 14px;margin-bottom:20px;font-size:14px;">Referred by: <strong>${d.salesperson}</strong></div>` : ''}
        ${d.docsMissing ? `<div style="background:#fdecea;border-left:4px solid #c62828;padding:12px 16px;margin-bottom:20px;font-size:14px;color:#8a1c17;"><strong>&#9888; Documents outstanding &mdash; cannot approve yet</strong><br>Missing: <strong>${d.docsMissing}</strong><br><span style="font-size:13px;">The contractor was told to email these to serviceprovider@selecthomewarranty.com. Follow up to complete onboarding.</span></div>` : `<div style="background:#e8f5e9;border-left:4px solid #2e7d32;padding:10px 14px;margin-bottom:20px;font-size:14px;color:#1b5e20;"><strong>&#10003; All required documents received</strong></div>`}

        <h2 style="color:#1a2b5f;border-bottom:2px solid #2557a7;padding-bottom:8px;">General Information</h2>
        <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
          ${row('Company Name', d.companyName)}
          ${row('DBA', d.dba)}
          ${row('Address', d.address)}
          ${row('City / State / ZIP', `${d.city || ''}, ${d.state || ''} ${d.zip || ''}`)}
          ${row('Business Phone', d.phone)}
          ${row('Mobile', d.mobile)}
          ${row('Email', d.email)}
          ${row('Website', d.website)}
          ${row('Google Business Profile', d.googleBusinessProfile)}
          ${row('Owner Name', d.ownerName)}
          ${row('Owner Cell', d.ownerCell)}
          ${row('Trades Performed', d.natureOfBusiness)}
          ${row('Years in Business', d.yearsInBusiness)}
          ${row('Tax ID / EIN', d.taxId)}
          ${row('Business Type', d.businessType)}
          ${row('Salesperson', d.salesperson)}
        </table>

        <h2 style="color:#1a2b5f;border-bottom:2px solid #2557a7;padding-bottom:8px;">Operations</h2>
        <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
          ${row('Number of Technicians', d.numTechnicians)}
          ${row('Uniformed Technicians', d.uniformedTechnicians)}
          ${row('Number of Vehicles', d.vehicles)}
          ${row('Hours — Mon-Fri', d.hoursMF)}
          ${row('Hours — Saturday', d.hoursSat)}
          ${row('Hours — Sunday', d.hoursSun)}
          ${row('Hours — Holiday', d.hoursHoliday)}
          ${row('Phone Handler', d.phoneHandler)}
          ${row('Emergency Handler', d.emergencyHandler)}
          ${row('Scheduling System', d.schedulingSystem)}
          ${row('Payment Methods Accepted', d.creditCards)}
          ${row('Will Install SHW Parts?', d.installSHWParts)}
          ${row('Other Warranty Companies', d.otherWarrantyCompanies)}
        </table>

        <h2 style="color:#1a2b5f;border-bottom:2px solid #2557a7;padding-bottom:8px;">Licenses &amp; Rates</h2>
        <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
          ${row('Contractor Licenses', licensesHTML)}
          ${row('Service Call Fee (Regular)', d.serviceCallRegular)}
          ${row('Service Call Fee (SHW Discounted)', d.serviceCallSHW)}
          ${row('Hourly Labor Rate (Regular)', d.laborRateRegular)}
          ${row('Hourly Labor Rate (SHW Discounted)', d.laborRateSHW)}
          ${row('Parts Mark-up', markupHTML)}
          ${row('Sales Tax %', d.salesTax)}
          ${row('States Covered', d.coverageStates)}
          ${row('Coverage Counties', d.coverageCounties)}
          ${row('Coverage Cities', d.coverageCities)}
        </table>

        <h2 style="color:#1a2b5f;border-bottom:2px solid #2557a7;padding-bottom:8px;">Coverage Items</h2>
        <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
          ${row('Selected Items', coverageHTML || 'None selected')}
        </table>

        <h2 style="color:#1a2b5f;border-bottom:2px solid #2557a7;padding-bottom:8px;">Agreement</h2>
        <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
          ${row('Agreed to Terms', d.agreedToTerms ? 'Yes' : 'No')}
          ${row('Printed Name', d.signatureName)}
          ${row('Date Signed', d.signatureDate)}
        </table>

        <h2 style="color:#1a2b5f;border-bottom:2px solid #2557a7;padding-bottom:8px;">Uploaded Documents</h2>
        <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
          ${row('Files Received', filesHTML || '<span style="color:#c62828;font-weight:600">None uploaded</span>')}
          ${d.docsMissing ? `<tr><td ${sh}>Still Needed</td><td ${s}><span style="color:#c62828;font-weight:700">${d.docsMissing}</span></td></tr>` : ''}
        </table>

        <hr style="border:none;border-top:1px solid #ddd;margin:24px 0;">
        <p style="font-size:12px;color:#888;text-align:center;">
          Select Home Warranty, LLC — 1000 Wyckoff Ave, Mahwah, NJ 07430 — 855-267-3532
        </p>
      </div>
    </div>
  `;
}

function buildConfirmationHTML(d) {
  const planNames = {
    'basic': 'SHW Basic Plan',
    'premium': 'SHW Premium Service Network',
    'free': 'Free Network Contractor'
  };
  const planPrices = { 'basic': '$49.99/mo', 'premium': '$129.99/mo', 'free': 'No monthly fee' };
  const planName = planNames[d.selectedPlan] || 'Free Network Contractor';
  const planPrice = planPrices[d.selectedPlan] || 'No monthly fee';
  const firstName = (d.ownerName || '').split(' ')[0] || 'there';

  const docsBlock = d.docsMissing
    ? `<div style="background:#fff4e5;border:1px solid #ffcc80;border-left:4px solid #f57c00;border-radius:6px;padding:16px 18px;margin:22px 0;">
         <div style="font-size:15px;font-weight:700;color:#8a4b00;margin-bottom:6px;">One thing left</div>
         <div style="font-size:14px;color:#5d3200;line-height:1.6;">
           We still need your <strong>${d.docsMissing}</strong> before we can approve your account and start sending you work.<br><br>
           Just reply to this email with the documents attached, or send them to
           <a href="mailto:serviceprovider@selecthomewarranty.com" style="color:#8a4b00;font-weight:600;">serviceprovider@selecthomewarranty.com</a>.
         </div>
       </div>`
    : `<div style="background:#e8f5e9;border:1px solid #a5d6a7;border-left:4px solid #2e7d32;border-radius:6px;padding:14px 18px;margin:22px 0;">
         <div style="font-size:14px;color:#1b5e20;font-weight:600;">&#10003; We have everything we need &mdash; nothing further is required from you right now.</div>
       </div>`;

  const step = (num, title, body) => `
    <tr>
      <td style="width:34px;vertical-align:top;padding:0 0 18px 0;">
        <div style="width:26px;height:26px;border-radius:50%;background:#2557a7;color:#fff;font-size:13px;font-weight:700;text-align:center;line-height:26px;">${num}</div>
      </td>
      <td style="vertical-align:top;padding:0 0 18px 0;">
        <div style="font-size:15px;font-weight:700;color:#1a2b5f;margin-bottom:3px;">${title}</div>
        <div style="font-size:14px;color:#666;line-height:1.55;">${body}</div>
      </td>
    </tr>`;

  return `
  <div style="font-family:Arial,Helvetica,sans-serif;background:#f4f5f7;padding:28px 14px;">
    <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:10px;overflow:hidden;">

      <div style="background:#1a2b5f;padding:26px 28px;text-align:center;">
        <div style="color:#fff;font-size:21px;font-weight:700;">Application Received</div>
        <div style="color:#c0c4cc;font-size:14px;margin-top:5px;">Select Home Warranty Contractor Network</div>
      </div>

      <div style="padding:28px;">
        <p style="font-size:16px;color:#333;margin:0 0 16px;">Hi ${firstName},</p>
        <p style="font-size:15px;color:#444;line-height:1.65;margin:0 0 8px;">
          Thanks for applying to the Select Home Warranty contractor network${d.companyName ? ' on behalf of <strong>' + d.companyName + '</strong>' : ''}.
          We have your application and our service provider team is reviewing it now.
        </p>

        ${docsBlock}

        <div style="font-size:15px;font-weight:700;color:#1a2b5f;margin:26px 0 14px;">What happens next</div>
        <table style="width:100%;border-collapse:collapse;">
          ${step(1, 'We review your application', 'Our team verifies your license, insurance, and coverage area. This usually takes 2&ndash;3 business days.')}
          ${step(2, 'We reach out', 'You&rsquo;ll hear from us by phone or email once the review is complete, whether we need anything else or you&rsquo;re approved.')}
          ${step(3, 'Work orders start coming to you', 'Once approved, you&rsquo;re added to the dispatch network for your area and jobs are sent straight to you.')}
        </table>

        <div style="background:#f4f5f7;border-radius:6px;padding:16px 18px;margin:24px 0;">
          <div style="font-size:12px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:1px;margin-bottom:9px;">Your submission</div>
          <table style="width:100%;font-size:14px;color:#444;">
            ${d.companyName ? `<tr><td style="padding:3px 0;color:#888;width:120px;">Company</td><td style="padding:3px 0;font-weight:600;color:#1a2b5f;">${d.companyName}</td></tr>` : ''}
            <tr><td style="padding:3px 0;color:#888;">Plan</td><td style="padding:3px 0;font-weight:600;color:#1a2b5f;">${planName} &mdash; ${planPrice}</td></tr>
            ${d.natureOfBusiness ? `<tr><td style="padding:3px 0;color:#888;">Trades</td><td style="padding:3px 0;">${d.natureOfBusiness}</td></tr>` : ''}
            ${d.coverageStates ? `<tr><td style="padding:3px 0;color:#888;">Coverage</td><td style="padding:3px 0;">${d.coverageStates}</td></tr>` : ''}
          </table>
        </div>

        <p style="font-size:14px;color:#666;line-height:1.6;margin:22px 0 0;">
          Questions in the meantime? Call us at <a href="tel:8552243399" style="color:#2557a7;font-weight:600;text-decoration:none;">855-224-3399</a>
          or reply to this email.
        </p>

        <p style="font-size:14px;color:#444;margin:20px 0 0;">
          &mdash; The Select Home Warranty Service Provider Team
        </p>
      </div>

      <div style="background:#f4f5f7;padding:16px 28px;text-align:center;font-size:11px;color:#999;line-height:1.6;">
        Select Home Warranty, LLC &mdash; 1000 Wyckoff Ave, Mahwah, NJ 07430<br>
        You received this because you submitted a contractor application at apply.selectservicepros.com
      </div>

    </div>
  </div>`;
}
