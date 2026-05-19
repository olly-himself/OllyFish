'use strict';

const { chromium } = require('playwright');

async function extractExhibitors(page, pageUrl) {
  return page.evaluate((baseUrl) => {
    const results = [];
    const seen = new Set();
    const pageHost = new URL(baseUrl).hostname;

    const candidateSelectors = [
      '[class*="exhibitor"]', '[class*="Exhibitor"]',
      '[class*="company"]',   '[class*="Company"]',
      '[class*="booth"]',     '[class*="vendor"]',
      '[class*="sponsor"]',   '[class*="brand"]',
      '[data-exhibitor]',     '[data-company]',
      'article', '[class*="card"]', '[class*="item"]', 'li',
    ];

    let bestEls = [];
    for (const sel of candidateSelectors) {
      const els = Array.from(document.querySelectorAll(sel));
      if (els.length > bestEls.length && els.length >= 3) {
        bestEls = els;
        if (sel.includes('exhibitor') || sel.includes('company') || sel.includes('booth')) break;
      }
    }
    if (bestEls.length < 3) bestEls = Array.from(document.querySelectorAll('a[href]'));

    const navWords = ['home','menu','search','login','register','sign in','sign up',
      'about','contact','next','prev','previous','more','all','view','back','skip'];

    const profilePattern = /exhibitor|company|brand|vendor|booth|stand|partner|sponsor|profile|detail/i;

    for (const el of bestEls) {
      let name = '';
      const heading = el.querySelector(
        'h1,h2,h3,h4,h5,strong,b,[class*="name"],[class*="title"],[class*="company"]'
      );
      name = heading ? heading.innerText.trim() : el.innerText.trim().split('\n')[0].trim();

      if (!name || name.length < 2 || name.length > 120) continue;
      if (navWords.some(w => name.toLowerCase() === w)) continue;

      let website = '';
      const websiteLink = el.querySelector(
        'a[href*="website"],a[href*="www"],a[title*="website"],[class*="website"] a,[class*="url"] a'
      );
      if (websiteLink) {
        website = websiteLink.href;
      } else {
        const links = Array.from(el.querySelectorAll('a[href]')).concat(el.tagName === 'A' ? [el] : []);
        let best = null, bestScore = -Infinity;
        for (const a of links) {
          try {
            const u = new URL(a.href, baseUrl);
            const score = (u.hostname !== pageHost && u.hostname !== '' && !u.hostname.endsWith('.' + pageHost)) ? 10 : -10;
            if (score > bestScore) { bestScore = score; best = a; }
          } catch {}
        }
        if (best && bestScore > 0) website = best.href;
      }

      if (website) {
        try {
          const u = new URL(website, baseUrl);
          if (['http:','https:'].includes(u.protocol)) {
            ['utm_source','utm_medium','utm_campaign','utm_content','ref'].forEach(p => u.searchParams.delete(p));
            website = u.origin + u.pathname.replace(/\/$/, '');
          } else {
            website = '';
          }
        } catch { website = ''; }
      }

      // Capture internal profile/detail page link for later enrichment
      let profileUrl = '';
      const allLinks = Array.from(el.querySelectorAll('a[href]')).concat(el.tagName === 'A' ? [el] : []);
      const internalLinks = allLinks.filter(a => {
        try {
          const u = new URL(a.href, baseUrl);
          return u.hostname === pageHost && u.pathname !== new URL(baseUrl).pathname && u.pathname !== '/';
        } catch { return false; }
      });
      const profileLink = internalLinks.find(a => profilePattern.test(a.href)) || internalLinks[0];
      if (profileLink) profileUrl = profileLink.href;

      const key = name.toLowerCase() + '|' + website;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({ name, website, profileUrl });
    }

    return results;
  }, pageUrl);
}

// ─── Detail page website extraction ──────────────────────────────────────────

async function extractWebsiteFromDetailPage(page, pageUrl) {
  return page.evaluate((baseUrl) => {
    let pageHost = '';
    try { pageHost = new URL(baseUrl).hostname; } catch {}

    function cleanUrl(href) {
      try {
        const u = new URL(href, baseUrl);
        if (!['http:', 'https:'].includes(u.protocol)) return null;
        if (u.hostname === pageHost) return null;
        ['utm_source','utm_medium','utm_campaign','utm_content','ref'].forEach(p => u.searchParams.delete(p));
        return u.origin + u.pathname.replace(/\/$/, '');
      } catch { return null; }
    }

    // 1. Explicitly labelled website containers
    const labelSelectors = [
      '[class*="website"] a', '[class*="web-link"] a', '[class*="url"] a',
      'a[data-label*="website" i]', 'a[title*="website" i]',
    ];
    for (const sel of labelSelectors) {
      for (const el of document.querySelectorAll(sel)) {
        const clean = cleanUrl(el.href);
        if (clean) return clean;
      }
    }

    // 2. Links whose visible text says "website" / "visit site" etc.
    const keywords = ['website', 'visit site', 'visit us', 'company website', 'our website', 'go to website'];
    for (const a of document.querySelectorAll('a[href]')) {
      const t = (a.textContent || a.getAttribute('aria-label') || '').trim().toLowerCase();
      if (keywords.some(k => t === k || t.startsWith(k))) {
        const clean = cleanUrl(a.href);
        if (clean) return clean;
      }
    }

    // 3. Schema.org organization URL
    const orgEl = document.querySelector('[itemtype*="Organization"] [itemprop="url"]');
    if (orgEl) {
      const href = (orgEl.getAttribute('href') || orgEl.getAttribute('content') || orgEl.textContent || '').trim();
      const clean = cleanUrl(href);
      if (clean) return clean;
    }

    return null;
  }, pageUrl);
}

// ─── Post-processing ──────────────────────────────────────────────────────────

const JUNK_NAMES = new Set([
  'stand', 'add to plan', 'brands', 'brand', 'categories', 'category',
  'case studies', 'case study', 'brochure', 'white paper', 'press release',
  'connect', 'new exhibitor', 'exhibitor directory', 'keynote stage',
  'startup showcase', 'deep dive stage', 'technology showcase theatre',
  'other', 'exhibitor details', 'website', 'visit website', 'more info',
  'video', 'videos', 'document', 'documents', 'resources',
]);

function isJunkName(name) {
  if (!name) return true;
  const lower = name.toLowerCase().trim();
  if (JUNK_NAMES.has(lower)) return true;
  if (lower.startsWith('sponsor of')) return true;
  if (name.length > 80 && name.includes(' ') && name.split(' ').length > 6) return true;
  return false;
}

function isExternalUrl(url, sourceDomain) {
  if (!url) return false;
  try { return new URL(url).hostname !== sourceDomain; } catch { return false; }
}

function cleanLeads(rawLeads, sourceUrl) {
  let sourceDomain = '';
  try { sourceDomain = new URL(sourceUrl).hostname; } catch {}

  const companyRows = [];
  const orphanWebsites = [];

  rawLeads.forEach((lead, i) => {
    const external = isExternalUrl(lead.website, sourceDomain) ? lead.website : '';
    if (isJunkName(lead.companyName)) {
      if (external) orphanWebsites.push({ website: external, index: i });
    } else {
      companyRows.push({ ...lead, website: external, index: i });
    }
  });

  const byName = new Map();
  for (const row of companyRows) {
    const key = row.companyName.toLowerCase();
    if (!byName.has(key)) {
      byName.set(key, row);
    } else if (!byName.get(key).website && row.website) {
      byName.get(key).website = row.website;
    }
  }

  for (const orphan of orphanWebsites) {
    let bestKey = null, bestDist = Infinity;
    for (const [key, company] of byName) {
      if (!company.website && company.index < orphan.index) {
        const dist = orphan.index - company.index;
        if (dist < bestDist && dist <= 10) { bestDist = dist; bestKey = key; }
      }
    }
    if (bestKey) byName.get(bestKey).website = orphan.website;
  }

  return Array.from(byName.values()).map(({ companyName, website, expoName, expoDate }) => ({
    companyName, website, expoName, expoDate,
  }));
}

// ─── Pagination / scroll helpers ──────────────────────────────────────────────

async function findNextPageUrl(page) {
  return page.evaluate(() => {
    const selectors = [
      'a[rel="next"]', 'a[aria-label*="next" i]', 'a[aria-label*="Next" i]',
      '.pagination a.next', '.pagination__next a',
      '[class*="pagination"] a[class*="next"]', '[class*="next-page"]',
      'button[aria-label*="next" i]',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        const href = el.getAttribute('href');
        if (href && !href.startsWith('#')) return href;
      }
    }
    return null;
  });
}

async function autoScroll(page, pauseMs) {
  await page.evaluate(async (pause) => {
    await new Promise(resolve => {
      let lastHeight = 0;
      const timer = setInterval(() => {
        window.scrollBy(0, window.innerHeight);
        const newHeight = document.body.scrollHeight;
        if (newHeight === lastHeight) { clearInterval(timer); resolve(); }
        lastHeight = newHeight;
      }, pause);
    });
  }, pauseMs);
}

// ─── Main export ──────────────────────────────────────────────────────────────

async function scrapeExhibitors(url, { expoName, expoDate, headless = true, timeout = 30000, scrollPause = 1500, maxPages = 20, onProgress = () => {} }) {
  const browser = await chromium.launch({
    headless,
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: process.env.CHROMIUM_PATH ? ['--no-sandbox', '--disable-setuid-sandbox'] : [],
  });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();

  const rawLeads = [];
  const seenKeys = new Set();
  let currentUrl = url;
  let pageNum = 0;

  try {
    // Phase 1: scrape all listing pages
    while (currentUrl && pageNum < maxPages) {
      pageNum++;
      onProgress(`Scraping page ${pageNum}…`);

      try {
        await page.goto(currentUrl, { waitUntil: 'domcontentloaded', timeout });
        await page.waitForTimeout(1500);
        await autoScroll(page, scrollPause);
      } catch (err) {
        onProgress(`Navigation error on page ${pageNum}: ${err.message}`);
        break;
      }

      const exhibitors = await extractExhibitors(page, currentUrl);
      let newCount = 0;
      for (const ex of exhibitors) {
        const key = ex.name.toLowerCase() + '|' + ex.website;
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          rawLeads.push({ companyName: ex.name, website: ex.website, profileUrl: ex.profileUrl, expoName, expoDate });
          newCount++;
        }
      }
      onProgress(`Page ${pageNum}: ${newCount} entries collected (${rawLeads.length} total)`);

      const nextHref = await findNextPageUrl(page);
      if (nextHref) {
        currentUrl = new URL(nextHref, currentUrl).href;
      } else {
        break;
      }
    }

    // Phase 2: visit individual exhibitor pages to recover missing websites
    const needsProfile = rawLeads.filter(l => !l.website && l.profileUrl);
    if (needsProfile.length > 0) {
      onProgress(`Visiting ${needsProfile.length} exhibitor pages to find missing websites…`);
      let done = 0, found = 0;
      for (const lead of needsProfile) {
        try {
          await page.goto(lead.profileUrl, { waitUntil: 'domcontentloaded', timeout });
          await page.waitForTimeout(800);
          const website = await extractWebsiteFromDetailPage(page, lead.profileUrl);
          if (website) { lead.website = website; found++; }
        } catch {}
        done++;
        if (done % 25 === 0 || done === needsProfile.length) {
          onProgress(`Profile pages: ${done}/${needsProfile.length} visited — ${found} websites found`);
        }
      }
    }
  } finally {
    await browser.close();
  }

  // Strip internal field before post-processing
  rawLeads.forEach(l => delete l.profileUrl);

  const leads = cleanLeads(rawLeads, url);
  onProgress(`Cleaned to ${leads.length} unique companies`);
  return leads;
}

module.exports = { scrapeExhibitors };