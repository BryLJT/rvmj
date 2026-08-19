# RVMJ

A web app for recording mahjong games and keeping a permanent leaderboard.

NFC stickers sit on the four sides of a mahjong table. Players tap their seat, which
opens the app and assigns them that seat. Four taps form a game. Lifetime results
accumulate per Google account.

**Live:** https://rvmj.vercel.app

## Why it exists

Mahjong scores get tracked on paper or not at all, so nobody knows who is actually
up over months of play.

## Two ways to score a game

**Chip mode** (the default) is for tables that settle with physical chips. The app
stays quiet during play. At the end, each player's chips are counted by denomination,
the app checks the counts conserve, all four confirm, and the result is recorded.

**App mode** records each hand as it happens. The server calculates every point
movement from the house rules in force for that game, so players never type totals.

Both modes produce four final scores that sum to zero, which is what makes the
leaderboard trustworthy: an inflated claim requires three people to claim the
matching losses.

## Design notes

- **Points, not currency.** What a point is worth stays a private arrangement.
- **Rules are copied onto each game, not referenced.** A game from March is scored
  by March's rules forever.
- **Movements are stored, not recomputed.** Fixing the scoring engine never rewrites
  leaderboard history.
- **NFC is convenience, not security.** A static tag cannot prevent URL access.
  Authorisation is enforced server-side; tag verification is isolated so a
  cryptographic tag can be dropped in later.

Full design: `docs/superpowers/specs/`

## Stack

Next.js on Vercel · Supabase for database, Google auth, and realtime · NTAG213 stickers

## Running locally

```bash
npm install
cp .env.example .env.local   # then fill in your own Supabase values
npm run dev
```

Database schema lives in `supabase/migrations/` and is applied with the Supabase CLI.
