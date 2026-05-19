#!/usr/bin/env node
'use strict';

const { chromium } = require('playwright');
const { createObjectCsvWriter } = require('csv-writer');
const { Command } = require('commander');
const path = require('path');
const fs = require('fs');

const program = new Command();
program
  .name('ollyfish')
  .description('Scrape exhibitor directories and output a CSV ready for Apollo.io import')
  .argument('<url>', 'Exhibitor directory URL')
  .argument('<expo-name>', 'Name of the expo/trade show')
  .argument('<expo-date>', 'Date of the expo (e.g. 2025-09-15)')
  .option('-o, --output <file>', 'Output CSV file path', 'leads.csv')
  .option('--headless', 'Run browser in headless mode', true)
  .option('--no-headless', 'Show browser window (useful for debugging)')
  .option('--timeout <ms>', 'Navigation timeout in milliseconds', '30000')
  .option('--scroll-pause <ms>', 'Pause between scrolls for lazy-loading', '1500')
  .option('--max-pages <n>', 'Max pagination pages to scrape', '20')
  .parse();

const [url, expoName, expoDate] = program.args;
const opts = program.opts();

// ─── Extraction helpers ───────────────────────────────────────────────────────

// Normalise a URL: strip tracking params, ensure absolute, dedupe www
function normaliseUrl(href, base) {
  try {
    const u = new URL(href, base);
    // Only keep http/https
    if (!['http:', 'https:'].includes(u.protocol)) return null;
    // Strip common tracking params
    ['utm_source','utm_medium','utm_campaign','utm_term','utm_content','ref','source'].forEach(p => u.searchParams.delete(p));
    return u.origin + u.pathname.replace(/\/$/, '');
  } catch {
    return null;
  }
}

// Score how likely an <a> tag is a company website link (not an internal/social/nav link)
function websiteScore(href, base) {
  try {
    const u = new URL(href, base);
    const baseHost = new URL(base).hostname;
    // Penalise links staying on same domain
    if (u.hostname === baseHost || u.hostname.endsWith('.' + baseHost)) return -10;
    // Penalise known non-company domains
    const skipDomains = ['linkedin.com','facebook.com','twitter.com','instagram.com',
      'youtube.com','mailto:','tel:','javascript:','google.com','bing.com'];
    if (skipDomains.some(d => u.hostname.includes(d))) return -5;
    return 10;
  } catch {
    return -10;
  }
}

// ─── Page-level extraction ─────────────────────────────────────────────────────

async function extractExhibitors(page, pageUrl) {
  return page.evaluate((baseUrl) => {
    const results = [];
    const seen = new Set();

    // Heuristic selectors for exhibitor listings — ordered by specificity
    const candidateSelectors = [
      // Common class/attribute patterns on expo sites
      '[class*="exhibitor"]',
      '[class*="Exhibitor"]',
      '[class*="company"]',
      '[class*="Company"]',
      '[class*="booth"]',
      '[class*="vendor"]',
      '[class*="sponsor"]',
      '[class*="brand"]',
      '[data-exhibitor]',
      '[data-company]',
      // Generic list/card patterns
      'article',
      '[class*="card"]',
      '[class*="item"]',
      'li',
    ];

    // Find the selector that returns the most results (above a min threshold)
    let bestEls = [];
    for (const sel of candidateSelectors) {
      const els = Array.from(document.querySelectorAll(sel));
      if (els.length > bestEls.length && els.length >= 3) {
        bestEls = els;
        // If we found a very specific exhibitor selector, stop early
        if (sel.includes('exhibitor') || sel.includes('company') || sel.includes('booth')) break;
      }
    }

    // If we still have nothing useful, fall back to all visible text nodes with links
    if (bestEls.length < 3) {
      bestEls = Array.from(document.querySelectorAll('a[href]'));
    }

    for (const el of bestEls) {
      // Try to extract company name
      let name = '';
      // Prefer explicit heading/label children
      const heading = el.querySelector('h1,h2,h3,h4,h5,strong,b,[class*="name"],[class*="title"],[class*="company"]');
      if (heading) {
        name = heading.innerText.trim();
      } else {
        name = el.innerText.trim().split('\n')[0].trim();
      }

      // Skip empty, too-short, or obviously non-company strings
      if (!name || name.length < 2 || name.length > 120) continue;
      // Skip navigation-like labels
      const navWords = ['home','menu','search','login','register','sign in','sign up','about','contact','next','prev','previous','more','all','view','back','skip'];
      if (navWords.some(w => name.toLowerCase() === w)) continue;

      // Try to find a website link
      let website = '';
      // Prefer explicit "website" / "visit" links within the element
      const websiteLink = el.querySelector('a[href*="website"],a[href*="www"],a[title*="website"],[class*="website"] a,[class*="url"] a');
      if (websiteLink) {
        website = websiteLink.href;
      } else {
        // Score all <a> tags in this element
        const links = Array.from(el.querySelectorAll('a[href]')).concat(el.tagName === 'A' ? [el] : []);
        let best = null, bestScore = -Infinity;
        for (const a of links) {
          try {
            const u = new URL(a.href, baseUrl);
            const pageHost = new URL(baseUrl).hostname;
            const score = (u.hostname !== pageHost && u.hostname !== '' && !u.hostname.endsWith('.' + pageHost)) ? 10 : -10;
            if (score > bestScore) { bestScore = score; best = a; }
          } catch {}
        }
        if (best && bestScore > 0) website = best.href;
      }

      // Normalise website
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

      const key = name.toLowerCase() + '|' + website;
      if (seen.has(key)) continue;
      seen.add(key);

      results.push({ name, website });
    }

    return results;
  }, pageUrl);
}

// ─── Pagination helpers ────────────────────────────────────────────────────────

async function findNextPageUrl(page) {
  return page.evaluate(() => {
    const selectors = [
      'a[rel="next"]',
      'a[aria-label*="next" i]',
      'a[aria-label*="Next" i]',
      '.pagination a.next',
      '.pagination__next a',
      '[class*="pagination"] a[class*="next"]',
      '[class*="next-page"]',
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

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const browser = await chromium.launch({ headless: opts.headless });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();

  const allLeads = [];
  const seenKeys = new Set();
  let currentUrl = url;
  let pageNum = 0;
  const maxPages = parseInt(opts.maxPages, 10);
  const timeout = parseInt(opts.timeout, 10);
  const scrollPause = parseInt(opts.scrollPause, 10);

  console.log(`\nOllyFish Lead Scraper`);
  console.log(`Expo:    ${expoName}`);
  console.log(`Date:    ${expoDate}`);
  console.log(`URL:     ${url}`);
  console.log(`Output:  ${opts.output}\n`);

  while (currentUrl && pageNum < maxPages) {
    pageNum++;
    console.log(`Scraping page ${pageNum}: ${currentUrl}`);

    try {
      await page.goto(currentUrl, { waitUntil: 'domcontentloaded', timeout });
      // Extra wait for JS-heavy pages
      await page.waitForTimeout(1500);
      await autoScroll(page, scrollPause);
    } catch (err) {
      console.error(`  Navigation error: ${err.message}`);
      break;
    }

    const exhibitors = await extractExhibitors(page, currentUrl);
    let newCount = 0;
    for (const ex of exhibitors) {
      const key = ex.name.toLowerCase() + '|' + ex.website;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        allLeads.push({ companyName: ex.name, website: ex.website, expoName, expoDate });
        newCount++;
      }
    }
    console.log(`  Found ${exhibitors.length} entries, ${newCount} new (total: ${allLeads.length})`);

    // Check for next page
    const nextHref = await findNextPageUrl(page);
    if (nextHref) {
      currentUrl = new URL(nextHref, currentUrl).href;
    } else {
      break;
    }
  }

  await browser.close();

  if (allLeads.length === 0) {
    console.log('\nNo leads found. Try running with --no-headless to debug the page.');
    process.exit(1);
  }

  // Write CSV
  const outputPath = path.resolve(opts.output);
  const csvWriter = createObjectCsvWriter({
    path: outputPath,
    header: [
      { id: 'companyName', title: 'Company Name' },
      { id: 'website',     title: 'Website' },
      { id: 'expoName',    title: 'Expo Name' },
      { id: 'expoDate',    title: 'Expo Date' },
    ],
  });

  await csvWriter.writeRecords(allLeads);
  console.log(`\nDone! ${allLeads.length} leads written to ${outputPath}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
