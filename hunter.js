'use strict';

const HUNTER_BASE = 'https://api.hunter.io/v2';

function extractDomain(website) {
  try {
    return new URL(website).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function searchDomain(domain, apiKey) {
  try {
    const url = `${HUNTER_BASE}/domain-search?domain=${encodeURIComponent(domain)}&limit=3&api_key=${apiKey}`;
    const res = await fetch(url);

    if (!res.ok) {
      console.error(`Hunter error for ${domain}: ${res.status}`);
      return [];
    }

    const data = await res.json();
    const emails = (data.data?.emails || []);

    return emails.map(e => ({
      contactName: [e.first_name, e.last_name].filter(Boolean).join(' '),
      contactTitle: e.position || '',
      contactEmail: e.value || '',
      linkedIn: e.linkedin || '',
    })).filter(c => c.contactEmail);
  } catch (err) {
    console.error(`Hunter fetch failed for ${domain}: ${err.message}`);
    return [];
  }
}

async function enrichLeads(leads, apiKey, onProgress = () => {}) {
  const results = [];
  const total = leads.filter(l => l.website).length;
  let done = 0;

  for (const lead of leads) {
    const domain = lead.website ? extractDomain(lead.website) : null;

    if (!domain) {
      results.push({ ...lead, contactName: '', contactTitle: '', contactEmail: '', linkedIn: '' });
      continue;
    }

    const contacts = await searchDomain(domain, apiKey);
    done++;
    onProgress(`Hunter: enriched ${done}/${total} (${domain})`);

    if (contacts.length === 0) {
      results.push({ ...lead, contactName: '', contactTitle: '', contactEmail: '', linkedIn: '' });
    } else {
      for (const c of contacts) {
        results.push({ ...lead, ...c });
      }
    }

    // Hunter rate limit: 10 req/s on free, stay safe at ~6/s
    await delay(180);
  }

  return results;
}

module.exports = { enrichLeads };