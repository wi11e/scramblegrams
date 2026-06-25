#!/usr/bin/env node
// Auto-generate daily puzzles for a date range.
//
// Usage:
//   node generator/generate-puzzle.js --from YYYY-MM-DD --to YYYY-MM-DD
//   node generator/generate-puzzle.js --from 2026-07-01 --to 2027-06-30 --common-words 15000
//
// Requires generator/english-frequency.txt (one word per line, sorted by frequency).
// Generate it with: python3 -c "from wordfreq import top_n_list; print('\n'.join(top_n_list('en',80000)))" > generator/english-frequency.txt

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir    = dirname(fileURLToPath(import.meta.url));
const ROOT     = resolve(__dir, '..');
const WORDLIST = resolve(ROOT, 'wordlist.txt');
const PUZZLES  = resolve(ROOT, 'puzzles.json');
const FREQ_FILE = resolve(__dir, 'english-frequency.txt');

const POOL_CAP      = 10;   // unclaimed area cap (game rule)
const PUZZLE_SZ     = 40;   // total tiles per puzzle = total solution letters
const MIN_WORD_LEN  = 5;    // minimum solution word length
const SEED_MIN_LEN  = 6;    // minimum seed word length for generation
const MAX_WORDS     = 6;    // 40 - 2*6 = 28 pts; ensures score >= 28
const RICH_THRESH   = 20;   // score a free-play sim must reach to count as "good"
const RICH_MIN_PCT  = 60;   // minimum % of sims that must reach RICH_THRESH
const RICHNESS_SIMS = 200;  // simulations per ordering
const ORDERINGS     = 2000; // tile orderings evaluated per puzzle

// ── Word list loaders ─────────────────────────────────────────────────────────

function loadWordSet() {
  return new Set(readFileSync(WORDLIST, 'utf8').trim().split('\n').map(w => w.trim().toUpperCase()));
}

function loadCommonWords(limit = 15000) {
  if (!existsSync(FREQ_FILE)) {
    console.error(`\n❌  generator/english-frequency.txt not found.\nRun: ./generator/run.sh setup\n`);
    process.exit(1);
  }
  const lines = readFileSync(FREQ_FILE, 'utf8').trim().split('\n');
  const words = new Set();
  for (const line of lines) {
    if (words.size >= limit) break;
    const raw = line.split(/\s+/)[0];
    if (/[-']/.test(raw)) continue;
    const word = raw.toUpperCase();
    if (!/^[A-Z]+$/.test(word)) continue;
    if (word.length < MIN_WORD_LEN) continue;
    words.add(word);
  }
  return words;
}

function loadPuzzles() {
  if (!existsSync(PUZZLES)) return [];
  return JSON.parse(readFileSync(PUZZLES, 'utf8'));
}

// ── Similarity checks ─────────────────────────────────────────────────────────

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => i === 0 ? j : j === 0 ? i : 0)
  );
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  return dp[m][n];
}

function tooSimilar(a, b) {
  if (a.startsWith(b) || b.startsWith(a)) return true;
  return levenshtein(a, b) <= 2;
}

// ── Letter frequency arrays ───────────────────────────────────────────────────

function buildFreq(str) {
  const f = new Uint8Array(26);
  for (const ch of str) {
    const c = ch.charCodeAt(0) - 65;
    if (c >= 0 && c < 26) f[c]++;
  }
  return f;
}

function freqContains(pool, word) {
  for (let i = 0; i < 26; i++) if (word[i] > pool[i]) return false;
  return true;
}

function poolToFreq(pool) {
  return buildFreq(pool.join(''));
}

function removeFromPool(pool, wordFreq) {
  const result = [...pool];
  for (let i = 0; i < 26; i++) {
    let rem = wordFreq[i];
    for (let j = result.length - 1; j >= 0 && rem > 0; j--) {
      if (result[j].charCodeAt(0) - 65 === i) { result.splice(j, 1); rem--; }
    }
  }
  return result;
}

// ── Candidate word builder ────────────────────────────────────────────────────

function buildCandidates(tilePool, commonWordSet, wordSet) {
  const poolFreq = buildFreq(tilePool.join(''));
  const candidates = [];
  for (const word of commonWordSet) {
    if (!wordSet.has(word)) continue;
    if (word.length < 4 || word.length > POOL_CAP) continue;
    const wf = buildFreq(word);
    if (freqContains(poolFreq, wf)) {
      candidates.push({ word, freq: wf, pts: word.length - 2 });
    }
  }
  candidates.sort((a, b) => b.word.length - a.word.length);
  return candidates;
}

function precomputeExtensions(candidates) {
  const exts = new Map();
  for (const shorter of candidates) {
    const list = [];
    for (const longer of candidates) {
      if (longer.word.length <= shorter.word.length) continue;
      if (longer.word.length > shorter.word.length + 5) continue;
      const extras = new Uint8Array(26);
      let valid = true;
      for (let i = 0; i < 26; i++) {
        const d = longer.freq[i] - shorter.freq[i];
        if (d < 0) { valid = false; break; }
        extras[i] = d;
      }
      if (valid) list.push({ to: longer, extras });
    }
    if (list.length) exts.set(shorter.word, list);
  }
  return exts;
}

// ── Seeded RNG ────────────────────────────────────────────────────────────────

function makeRng(seed) {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── Free-play simulation (richness) ──────────────────────────────────────────

function freePlaySim(tileOrder, candidates, extensions, rng) {
  let pool    = [];
  let claimed = [];
  let drawPos = 0;
  let score   = 0;
  const maxSteps = 120;
  let steps = 0;

  while (steps++ < maxSteps) {
    while (pool.length < POOL_CAP && drawPos < tileOrder.length) {
      pool.push(tileOrder[drawPos++]);
    }

    const pf = poolToFreq(pool);
    const options = [];

    for (const c of candidates) {
      if (freqContains(pf, c.freq)) {
        options.push({ scoreGain: c.pts, apply: () => {
          pool = removeFromPool(pool, c.freq);
          claimed.push(c);
          score += c.pts;
        }});
      }
    }

    for (const c of claimed) {
      const extsForWord = extensions.get(c.word);
      if (!extsForWord) continue;
      for (const { to, extras } of extsForWord) {
        if (freqContains(pf, extras)) {
          const gain = to.pts - c.pts;
          options.push({ scoreGain: gain, apply: () => {
            pool = removeFromPool(pool, extras);
            claimed = claimed.filter(x => x !== c);
            claimed.push(to);
            score += gain;
          }});
        }
      }
    }

    if (options.length === 0) {
      if (drawPos >= tileOrder.length) break;
      continue;
    }

    options.sort((a, b) => b.scoreGain - a.scoreGain);
    const pick = options[Math.floor(rng() * Math.min(5, options.length))];
    pick.apply();
  }

  return score;
}

function richnessScore(tileOrder, candidates, extensions, rng) {
  let goodCount = 0;
  for (let i = 0; i < RICHNESS_SIMS; i++) {
    if (freePlaySim(tileOrder, candidates, extensions, rng) >= RICH_THRESH) goodCount++;
  }
  return Math.round((goodCount / RICHNESS_SIMS) * 100);
}

// ── Multiset helpers ──────────────────────────────────────────────────────────

function letterCounts(word) {
  const c = {};
  for (const ch of word) c[ch] = (c[ch] ?? 0) + 1;
  return c;
}

function multisetSubtract(pool, letters) {
  const p = [...pool];
  for (const l of letters) {
    const i = p.indexOf(l);
    if (i === -1) return null;
    p.splice(i, 1);
  }
  return p;
}

function canFormFrom(word, pool) {
  return multisetSubtract([...pool], word.split('')) !== null;
}

function extrasNeeded(existingLetters, targetWord) {
  let pool = [...targetWord.split('')];
  for (const l of existingLetters) {
    const i = pool.indexOf(l);
    if (i === -1) return null;
    pool.splice(i, 1);
  }
  return pool;
}

// ── Achievability verifier ────────────────────────────────────────────────────

function precomputeUsefulIntermediates(targetWords, wordSet, commonWordSet) {
  const useful = new Set();
  for (const target of targetWords) {
    const tLetters = letterCounts(target);
    for (const word of commonWordSet) {
      if (!wordSet.has(word)) continue;
      if (word.length < 4 || word.length >= target.length) continue;
      const wLetters = letterCounts(word);
      let ok = true;
      for (const [ch, n] of Object.entries(wLetters)) {
        if ((tLetters[ch] ?? 0) < n) { ok = false; break; }
      }
      if (ok) useful.add(word);
    }
  }
  return [...useful].sort((a, b) => b.length - a.length);
}

function scoreOrdering(tileOrder, targetWords, usefulIntermediates) {
  const targets    = new Set(targetWords);
  const remaining  = new Set(targetWords);
  let pool         = [];
  let claimed      = [];
  let drawPos      = 0;
  let intermediates = 0;
  const path       = [];
  const maxSteps   = 200;
  let steps        = 0;

  while (remaining.size > 0 && steps++ < maxSteps) {
    const drawFrom = drawPos;
    while (pool.length < POOL_CAP && drawPos < tileOrder.length) pool.push(tileOrder[drawPos++]);
    if (drawPos > drawFrom) path.push({ type: 'draw', tiles: tileOrder.slice(drawFrom, drawPos) });

    let progress = false;

    for (const word of remaining) {
      if (canFormFrom(word, pool)) {
        pool = multisetSubtract(pool, word.split(''));
        claimed.push({ word, letters: word.split('') });
        remaining.delete(word);
        path.push({ type: 'claim', word, pool: `[${pool.join('')}]` });
        progress = true; break;
      }
    }
    if (progress) continue;

    for (const { word: existing, letters: existingLetters } of claimed) {
      if (targets.has(existing)) continue;
      for (const target of remaining) {
        const extras = extrasNeeded(existingLetters, target);
        if (extras && canFormFrom(extras.join(''), pool)) {
          pool = multisetSubtract(pool, extras);
          const idx = claimed.findIndex(c => c.word === existing);
          claimed[idx] = { word: target, letters: target.split('') };
          remaining.delete(target);
          path.push({ type: 'extend', from: existing, to: target, added: extras.join(''), pool: `[${pool.join('')}]` });
          progress = true; break;
        }
      }
      if (progress) break;
    }
    if (progress) continue;

    for (let i = 0; i < claimed.length && !progress; i++) {
      for (let j = i + 1; j < claimed.length && !progress; j++) {
        const combined = [...claimed[i].letters, ...claimed[j].letters];
        for (const target of remaining) {
          const extras = extrasNeeded(combined, target);
          if (extras && canFormFrom(extras.join(''), pool)) {
            pool = multisetSubtract(pool, extras);
            const w1 = claimed[i].word, w2 = claimed[j].word;
            claimed = claimed.filter((_, k) => k !== i && k !== j);
            claimed.push({ word: target, letters: target.split('') });
            remaining.delete(target);
            path.push({ type: 'recombine', from: [w1, w2], to: target, added: extras.join(''), pool: `[${pool.join('')}]` });
            progress = true; break;
          }
        }
      }
    }
    if (progress) continue;

    if (pool.length < POOL_CAP && drawPos < tileOrder.length) continue;

    let claimedInter = false;
    for (const inter of usefulIntermediates) {
      if (canFormFrom(inter, pool)) {
        pool = multisetSubtract(pool, inter.split(''));
        claimed.push({ word: inter, letters: inter.split('') });
        intermediates++;
        path.push({ type: 'intermediate', word: inter, pool: `[${pool.join('')}]` });
        claimedInter = true; break;
      }
    }

    if (!claimedInter) return { reachable: false, intermediates: Infinity, path: [] };
  }

  if (remaining.size > 0) return { reachable: false, intermediates: Infinity, path: [] };
  return { reachable: true, intermediates, path };
}

// ── Word set generator (seed-and-grow) ───────────────────────────────────────
// Builds a set of common words whose letters sum to exactly PUZZLE_SZ.
// All words must also be in the Scrabble dictionary so the player can claim them.

function generateWordSet(commonWordArr, wordSet, usedWords, rng) {
  const validCommon = commonWordArr.filter(w => wordSet.has(w));
  const longWords   = validCommon.filter(w => w.length >= SEED_MIN_LEN);

  for (let attempt = 0; attempt < 500; attempt++) {
    const seed = longWords[Math.floor(rng() * longWords.length)];
    if (usedWords.has(seed)) continue;
    if (seed.length > PUZZLE_SZ - MIN_WORD_LEN) continue;

    const words = [seed];
    let budget = PUZZLE_SZ - seed.length;
    let ok = true;

    while (budget > 0) {
      if (budget < MIN_WORD_LEN) { ok = false; break; }

      // When adding the MAX_WORDS-th word it must fill the budget exactly.
      const mustFill = words.length >= MAX_WORDS - 1;

      const pool = validCommon.filter(w => {
        if (w.length < MIN_WORD_LEN || w.length > budget) return false;
        if (usedWords.has(w) || words.includes(w)) return false;
        if (words.some(e => tooSimilar(e, w))) return false;
        const rem = budget - w.length;
        if (mustFill && rem !== 0) return false;
        // Avoid stranded budgets: remaining must be 0 or >= MIN_WORD_LEN
        if (!mustFill && rem > 0 && rem < MIN_WORD_LEN) return false;
        return true;
      });

      if (pool.length === 0) { ok = false; break; }

      const pick = pool[Math.floor(rng() * pool.length)];
      words.push(pick);
      budget -= pick.length;
    }

    if (ok && budget === 0) return words;
  }

  return null;
}

// ── Single puzzle attempt ─────────────────────────────────────────────────────

function tryGeneratePuzzle(date, commonWordArr, wordSet, commonWords, usedWords) {
  const seed = ((Date.now() + Math.random() * 1e9) ^ 0xDEADBEEF) & 0x7FFFFFFF;
  const rng  = makeRng(seed);

  const words = generateWordSet(commonWordArr, wordSet, usedWords, rng);
  if (!words) return null;

  // Tile pool is exactly the solution letters — no filler.
  const tilePool = words.flatMap(w => w.split(''));

  const candidates   = buildCandidates(tilePool, commonWords, wordSet);
  const extensions   = precomputeExtensions(candidates);
  const usefulInters = precomputeUsefulIntermediates(words, wordSet, commonWords);

  let bestOrdering = null, bestRichness = -1, bestPath = null, bestDiff = Infinity;

  for (let i = 0; i < ORDERINGS; i++) {
    const ordering = shuffle(tilePool, rng);
    const { reachable, intermediates, path } = scoreOrdering(ordering, words, usefulInters);
    if (!reachable) continue;

    const richness = richnessScore(ordering, candidates, extensions, rng);
    if (richness > bestRichness) {
      bestRichness = richness;
      bestOrdering = ordering;
      bestPath     = path;
      bestDiff     = intermediates;
    }
  }

  if (!bestOrdering || bestRichness < RICH_MIN_PCT) return null;

  return {
    date,
    tiles:      bestOrdering,
    solution:   words,
    difficulty: bestDiff,
    richness:   bestRichness,
    path:       bestPath,
  };
}

// ── Date range helpers ────────────────────────────────────────────────────────

function getDatesInRange(from, to) {
  const dates = [];
  const end = new Date(to + 'T00:00:00Z');
  for (let d = new Date(from + 'T00:00:00Z'); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args[0] === '--help') {
    console.log('Usage: node generator/generate-puzzle.js --from YYYY-MM-DD --to YYYY-MM-DD [--common-words N]');
    process.exit(0);
  }

  let fromDate    = null;
  let toDate      = null;
  let commonLimit = 15000;

  for (let i = 0; i < args.length; i++) {
    if      (args[i] === '--from')         fromDate    = args[++i];
    else if (args[i] === '--to')           toDate      = args[++i];
    else if (args[i] === '--common-words') commonLimit = parseInt(args[++i]);
  }

  if (!fromDate || !toDate) {
    console.error('❌  --from and --to are required');
    process.exit(1);
  }

  console.log('\n🔤  Loading word lists…');
  const wordSet       = loadWordSet();
  const commonWords   = loadCommonWords(commonLimit);
  const commonWordArr = [...commonWords];
  console.log(`✅  ${wordSet.size.toLocaleString()} Scrabble words, ${commonWords.size.toLocaleString()} common words\n`);

  let puzzles = loadPuzzles();
  const existingDates = new Set(puzzles.map(p => p.date));
  const usedWords = new Set(
    puzzles.flatMap(p => (p.solution ?? []).map(w => w.toUpperCase()))
  );

  const dates      = getDatesInRange(fromDate, toDate);
  const toGenerate = dates.filter(d => !existingDates.has(d));
  console.log(`📅  ${fromDate} → ${toDate}  (${dates.length} days, ${toGenerate.length} to generate)\n`);

  let generated = 0;
  for (const date of dates) {
    if (existingDates.has(date)) {
      console.log(`⏭️   ${date} — skipped (already exists)`);
      continue;
    }

    let puzzle   = null;
    let attempts = 0;
    process.stdout.write(`🔄  ${date} — searching…`);

    while (!puzzle) {
      attempts++;
      puzzle = tryGeneratePuzzle(date, commonWordArr, wordSet, commonWords, usedWords);
      if (!puzzle && attempts % 20 === 0) {
        process.stdout.write(`\r🔄  ${date} — attempt ${attempts}…          `);
      }
    }

    for (const w of puzzle.solution) usedWords.add(w);
    puzzles.push(puzzle);
    puzzles.sort((a, b) => a.date.localeCompare(b.date));
    writeFileSync(PUZZLES, JSON.stringify(puzzles, null, 2));

    const score = puzzle.solution.reduce((s, w) => s + w.length - 2, 0);
    console.log(
      `\r✅  ${date} — ${puzzle.solution.join(' + ')} ` +
      `(${score} pts, ${puzzle.richness}% richness, diff ${puzzle.difficulty}) ` +
      `[${attempts} attempt${attempts > 1 ? 's' : ''}]`
    );
    generated++;
  }

  console.log(`\n🎉  Done — ${generated} puzzle${generated !== 1 ? 's' : ''} generated.\n`);
}

main().catch(e => { console.error(e); process.exit(1); });
