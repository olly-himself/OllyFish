# OllyFish

Scrape trade show exhibitor directories and output Apollo.io-ready CSVs for the ExpoCall outreach pipeline.

## Usage

```bash
node scrape.js <url> "<expo name>" "<expo date>" [options]
```

### Arguments

| Argument | Description |
|---|---|
| `url` | Exhibitor directory page URL |
| `expo name` | Name of the trade show (written to every CSV row) |
| `expo date` | Date of the show, e.g. `2025-09-15` |

### Options

| Flag | Default | Description |
|---|---|---|
| `-o, --output <file>` | `leads.csv` | Output file path |
| `--no-headless` | — | Show the browser (useful for debugging) |
| `--timeout <ms>` | `30000` | Page navigation timeout |
| `--scroll-pause <ms>` | `1500` | Pause between auto-scrolls (increase for slow lazy-loading pages) |
| `--max-pages <n>` | `20` | Maximum pagination pages to follow |

### Examples

```bash
# Basic usage
node scrape.js "https://example-expo.com/exhibitors" "SaaStr Annual 2025" "2025-09-15"

# Custom output file
node scrape.js "https://example-expo.com/exhibitors" "SaaStr Annual 2025" "2025-09-15" -o saastr-leads.csv

# Debug with visible browser
node scrape.js "https://example-expo.com/exhibitors" "SaaStr Annual 2025" "2025-09-15" --no-headless
```

## Output CSV columns

| Column | Description |
|---|---|
| Company Name | Exhibitor company name |
| Website | Company website URL |
| Expo Name | Trade show name (from argument) |
| Expo Date | Trade show date (from argument) |

Import the CSV directly into Apollo.io for contact enrichment and email sequencing.

## Setup

```bash
npm install
npx playwright install chromium
```
