/**
 * Scraper for LaunchGood campaign page.
 * Fetches total raised, goal, supporters, days left and writes launchgood-stats.json.
 * Run by GitHub Actions every 6 hours; can also run locally: node scripts/fetch-launchgood-stats.js
 */
const { writeFileSync, mkdirSync } = require("fs");
const { join, dirname } = require("path");

const CAMPAIGN_URL =
  "https://www.launchgood.com/v4/campaign/almuflihoon_fundraiser_1";

// Output next to this script's repo root: almuflihoon-stats-pack/launchgood-stats.json
const OUT_PATH = join(
  __dirname,
  "..",
  "almuflihoon-stats-pack",
  "launchgood-stats.json"
);

const DEFAULT = {
  raised: 9003,
  goal: 15000,
  supporters: 2971,
  daysLeft: 124,
};

function parseNumber(str) {
  return parseInt(String(str).replace(/,/g, ""), 10) || 0;
}

async function main() {
  let stats = { ...DEFAULT };

  try {
    const res = await fetch(CAMPAIGN_URL, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-GB,en;q=0.9",
      },
    });

    if (!res.ok) {
      console.warn("LaunchGood fetch not ok:", res.status);
      write(stats);
      return;
    }

    const html = await res.text();

    // Raised: <span>£</span><span>9,003</span> (with optional classes)
    const raisedMatch = html.match(
      /<span>£\s*<\/span>\s*<span[^>]*>([\d,]+)<\/span>/
    );
    if (raisedMatch) stats.raised = parseNumber(raisedMatch[1]);

    // Goal: "raised of <span>£15,000 GBP</span> goal" or "raised of £15,000 GBP"
    const goalMatch = html.match(/raised of .*?£([\d,]+)\s*GBP/);
    if (goalMatch) stats.goal = parseNumber(goalMatch[1]);

    // Supporters: "2971 supporters" (e.g. <span class="text-rebuild-dark">2971</span> supporters)
    const supportersMatch = html.match(/(\d[\d,]*)\s*supporters/);
    if (supportersMatch)
      stats.supporters = parseNumber(supportersMatch[1]);

    // Days left: "123 days left"
    // Current markup: "... supporters, <span class=\"text-black-400\">123</span> days left"
    let daysMatch =
      html.match(
        /supporters,\s*<span[^>]*>(\d+)<\/span>\s*days\s*left/
      ) || html.match(/(\d+)\s*days\s*left/);
    if (daysMatch) stats.daysLeft = parseNumber(daysMatch[1]);
  } catch (err) {
    console.warn("LaunchGood fetch error:", err.message);
  }

  function write(data) {
    mkdirSync(dirname(OUT_PATH), { recursive: true });
    writeFileSync(OUT_PATH, JSON.stringify(data, null, 2) + "\n", "utf8");
    console.log("Wrote", OUT_PATH, ":", JSON.stringify(data));
  }

  write(stats);
}

main();
