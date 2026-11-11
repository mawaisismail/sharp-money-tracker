# Sharp Money Tracker (demo)

Shows where the **sharp money** sits on tonight's games by comparing exchange liquidity (Kalshi) against sportsbook consensus (DraftKings, de-vigged).

- **Exchange $ / 24h $**: matched dollars on each side
- **Money share**: share of the game's exchange money on that side
- **Edge**: exchange-implied probability minus book-implied probability
- Flags: 🔥 heavy money above your $ bar · ⚠️ line gap between exchange and book · 🔄 money share running ahead of price
- A GitHub Actions cron refreshes the data every 15 minutes, and GitHub Pages serves it

Stack: Node fetch script, static HTML/JS, GitHub Actions, Pages. Ports directly into a Next.js + Supabase + Vercel app (fetch script becomes a cron route that writes to Supabase).
