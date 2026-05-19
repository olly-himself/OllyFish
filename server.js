'use strict';

const express = require('express');
const cors = require('cors');
const { scrapeExhibitors } = require('./scraper');
const { enrichLeads } = require('./apollo');

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY;
const APOLLO_API_KEY = process.env.APOLLO_API_KEY;

app.use(express.json());
app.use(cors({ origin: process.env.ALLOWED_ORIGIN || '*' }));

function requireApiKey(req, res, next) {
  if (!API_KEY) return next();
  if (req.headers['x-api-key'] !== API_KEY) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  next();
}

app.get('/health', (_req, res) => res.json({ ok: true, apollo: !!APOLLO_API_KEY }));

app.post('/scrape', requireApiKey, async (req, res) => {
  const { url, expoName, expoDate } = req.body;

  if (!url || !expoName || !expoDate) {
    return res.status(400).json({ error: 'url, expoName, and expoDate are required' });
  }

  try { new URL(url); } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  const progress = [];

  try {
    const scraped = await scrapeExhibitors(url, {
      expoName,
      expoDate,
      headless: true,
      onProgress: msg => { progress.push(msg); console.log(msg); },
    });

    let leads = scraped;
    if (APOLLO_API_KEY) {
      progress.push(`Starting Apollo enrichment for ${scraped.length} companies…`);
      leads = await enrichLeads(scraped, APOLLO_API_KEY, msg => {
        progress.push(msg);
        console.log(msg);
      });
      progress.push(`Enrichment complete — ${leads.length} contacts found`);
    }

    res.json({ leads, count: leads.length, enriched: !!APOLLO_API_KEY, progress });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message, progress });
  }
});

app.listen(PORT, () => console.log(`OllyFish API running on port ${PORT}`));
