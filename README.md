# Scramblegrams

A word-building puzzle game inspired by Bananagrams. Draw tiles, build words, and chain them together for the highest score.

**Play at [scramblegrams.pages.dev](https://scramblegrams.pages.dev)**

---

## How to play

### Setup

On your first game you'll be asked to enter a name and pick a country flag. This is used for the leaderboard.

### Choose a mode

| Mode | Time limit |
|------|-----------|
| Classical | Untimed — timer counts up |
| Bullet | 60 seconds |
| Blitz | 3 minutes |
| Rapid | 10 minutes |

### Drawing tiles

Press **New letter** to draw a tile from the bag into your pool. You can hold up to 10 unclaimed tiles at once.

### Claiming a word

Tap tiles from the pool to move them into the tray at the bottom. Once you have 4 or more letters that form a valid word (Scrabble dictionary), press **Claim** to lock it in as a scored word. Words must be at least 4 letters.

### Extending a word

Tap a word you've already claimed — its tiles move to the tray. Add new tiles from the pool and claim again. The new word must contain all the original letters plus at least one new one.

### Anagramming a word

Tap a claimed word into the tray, rearrange the tiles into a different valid word using the exact same letters, and claim it. No new tiles needed — useful for unlocking better chains.

### Recombining words

Tap two or more claimed words into the tray. You can also add extra tiles from unclaimed. Claim a new word that uses all those letters (plus any extras). The source words are dissolved and replaced by the new one.

### Scoring

Each word scores **word length − 2** points:

| Word length | Points |
|-------------|--------|
| 4 letters | 2 pts |
| 5 letters | 3 pts |
| 6 letters | 4 pts |
| 7 letters | 5 pts |
| … | … |

Your total score is the sum across all your claimed words.

### Ending the game

Press **Done** at any time to end the game and submit your score. In timed modes the game ends automatically when the clock hits zero. Your score is submitted to the leaderboard and you'll see your rank.

---

## Leaderboard

The leaderboard is global and tracked separately per mode. Tap the trophy icon on the home screen to browse scores. Your entry is highlighted when you're viewing your own rank.

---

## Setup (for contributors)

See [wrangler.toml](wrangler.toml) for the Cloudflare Pages + D1 configuration. To run locally:

```bash
npx wrangler pages dev .
```

To create and migrate the database:

```bash
npx wrangler d1 create scramblegrams-db
# paste the database_id into wrangler.toml, then:
npx wrangler d1 execute scramblegrams-db --remote --file=migrations/0001_initial.sql
npx wrangler pages deploy .
```
