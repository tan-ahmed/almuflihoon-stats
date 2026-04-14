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

function pickRaisedFromText(text, goal) {
  // Prefer the explicit progress phrase if present:
  // "£11,020 raised of £15,000 GBP goal" (or variants without GBP)
  const progressMatch = text.match(
    /£\s*([\d,]+)\s*(?:GBP\s*)?raised\s+of\s+£\s*([\d,]+)\s*(?:GBP\s*)?(?:goal)?/i
  );
  if (progressMatch) {
    const raised = parseNumber(progressMatch[1]);
    const parsedGoal = parseNumber(progressMatch[2]);
    return { raised, goal: parsedGoal || goal };
  }

  // Fallback: collect all currency amounts and pick a plausible "raised" value.
  // The page can include small donation tier amounts (e.g. £20) which we should ignore.
  const amounts = Array.from(text.matchAll(/£\s*([\d,]+)/g)).map((m) =>
    parseNumber(m[1])
  );

  const unique = Array.from(new Set(amounts)).filter((n) => Number.isFinite(n));

  // Ignore tiny values that are almost certainly donation tiers.
  const nonTrivial = unique.filter((n) => n >= 100);

  if (nonTrivial.length === 0) return { raised: 0, goal };

  if (goal && goal > 0) {
    // Prefer the largest amount that doesn't exceed the goal (raised should be <= goal).
    const underOrEqualGoal = nonTrivial
      .filter((n) => n <= goal)
      .sort((a, b) => b - a);
    if (underOrEqualGoal.length > 0) return { raised: underOrEqualGoal[0], goal };

    // If everything exceeds goal (weird), just take the largest non-trivial amount.
  }

  nonTrivial.sort((a, b) => b - a);
  return { raised: nonTrivial[0], goal };
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

    // The page often animates / counts up. Wait until the "£X raised of £Y" text is present
    // and stable before reading `innerText`, otherwise we can capture an intermediate value.
    const progressRegexSrc =
      String.raw`£\s*([\d,]+)\s*(?:GBP\s*)?raised\s+of\s+£\s*([\d,]+)\s*(?:GBP\s*)?(?:goal)?`;

    try {
      await page.waitForFunction(
        (reSrc) => {
          const re = new RegExp(reSrc, "i");
          const text = document.body?.innerText || "";
          const m = text.match(re);
          if (!m) return false;

          const raised = parseInt(String(m[1]).replace(/,/g, ""), 10) || 0;
          const goal = parseInt(String(m[2]).replace(/,/g, ""), 10) || 0;
          if (raised < 100 || goal < 1000) return false;
          if (goal > 0 && raised > goal) return false;

          const w = window;
          w.__lg_prevRaised = w.__lg_prevRaised ?? null;
          w.__lg_prevAt = w.__lg_prevAt ?? 0;

          const now = Date.now();
          if (w.__lg_prevRaised === raised) {
            // stable for >= 1200ms
            return now - w.__lg_prevAt >= 1200;
          }

          w.__lg_prevRaised = raised;
          w.__lg_prevAt = now;
          return false;
        },
        { timeout: 45_000, polling: 250 },
        progressRegexSrc
      );
    } catch {
      // If this times out (markup changes, banner blocks text, etc), we still attempt a best-effort parse below.
    }

    // Use innerText-based regexes so we are resilient to DOM / class changes.
    const text = await page.evaluate(() => document.body.innerText || "");

    const stats = { ...DEFAULT };

    // Goal: "raised of £15,000 GBP goal" or similar
    const goalMatch = text.match(/raised\s+of\s+£\s*([\d,]+)\s*GBP/i);
    if (goalMatch) stats.goal = parseNumber(goalMatch[1]);

    // Raised (and sometimes goal) from progress text; fallback to plausible currency amount
    const { raised, goal } = pickRaisedFromText(text, stats.goal);
    if (goal) stats.goal = goal;
    if (raised) stats.raised = raised;

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
