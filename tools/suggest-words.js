#!/usr/bin/env node
// Suggest target word sets for daily puzzles.
// Finds combinations of commonly-used words totalling 32-40 letters
// with enough letter overlap to enable extend/recombine chains.
//
// Usage:
//   node tools/suggest-words.js
//   node tools/suggest-words.js --count 4 --top 20

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir    = dirname(fileURLToPath(import.meta.url));
const ROOT     = resolve(__dir, '..');
const WORDLIST = resolve(ROOT, 'wordlist.txt');
const FREQ_FILE = resolve(__dir, 'english-frequency.txt');

function loadCommonWords(limit = 15000) {
  if (!existsSync(FREQ_FILE)) {
    console.error('❌  tools/english-frequency.txt not found. Run: ./tools/run.sh setup');
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
    if (word.length < 4) continue;
    words.add(word);
  }
  return words;
}

function canExtendInto(shorter, longer) {
  // Can shorter be extended into longer by adding 1-5 pool letters?
  const pool = [...longer];
  for (const l of shorter) {
    const i = pool.indexOf(l);
    if (i === -1) return false;
    pool.splice(i, 1);
  }
  const extras = pool.length;
  return extras >= 1 && extras <= 5;
}

function chainScore(words) {
  let score = 0;
  for (let i = 0; i < words.length; i++)
    for (let j = 0; j < words.length; j++)
      if (i !== j && canExtendInto(words[i], words[j])) score++;
  return score;
}

function sharedLetterCount(a, b) {
  const setA = new Set(a);
  return [...b].filter(l => setA.has(l)).length;
}

// ── Greedy builder ────────────────────────────────────────────────────────────
// Start with a long word, greedily add words that share letters with the set.

function buildCombination(seed, candidates, targetCount, minLetters, maxLetters, rng) {
  const words = [seed];
  let letters = seed.length;

  for (let attempt = 0; attempt < 200 && words.length < targetCount; attempt++) {
    // Pick a random candidate that shares letters with any word in the set
    const idx = Math.floor(rng() * candidates.length);
    const word = candidates[idx];
    if (words.includes(word)) continue;

    const newLetters = letters + word.length;
    if (newLetters > maxLetters) continue;

    const sharing = words.some(w => sharedLetterCount(w, word) >= 2);
    if (!sharing) continue;

    words.push(word);
    letters = newLetters;
  }

  if (words.length < targetCount) return null;
  if (letters < minLetters || letters > maxLetters) return null;
  if (chainScore(words) === 0) return null;

  return { words, total: letters, chains: chainScore(words) };
}

// Mulberry32 seeded RNG
function makeRng(seed) {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

const args      = process.argv.slice(2);
let wordCount   = 4;   // 4 words × avg 8 letters = 32 letters
let minLetters  = 32;
let maxLetters  = 40;
let topN        = 20;
let tries       = 50000;

let commonLimit = 15000;
let plainN      = 0; // if >0, output N bare word lines (for piping) and suppress all other output

for (let i = 0; i < args.length; i++) {
  if      (args[i] === '--count')        wordCount    = parseInt(args[++i]);
  else if (args[i] === '--min-letters')  minLetters   = parseInt(args[++i]);
  else if (args[i] === '--max-letters')  maxLetters   = parseInt(args[++i]);
  else if (args[i] === '--top')          topN         = parseInt(args[++i]);
  else if (args[i] === '--tries')        tries        = parseInt(args[++i]);
  else if (args[i] === '--common-words') commonLimit  = parseInt(args[++i]);
  else if (args[i] === '--plain')        plainN       = parseInt(args[++i]);
}

// In plain mode suppress all logging so output can be piped
const log = plainN > 0 ? () => {} : (...a) => console.log(...a);

log('\n🔤  Loading word lists…');
const scrabbleWords = new Set(readFileSync(WORDLIST, 'utf8').trim().split('\n').map(w => w.trim().toUpperCase()));
const commonWordSet = loadCommonWords(commonLimit);
const commonWords   = [...commonWordSet].filter(w => scrabbleWords.has(w) && w.length >= 5 && w.length <= 9);
log(`✅  ${commonWords.length.toLocaleString()} words (top 15k common ∩ Scrabble dictionary, 5–9 letters)`);
log(`🔍  Building ${wordCount}-word sets with ${minLetters}–${maxLetters} total letters…\n`);

// Use longer words as seeds (8-9 letters hit the letter count faster)
const longWords = commonWords.filter(w => w.length >= 7);
const rng       = makeRng(0xCAFEBABE);
const seen      = new Set();
const results   = [];

for (let i = 0; i < tries && results.length < topN * 10; i++) {
  const seed = longWords[Math.floor(rng() * longWords.length)];
  const combo = buildCombination(seed, commonWords, wordCount, minLetters, maxLetters, rng);
  if (!combo) continue;

  const key = combo.words.slice().sort().join('|');
  if (seen.has(key)) continue;
  seen.add(key);

  results.push(combo);
}

if (results.length === 0) {
  log('No combinations found. Try --count 5 or widening the letter range.');
  process.exit(0);
}

results.sort((a, b) => b.chains - a.chains || b.total - a.total);

// ── Plain mode: output bare word sets for piping ──────────────────────────────
if (plainN > 0) {
  const out = results.slice(0, plainN);
  for (const { words } of out) process.stdout.write(words.join(' ') + '\n');
  process.exit(0);
}

// ── Interactive mode: formatted table ────────────────────────────────────────
const top = results.slice(0, topN);

console.log(`Found ${results.length.toLocaleString()} combinations. Top ${top.length}:\n`);
console.log('  #  Words                                          Letters  Chains');
console.log('  ──────────────────────────────────────────────────────────────────');

for (let i = 0; i < top.length; i++) {
  const { words, total, chains } = top[i];
  const wordStr = words.join(' + ').padEnd(46);
  console.log(`  ${String(i + 1).padStart(2)}  ${wordStr}  ${String(total).padStart(7)}  ${chains}`);
}

console.log('\nTo generate a puzzle from one of these:');
console.log(`  node tools/generate-puzzle.js ${top[0]?.words.join(' ') ?? 'WORD1 WORD2 ...'}\n`);
