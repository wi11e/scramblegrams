# Feature: Word Definitions

Show a definition for any valid tray word or banked word.

## Triggers

Three entry points, all open the same modal:

1. **Word board** — a `?` button on each banked word chip during gameplay
2. **Result screen** — a `?` button on each word in the post-game word list
3. **Tray** — a "Define" button appears alongside the claim button when the current tray word is valid (`tray.length >= 4 && isValidWord(word)`)

## Modal

Bottom sheet, consistent with the existing stats/leaderboard modals.

Content:
- Word as header
- One definition beneath it
- If the word isn't found: "No definition found."
- If the fetch fails: treat same as not found

No phonetics, part of speech, examples, or multiple definitions.

## Data / API

**Backend** — new endpoint following the pattern in `functions/`:
```
GET /api/define/:word
```
Proxies to the [Free Dictionary API](https://api.dictionaryapi.dev/api/v2/entries/en/:word). Extracts the first definition from the response and returns `{ definition: "..." }` or `{ definition: null }` if not found.

**Client** — new export in `js/api.js`:
```js
export async function fetchDefinition(word) { ... }
```
Follows the same fetch pattern as `fetchLeaderboard` and `fetchPlayerCount`.

**Cache** — a module-level `Map` in `js/app.js` keyed by lowercased word. Populated on first lookup, reused for subsequent ones. Cleared when the page closes (no persistence needed).

```js
const definitionCache = new Map();

async function lookupDefinition(word) {
  const key = word.toLowerCase();
  if (definitionCache.has(key)) return definitionCache.get(key);
  const result = await fetchDefinition(key);
  definitionCache.set(key, result);
  return result;
}
```

## Files to touch

| File | Change |
|---|---|
| `functions/api/define/[word].js` | New backend endpoint (proxy to Free Dictionary API) |
| `js/api.js` | Add `fetchDefinition(word)` |
| `js/app.js` | Add `definitionCache`, `lookupDefinition()`, wire up `?` buttons and tray define button, add modal open/close logic |
| `js/elements.js` | Add `?` button to `bg-word-board` word chip template |
| `index.html` | Add definition modal markup (word header + definition body + close button) |
| `style.css` | Style the definition modal and `?` buttons |

## Key existing code to know

- `isValidWord(word)` — imported from `js/wordlist.js`, used at `app.js:452` to gate the tray claim button. Same gate for the define button.
- `bg-word-board` custom element in `js/elements.js` renders banked word chips — `?` button goes here.
- `word-tap` event (fired by `bg-word-board`) currently moves a word into the tray — the `?` button needs `stopPropagation()` so it doesn't also trigger that.
- Result screen word list is rendered via `innerHTML` at `app.js:410–413` — `?` buttons get injected there and delegate up to a click handler on the container.
- Existing modal pattern to follow: `stats-modal` in `index.html` and its open/close wiring in `app.js`.
