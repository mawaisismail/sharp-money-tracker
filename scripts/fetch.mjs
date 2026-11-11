// Pulls exchange liquidity (Kalshi) + sportsbook consensus (DraftKings via ESPN)
// and writes public/data.json. Runs in GitHub Actions on a cron, or locally: `node scripts/fetch.mjs`
import { writeFile } from "node:fs/promises";

const KALSHI = "https://api.elections.kalshi.com/trade-api/v2";
const SPORTS = [
  { key: "NBA", series: "KXNBAGAME", espn: "basketball/nba" },
  { key: "NFL", series: "KXNFLGAME", espn: "football/nfl" },
  { key: "NHL", series: "KXNHLGAME", espn: "hockey/nhl" },
  { key: "NCAAF", series: "KXNCAAFGAME", espn: "football/college-football" },
  { key: "NCAAB", series: "KXNCAAMBGAME", espn: "basketball/mens-college-basketball" },
];
const HORIZON_H = 48;

const j = async (url) => {
  const r = await fetch(url, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
};
const num = (v) => (v == null || v === "" ? 0 : Number(v));
const norm = (s) => (s || "").toLowerCase().replace(/[^a-z]/g, "");
const mlToProb = (ml) => {
  const n = Number(String(ml).replace("+", ""));
  if (!n || Number.isNaN(n)) return null;
  return n < 0 ? -n / (-n + 100) : 100 / (n + 100);
};

async function kalshiMarkets(series) {
  const out = [];
  let cursor = "";
  for (let i = 0; i < 10; i++) {
    const d = await j(`${KALSHI}/markets?series_ticker=${series}&status=open&limit=1000${cursor ? `&cursor=${cursor}` : ""}`);
    out.push(...d.markets);
    if (!d.cursor || d.markets.length === 0) break;
    cursor = d.cursor;
  }
  return out;
}

async function espnOdds(path) {
  try {
    const d = await j(`https://site.api.espn.com/apis/site/v2/sports/${path}/scoreboard`);
    return d.events.map((e) => {
      const c = e.competitions[0];
      const o = (c.odds || [])[0] || {};
      const teams = {};
      for (const t of c.competitors) {
        const ml = o.moneyline?.[t.homeAway]?.close?.odds ?? o.moneyline?.[t.homeAway]?.open?.odds;
        teams[t.homeAway] = { name: t.team.location, abbr: t.team.abbreviation, ml };
      }
      // de-vig the two-way moneyline
      const ph = mlToProb(teams.home?.ml), pa = mlToProb(teams.away?.ml);
      if (ph && pa) { teams.home.p = ph / (ph + pa); teams.away.p = pa / (ph + pa); }
      return { date: e.date, book: o.provider?.name, spread: o.details, teams };
    });
  } catch { return []; }
}

const now = Date.now();
const games = [];
for (const s of SPORTS) {
  const [markets, odds] = await Promise.all([kalshiMarkets(s.series).catch(() => []), espnOdds(s.espn)]);
  const byEvent = new Map();
  for (const m of markets) {
    const t = Date.parse(m.occurrence_datetime || m.expected_expiration_time);
    if (!(t > now - 3 * 3600e3 && t < now + HORIZON_H * 3600e3)) continue;
    if (!byEvent.has(m.event_ticker)) byEvent.set(m.event_ticker, { start: t, sides: [] });
    const mid = (num(m.yes_bid_dollars) + num(m.yes_ask_dollars)) / 2 || num(m.last_price_dollars);
    byEvent.get(m.event_ticker).sides.push({
      team: m.yes_sub_title,
      exProb: mid,
      // Kalshi contracts settle at $1, so dollars traded ≈ contracts × price
      vol24: num(m.volume_24h_fp) * mid,
      volTotal: num(m.volume_fp) * mid,
      oi: num(m.open_interest_fp) * mid,
      depth: num(m.yes_bid_size_fp) * num(m.yes_bid_dollars) + num(m.yes_ask_size_fp) * num(m.yes_ask_dollars),
    });
  }
  for (const [ticker, g] of byEvent) {
    if (g.sides.length < 2) continue;
    const match = odds.find((o) => g.sides.every((sd) => Object.values(o.teams).some((t) => norm(t.name) && (norm(sd.team).startsWith(norm(t.name)) || norm(t.name).startsWith(norm(sd.team))))));
    for (const sd of g.sides) {
      const t = match && Object.values(match.teams).find((t) => norm(sd.team).startsWith(norm(t.name)) || norm(t.name).startsWith(norm(sd.team)));
      sd.bookProb = t?.p ?? null;
      sd.bookML = t?.ml ?? null;
    }
    const total = g.sides.reduce((a, b) => a + b.volTotal, 0) || 1;
    for (const sd of g.sides) sd.moneyShare = sd.volTotal / total;
    games.push({ sport: s.key, ticker, start: new Date(g.start).toISOString(), book: match?.book ?? null, spread: match?.spread ?? null, sides: g.sides });
  }
}

games.sort((a, b) => b.sides.reduce((x, y) => x + y.volTotal, 0) - a.sides.reduce((x, y) => x + y.volTotal, 0));
await writeFile(new URL("../public/data.json", import.meta.url), JSON.stringify({ updated: new Date().toISOString(), games }, null, 0));
console.log(`wrote ${games.length} games`);
