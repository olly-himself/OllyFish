#!/usr/bin/env node
'use strict';

const { createObjectCsvWriter } = require('csv-writer');
const { Command } = require('commander');
const path = require('path');
const { scrapeExhibitors } = require('./scraper');

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

async function main() {
  console.log(`\nOllyFish Lead Scraper`);
  console.log(`Expo:   ${expoName}`);
  console.log(`Date:   ${expoDate}`);
  console.log(`URL:    ${url}`);
  console.log(`Output: ${opts.output}\n`);

  const leads = await scrapeExhibitors(url, {
    expoName,
    expoDate,
    headless: opts.headless,
    timeout: parseInt(opts.timeout, 10),
    scrollPause: parseInt(opts.scrollPause, 10),
    maxPages: parseInt(opts.maxPages, 10),
    onProgress: msg => console.log(' ', msg),
  });

  if (leads.length === 0) {
    console.log('\nNo leads found. Try --no-headless to debug the page.');
    process.exit(1);
  }

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

  await csvWriter.writeRecords(leads);
  console.log(`\nDone! ${leads.length} leads written to ${outputPath}`);
}

main().catch(err => { console.error(err); process.exit(1); });
