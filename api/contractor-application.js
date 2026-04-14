import nodemailer from 'nodemailer';

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

    // Build email attachments from base64 files
    const attachments = [];
    if (data.files && Array.isArray(data.files)) {
      for (const file of data.files) {
        if (file.base64 && file.name) {
          attachments.push({
            filename: file.name,
            content: file.base64.split(',').pop(),
            encoding: 'base64',
            contentType: file.type || 'application/octet-stream'
          });
        }
      }
    }

    // Build HTML email body
    const html = buildEmailHTML(data);

    // Create transporter
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD
      }
    });

    // Send email
    const mailOptions = {
      from: `"SHW Contractor Application" <${process.env.GMAIL_USER}>`,
      to: process.env.NOTIFY_EMAIL || 'serviceprovider@selecthomewarranty.com',
      cc: data.email || undefined,
      subject: `New Contractor Application — ${data.companyName || 'Unknown Company'}`,
      html: html,
      attachments: attachments
    };

    await transporter.sendMail(mailOptions);

    return res.status(200).json({ success: true, message: 'Application submitted successfully' });
  } catch (error) {
    console.error('Email send error:', error);
    return res.status(500).json({ error: 'Failed to submit application. Please try again.' });
  }
}

function buildEmailHTML(d) {
  const s = `style="border:1px solid #ddd;border-collapse:collapse;padding:8px 12px;text-align:left;font-size:14px;"`;
  const sh = `style="border:1px solid #ddd;border-collapse:collapse;padding:8px 12px;text-align:left;font-size:14px;background:#f0f2f5;font-weight:600;width:220px;"`;
  const row = (label, val) => val ? `<tr><td ${sh}>${label}</td><td ${s}>${val}</td></tr>` : '';

  // Coverage items
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

  // Licenses
  let licensesHTML = '';
  if (d.licenses && Array.isArray(d.licenses)) {
    licensesHTML = d.licenses.map((lic, i) => 
      `License ${i + 1}: ${lic.authority || ''} | ${lic.type || ''} | #${lic.number || ''} | Permits: ${lic.permits || ''}`
    ).join('<br>');
  }

  // Parts markup
  let markupHTML = '';
  if (d.partsMarkup && typeof d.partsMarkup === 'object') {
    const tiers = Object.entries(d.partsMarkup);
    markupHTML = tiers.map(([tier, pct]) => `${tier}: ${pct}%`).join(', ');
  }

  // File list
  let filesHTML = '';
  if (d.files && Array.isArray(d.files)) {
    filesHTML = d.files.map(f => `📎 ${f.name} (${f.category || 'document'})`).join('<br>');
  }

  return `
    <div style="font-family:'DM Sans',Arial,sans-serif;max-width:700px;margin:0 auto;color:#333;">
      <div style="background:#1a2b5f;padding:24px;text-align:center;">
        <h1 style="color:#fff;margin:0;font-size:22px;">New Contractor Application</h1>
        <p style="color:#c0c4cc;margin:8px 0 0;font-size:14px;">Select Home Warranty — Service Provider Application</p>
      </div>

      <div style="padding:24px;">
        <h2 style="color:#1a2b5f;border-bottom:2px solid #2557a7;padding-bottom:8px;">General Information</h2>
        <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
          ${row('Company Name', d.companyName)}
          ${row('DBA', d.dba)}
          ${row('Address', d.address)}
          ${row('City / State / ZIP', `${d.city || ''}, ${d.state || ''} ${d.zip || ''}`)}
          ${row('Phone', d.phone)}
          ${row('Fax', d.fax)}
          ${row('Email', d.email)}
          ${row('Website', d.website)}
          ${row('Google Business Profile', d.googleBusinessProfile)}
          ${row('Owner Name', d.ownerName)}
          ${row('Owner Cell', d.ownerCell)}
          ${row('Nature of Business', d.natureOfBusiness)}
          ${row('Years in Business', d.yearsInBusiness)}
          ${row('Tax ID / EIN', d.taxId)}
          ${row('Business Type', d.businessType)}
        </table>

        <h2 style="color:#1a2b5f;border-bottom:2px solid #2557a7;padding-bottom:8px;">Operations</h2>
        <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
          ${row('Number of Technicians', d.numTechnicians)}
          ${row('Uniformed?', d.uniformed)}
          ${row('Number of Vehicles', d.vehicles)}
          ${row('Hours — Mon-Fri', d.hoursMF)}
          ${row('Hours — Saturday', d.hoursSat)}
          ${row('Hours — Sunday', d.hoursSun)}
          ${row('Hours — Holiday', d.hoursHoliday)}
          ${row('Phone Handler', d.phoneHandler)}
          ${row('Emergency Handler', d.emergencyHandler)}
          ${row('Scheduling System', d.schedulingSystem)}
          ${row('Credit Cards Accepted', d.creditCards)}
          ${row('Will Install SHW Parts?', d.installSHWParts)}
          ${row('Other Warranty Companies', d.otherWarrantyCompanies)}
        </table>

        <h2 style="color:#1a2b5f;border-bottom:2px solid #2557a7;padding-bottom:8px;">Licenses & Rates</h2>
        <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
          ${row('Contractor Licenses', licensesHTML)}
          ${row('Service Call Fee (Regular)', d.serviceCallRegular)}
          ${row('Service Call Fee (SHW Discounted)', d.serviceCallSHW)}
          ${row('Hourly Labor Rate (Regular)', d.laborRateRegular)}
          ${row('Hourly Labor Rate (SHW Discounted)', d.laborRateSHW)}
          ${row('Parts Mark-up', markupHTML)}
          ${row('Sales Tax %', d.salesTax)}
          ${row('Coverage States/Areas', d.coverageAreas)}
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
          ${row('Files', filesHTML || 'No files uploaded')}
        </table>

        <hr style="border:none;border-top:1px solid #ddd;margin:24px 0;">
        <p style="font-size:12px;color:#888;text-align:center;">
          Select Home Warranty, LLC — 1000 Wyckoff Ave, Mahwah, NJ 07430 — 855-267-3532
        </p>
      </div>
    </div>
  `;
}
