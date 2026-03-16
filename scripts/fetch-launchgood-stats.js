/**
 * Scraper for LaunchGood campaign page.
 * Uses Puppeteer (via puppeteer-core and a system Chrome) to load the live page (client-side rendered),
 * extracts total raised, goal, supporters, days left and writes launchgood-stats.json.
 * Can run locally: `node scripts/fetch-launchgood-stats.js`
 */
const { writeFileSync, mkdirSync, existsSync } = require("fs");
const { join, dirname } = require("path");
const puppeteer = require("puppeteer-core");

const CAMPAIGN_URL =
  "https://www.launchgood.com/v4/campaign/almuflihoon_fundraiser_1";

// Output at repo root: data/launchgood-stats.json
const OUT_PATH = join(__dirname, "..", "data", "launchgood-stats.json");

const DEFAULT = {
  raised: 9003,
  goal: 15000,
  supporters: 2971,
  daysLeft: 124,
};

function getChromeExecutablePath() {
  // 1. Respect explicit env overrides first
  const envPath =
    process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_PATH;
  if (envPath && existsSync(envPath)) return envPath;

  // 2. Common locations (macOS, Linux on GitHub Actions)
  const candidates = [
    // macOS
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    // Linux (GitHub Actions / Ubuntu)
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
  ];

  for (const p of candidates) {
    if (existsSync(p)) return p;
  }

  throw new Error(
    "Could not find Chrome executable. Set PUPPETEER_EXECUTABLE_PATH or CHROME_PATH to a valid Chrome/Chromium binary."
  );
}

function parseNumber(str) {
  return parseInt(String(str).replace(/,/g, ""), 10) || 0;
}

async function scrapeWithPuppeteer() {
  const executablePath = getChromeExecutablePath();

  const browser = await puppeteer.launch({
    executablePath,
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
  });

  try {
    const page = await browser.newPage();

    await page.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );

    await page.goto(CAMPAIGN_URL, {
      waitUntil: "networkidle2",
      timeout: 60_000,
    });

    // Use innerText-based regexes so we are resilient to DOM / class changes.
    const text = await page.evaluate(() => document.body.innerText || "");

    const stats = { ...DEFAULT };

    // Raised: look for currency-prefixed number (e.g. "£9,003")
    const raisedMatch = text.match(/£\s*([\d,]+)/);
    if (raisedMatch) stats.raised = parseNumber(raisedMatch[1]);

    // Goal: "raised of £15,000 GBP goal" or similar
    const goalMatch = text.match(/raised\s+of\s+£\s*([\d,]+)\s*GBP/i);
    if (goalMatch) stats.goal = parseNumber(goalMatch[1]);

    // Supporters: "2971 supporters"
    const supportersMatch = text.match(/(\d[\d,]*)\s+supporters/i);
    if (supportersMatch) stats.supporters = parseNumber(supportersMatch[1]);

    // Days left: "123 days left"
    const daysMatch = text.match(/(\d+)\s+days\s+left/i);
    if (daysMatch) stats.daysLeft = parseNumber(daysMatch[1]);

    return stats;
  } finally {
    await browser.close();
  }
}

async function main() {
  let stats = { ...DEFAULT };

  try {
    stats = await scrapeWithPuppeteer();
  } catch (err) {
    console.warn("LaunchGood Puppeteer scrape error:", err.message);
  }

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(stats, null, 2) + "\n", "utf8");
  console.log("Wrote", OUT_PATH, ":", JSON.stringify(stats));
}

main();
