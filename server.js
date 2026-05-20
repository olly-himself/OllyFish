'use strict';

const express = require('express');
const cors = require('cors');
const { scrapeExhibitors } = require('./scraper');
const { pushLeads } = require('./clay');

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY;

app.use(express.json());
app.use(cors({ origin: process.env.ALLOWED_ORIGIN || '*' }));

function requireApiKey(req, res, next) {
  if (!API_KEY) return next();
  if (req.headers['x-api-key'] !== API_KEY) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  next();
}

app.get('/health', (_req, res) => res.json({ ok: true }));

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
    const leads = await scrapeExhibitors(url, {
      expoName,
      expoDate,
      headless: true,
      onProgress: msg => { progress.push(msg); console.log(msg); },
    });

    res.json({ leads, count: leads.length, progress });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message, progress });
  }
});

app.post('/push-to-clay', requireApiKey, async (req, res) => {
  const { leads, webhookUrl, authToken } = req.body;

  if (!leads || !Array.isArray(leads) || !webhookUrl) {
    return res.status(400).json({ error: 'leads array and webhookUrl are required' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    await pushLeads(leads, webhookUrl, authToken || '', ({ sent, failed, total, company }) => {
      send({ type: 'progress', sent, failed, total, company });
    });
    const final = { sent: leads.length, failed: 0 };
    send({ type: 'done', ...final });
  } catch (err) {
    send({ type: 'error', message: err.message });
  }

  res.end();
});

app.listen(PORT, () => console.log(`OllyFish API running on port ${PORT}`));