#!/usr/bin/env node
// Generate a daily puzzle from a set of target words.
//
// Usage:
//   node tools/generate-puzzle.js WORD1 WORD2 WORD3 WORD4
//   node tools/generate-puzzle.js WORD1 WORD2 WORD3 WORD4 --date 2026-06-30 --difficulty 2
//   node tools/generate-puzzle.js WORD1 WORD2 WORD3 WORD4 --common-words 5000
//
// Requires tools/english-frequency.txt (one word per line, sorted by frequency).
// Generate it with: python3 -c "from wordfreq import top_n_list; print('\n'.join(top_n_list('en',80000)))" > tools/english-frequency.txt

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import * as readline from 'readline/promises';

const __dir    = dirname(fileURLToPath(import.meta.url));
const ROOT     = resolve(__dir, '..');
const WORDLIST = resolve(ROOT, 'wordlist.txt');
const PUZZLES  = resolve(ROOT, 'puzzles.json');
const FREQ_FILE = resolve(__dir, 'english-frequency.txt');

const POOL_CAP      = 10;
const PUZZLE_SZ     = 40;
const MIN_RATIO     = 0.8;
const RICHNESS_SIMS = 200;   // free-play simulations per ordering
const RICH_THRESH   = 15;    // score considered "good"
const ORDERINGS     = 2000;  // orderings to test

const TILE_DIST = {
  A:13,B:3,C:3,D:6,E:18,F:3,G:4,H:3,I:12,J:2,K:2,
  L:5,M:3,N:8,O:11,P:3,Q:2,R:9,S:6,T:9,U:6,V:3,W:3,X:2,Y:3,Z:2,
};

// ── Word list loaders ─────────────────────────────────────────────────────────

function loadWordSet() {
  return new Set(readFileSync(WORDLIST, 'utf8').trim().split('\n').map(w => w.trim().toUpperCase()));
}

function loadCommonWords(limit = 15000) {
  if (!existsSync(FREQ_FILE)) {
    console.error(`\n❌  tools/english-frequency.txt not found.\nRun: ./tools/run.sh setup\n`);
    process.exit(1);
  }
  const lines = readFileSync(FREQ_FILE, 'utf8').trim().split('\n');
  const words = new Set();
  for (const line of lines) {
    if (words.size >= limit) break;
    const raw = line.split(/\s+/)[0]; // first token (handles "word count" format)
    if (/[-']/.test(raw)) continue;   // skip hyphenated and apostrophe words
    const word = raw.toUpperCase();
    if (!/^[A-Z]+$/.test(word)) continue; // skip anything with remaining non-letters
    if (word.length < 4) continue;
    words.add(word);
  }
  return words;
}

// ── Letter frequency arrays (fast multiset ops) ───────────────────────────────

function buildFreq(str) {
  const f = new Uint8Array(26);
  for (const ch of str) {
    const c = ch.charCodeAt(0) - 65;
    if (c >= 0 && c < 26) f[c]++;
  }
  return f;
}

function freqContains(pool, word) {
  // Returns true if pool's letter counts ≥ word's letter counts
  for (let i = 0; i < 26; i++) if (word[i] > pool[i]) return false;
  return true;
}

function freqSubtract(pool, word) {
  // Returns new freq array: pool − word (assumes freqContains is true)
  const r = new Uint8Array(pool);
  for (let i = 0; i < 26; i++) r[i] -= word[i];
  return r;
}

function freqAdd(a, b) {
  const r = new Uint8Array(26);
  for (let i = 0; i < 26; i++) r[i] = a[i] + b[i];
  return r;
}

function poolToFreq(pool) {
  return buildFreq(pool.join(''));
}

function removeFromPool(pool, wordFreq) {
  // Remove letters matching wordFreq from pool array, return new pool
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
  // Prefilter: common words formable from ANY subset of the tile pool (i.e. letters exist in pool)
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
  // For each shorter word, list longer words reachable by adding pool letters
  const exts = new Map();
  for (const shorter of candidates) {
    const list = [];
    for (const longer of candidates) {
      if (longer.word.length <= shorter.word.length) continue;
      if (longer.word.length > shorter.word.length + 5) continue;
      // extras = longer.freq − shorter.freq (must be non-negative)
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
// Simulates a player who knows no target words, only common words.
// Picks randomly from the top-5 scoring options at each step.

function freePlaySim(tileOrder, candidates, extensions, rng) {
  let pool    = [];
  let claimed = []; // { word, freq, pts }
  let drawPos = 0;
  let score   = 0;
  const maxSteps = 120;
  let steps = 0;

  while (steps++ < maxSteps) {
    // Auto-fill pool
    while (pool.length < POOL_CAP && drawPos < tileOrder.length) {
      pool.push(tileOrder[drawPos++]);
    }

    const pf = poolToFreq(pool);
    const options = []; // { type, scoreGain, apply() }

    // Option type 1: claim a word directly from pool
    for (const c of candidates) {
      if (freqContains(pf, c.freq)) {
        options.push({ scoreGain: c.pts, apply: () => {
          pool = removeFromPool(pool, c.freq);
          claimed.push(c);
          score += c.pts;
        }});
      }
    }

    // Option type 2: extend a claimed word using pool letters
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
      // No moves — if bag empty and stuck, done
      if (drawPos >= tileOrder.length) break;
      // Otherwise wait for more tiles (pool isn't full yet)
      continue;
    }

    // Sort by score gain, pick randomly from top 5
    options.sort((a, b) => b.scoreGain - a.scoreGain);
    const pick = options[Math.floor(rng() * Math.min(5, options.length))];
    pick.apply();
  }

  return score;
}

function richnessScore(tileOrder, candidates, extensions, rng) {
  let goodCount = 0;
  for (let i = 0; i < RICHNESS_SIMS; i++) {
    const s = freePlaySim(tileOrder, candidates, extensions, rng);
    if (s >= RICH_THRESH) goodCount++;
  }
  return Math.round((goodCount / RICHNESS_SIMS) * 100); // % of sims scoring ≥ threshold
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

// ── Difficulty verifier ───────────────────────────────────────────────────────
// Knows the target words. Greedy simulation. Only uses common words as intermediates.

function precomputeUsefulIntermediates(targetWords, wordSet, commonWordSet) {
  const useful = new Set();
  for (const target of targetWords) {
    const tLetters = letterCounts(target);
    for (const word of commonWordSet) {       // ← common words only
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

    // 1. Claim target directly
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

    // 2. Extend claimed → target
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

    // 3. Recombine two claimed → target
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

    // Stuck — need a common-word intermediate
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

// ── Tile pool builder ─────────────────────────────────────────────────────────

function buildTilePool(targetWords) {
  const solutionLetters = targetWords.flatMap(w => w.split(''));
  const M = solutionLetters.length;
  if (M > PUZZLE_SZ) throw new Error(`Solution uses ${M} letters — exceeds ${PUZZLE_SZ}`);
  const minSolution = Math.ceil(PUZZLE_SZ * MIN_RATIO);
  if (M < minSolution) throw new Error(`Solution uses ${M} letters — need ≥${minSolution} (80% of ${PUZZLE_SZ}). Add more target words.`);

  const fillerBag = [];
  for (const [letter, count] of Object.entries(TILE_DIST))
    for (let i = 0; i < count; i++) fillerBag.push(letter);

  const rng = makeRng(Date.now() & 0xFFFFFF);
  const filler = shuffle(fillerBag, rng).slice(0, PUZZLE_SZ - M);
  return [...solutionLetters, ...filler];
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args[0] === '--help') {
    console.log('Usage: node tools/generate-puzzle.js WORD1 WORD2 ... [--date YYYY-MM-DD] [--difficulty N] [--common-words N]');
    process.exit(0);
  }

  const words = [];
  let targetDate    = new Date().toISOString().slice(0, 10);
  let targetDiff    = null;
  let commonLimit   = 15000;

  for (let i = 0; i < args.length; i++) {
    if      (args[i] === '--date')         targetDate  = args[++i];
    else if (args[i] === '--difficulty')   targetDiff  = parseInt(args[++i]);
    else if (args[i] === '--common-words') commonLimit = parseInt(args[++i]);
    else                                   words.push(args[i].toUpperCase());
  }

  if (!words.length) { console.error('No target words provided.'); process.exit(1); }

  console.log('\n🔤  Loading word lists…');
  const wordSet      = loadWordSet();
  const commonWords  = loadCommonWords(commonLimit);
  console.log(`✅  ${wordSet.size.toLocaleString()} Scrabble words, ${commonWords.size.toLocaleString()} common words (top ${commonLimit.toLocaleString()})`);

  for (const w of words) {
    if (w.length < 4)        { console.error(`❌  "${w}" too short`); process.exit(1); }
    if (!wordSet.has(w))     { console.error(`❌  "${w}" not in dictionary`); process.exit(1); }
  }

  console.log(`✅  Target words: ${words.join(', ')}`);
  console.log(`📅  Date: ${targetDate}`);

  let tilePool;
  try { tilePool = buildTilePool(words); }
  catch (e) { console.error(`❌  ${e.message}`); process.exit(1); }

  const solutionLetterCount = words.flatMap(w => w.split('')).length;
  console.log(`🎯  Tile pool: ${tilePool.length} tiles (${solutionLetterCount} solution, ${tilePool.length - solutionLetterCount} filler)`);

  console.log('🔗  Precomputing word candidates and extensions…');
  const candidates   = buildCandidates(tilePool, commonWords, wordSet);
  const extensions   = precomputeExtensions(candidates);
  const usefulInters = precomputeUsefulIntermediates(words, wordSet, commonWords);
  console.log(`   ${candidates.length} common words reachable from this pool, ${usefulInters.length} valid intermediates`);

  const targetScore = words.reduce((s, w) => s + w.length - 2, 0);
  console.log(`🏆  Target solution score: ${targetScore} pts  (richness threshold: ≥${RICH_THRESH} pts)\n`);
  console.log(`⚙️   Testing ${ORDERINGS.toLocaleString()} orderings (${RICHNESS_SIMS} richness sims each)…\n`);

  // { difficulty → [{ ordering, path, richness }] }
  const buckets = {};
  const rng     = makeRng((Date.now() ^ 0xDEADBEEF) & 0x7FFFFFFF);
  let reachable = 0;

  for (let i = 0; i < ORDERINGS; i++) {
    const ordering = shuffle(tilePool, rng);
    const { reachable: ok, intermediates, path } = scoreOrdering(ordering, words, usefulInters);

    if (ok) {
      reachable++;
      const richness = richnessScore(ordering, candidates, extensions, rng);
      if (!buckets[intermediates]) buckets[intermediates] = [];
      if (buckets[intermediates].length < 5)
        buckets[intermediates].push({ ordering, path, richness });
    }

    if ((i + 1) % 250 === 0)
      process.stdout.write(`   ${i + 1}/${ORDERINGS} (${reachable} reachable)\r`);
  }

  console.log(`\n✅  ${reachable}/${ORDERINGS} orderings reachable\n`);

  if (!reachable) {
    console.error('❌  No reachable orderings found. Try different words or add --common-words 20000');
    process.exit(1);
  }

  // Display results table
  const difficulties = Object.keys(buckets).map(Number).sort((a, b) => a - b);
  const DIFF_LABEL   = { 0:'Trivial', 1:'Easy', 2:'Medium', 3:'Hard', 4:'Very hard' };

  console.log('📊  Results (pick a row):\n');
  console.log('  Diff  Label        Options   Best richness (% sims ≥ ' + RICH_THRESH + ' pts)');
  console.log('  ────────────────────────────────────────────────────────');
  for (const diff of difficulties) {
    const entries  = buckets[diff];
    const label    = DIFF_LABEL[diff] ?? 'Very hard';
    const best     = Math.max(...entries.map(e => e.richness));
    console.log(`  [${diff}]   ${label.padEnd(12)} ${String(entries.length).padEnd(9)} ${best}%`);
  }

  // Pick difficulty
  let chosenDiff = targetDiff;
  if (chosenDiff === null) {
    const rl     = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question('\nEnter difficulty level: ');
    rl.close();
    chosenDiff = parseInt(answer.trim());
  }

  if (!buckets[chosenDiff]) {
    console.error(`❌  No ordering at difficulty ${chosenDiff}`);
    process.exit(1);
  }

  // Pick the option with highest richness at chosen difficulty
  const best = buckets[chosenDiff].sort((a, b) => b.richness - a.richness)[0];

  // Display solution path
  console.log('\n🗺️   Solution path:\n');
  let step = 1;
  for (const s of best.path) {
    if      (s.type === 'draw')         console.log(`      draw → [${s.tiles.join('')}]`);
    else if (s.type === 'claim')        console.log(`  ${step++}.  CLAIM        ${s.word}  (pool: ${s.pool})`);
    else if (s.type === 'intermediate') console.log(`  ${step++}.  intermediate ${s.word}  (pool: ${s.pool})`);
    else if (s.type === 'extend')       console.log(`  ${step++}.  EXTEND       ${s.from} +[${s.added}]→ ${s.to}  (pool: ${s.pool})`);
    else if (s.type === 'recombine')    console.log(`  ${step++}.  RECOMBINE    ${s.from.join('+')} +[${s.added}]→ ${s.to}  (pool: ${s.pool})`);
  }

  const puzzle = {
    date:       targetDate,
    tiles:      best.ordering,
    solution:   words,
    difficulty: chosenDiff,
    richness:   best.richness,
  };

  console.log(`\n🧩  Puzzle:`);
  console.log(`   Date:       ${puzzle.date}`);
  console.log(`   Tiles:      ${puzzle.tiles.join('')}`);
  console.log(`   Solution:   ${puzzle.solution.join(' + ')}  (${targetScore} pts)`);
  console.log(`   Difficulty: ${chosenDiff} intermediates`);
  console.log(`   Richness:   ${best.richness}% of random sims scored ≥${RICH_THRESH} pts`);

  let puzzles = [];
  if (existsSync(PUZZLES)) puzzles = JSON.parse(readFileSync(PUZZLES, 'utf8'));

  const existing = puzzles.findIndex(p => p.date === targetDate);
  if (existing >= 0) { console.log(`\n⚠️   Replacing existing puzzle for ${targetDate}`); puzzles[existing] = puzzle; }
  else { puzzles.push(puzzle); puzzles.sort((a, b) => a.date.localeCompare(b.date)); }

  writeFileSync(PUZZLES, JSON.stringify(puzzles, null, 2));
  console.log(`\n✅  Saved to puzzles.json\n`);
}

main().catch(e => { console.error(e); process.exit(1); });
