'use strict';

const APOLLO_BASE = 'https://api.apollo.io/api/v1';

// Decision-maker titles relevant to ExpoCall (AI outbound calling for exhibitors)
const TARGET_TITLES = [
  'CEO', 'Chief Executive Officer', 'Co-Founder', 'Founder', 'Owner', 'Managing Director',
  'CRO', 'Chief Revenue Officer',
  'VP Sales', 'VP of Sales', 'Vice President of Sales', 'Vice President Sales',
  'Head of Sales', 'Sales Director', 'Director of Sales', 'Director of Business Development',
  'CMO', 'Chief Marketing Officer',
  'VP Marketing', 'VP of Marketing', 'Head of Marketing', 'Marketing Director',
  'Head of Events', 'Events Manager', 'Event Manager', 'Trade Show Manager',
  'Head of Growth', 'Growth Director',
];

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

async function searchContacts(domain, apiKey) {
  try {
    const res = await fetch(`${APOLLO_BASE}/mixed_people/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({
        q_organization_domains: domain,
        person_titles: TARGET_TITLES,
        per_page: 3,
        page: 1,
      }),
    });

    if (!res.ok) {
      console.error(`Apollo error for ${domain}: ${res.status}`);
      return [];
    }

    const data = await res.json();
    return (data.people || []).map(p => ({
      contactName: p.name || '',
      contactTitle: p.title || '',
      contactEmail: p.email || '',
      linkedIn: p.linkedin_url || '',
    }));
  } catch (err) {
    console.error(`Apollo fetch failed for ${domain}: ${err.message}`);
    return [];
  }
}

/**
 * Enrich leads with Apollo contacts.
 * Returns one row per contact found (up to 3 per company).
 * Companies with no contacts get one row with blank contact fields.
 */
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

    const contacts = await searchContacts(domain, apiKey);
    done++;
    onProgress(`Apollo: enriched ${done}/${total} (${domain})`);

    if (contacts.length === 0) {
      results.push({ ...lead, contactName: '', contactTitle: '', contactEmail: '', linkedIn: '' });
    } else {
      for (const c of contacts) {
        results.push({ ...lead, ...c });
      }
    }

    // Respect Apollo rate limits (~200 req/min)
    await delay(350);
  }

  return results;
}

module.exports = { enrichLeads };
