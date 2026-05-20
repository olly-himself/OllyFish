'use strict';

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function pushLeads(leads, webhookUrl, authToken, onProgress) {
  let sent = 0, failed = 0;
  const total = leads.length;

  for (let i = 0; i < leads.length; i++) {
    const lead = leads[i];
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (authToken) headers['x-clay-webhook-auth'] = authToken;

      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          company_name: lead.companyName,
          website: lead.website || '',
          expo_name: lead.expoName || '',
          expo_date: lead.expoDate || '',
        }),
      });

      if (res.ok) { sent++; } else {
        failed++;
        console.error(`Clay push failed for ${lead.companyName}: ${res.status}`);
      }
    } catch (err) {
      failed++;
      console.error(`Clay push error for ${lead.companyName}: ${err.message}`);
    }

    onProgress({ sent, failed, total, company: lead.companyName });

    // Stay safely under Clay's 10 req/s limit
    await delay(130);
  }

  return { sent, failed, total };
}

module.exports = { pushLeads };