import { createBag, shuffleBag } from './tiles.js';
import { isValidWord } from './wordlist.js';

export const TIME_LIMITS = { bullet: 60, blitz: 180, rapid: 600 };
const UNCLAIMED_CAP = 10;
const MIN_WORD_LEN = 4;

// Random IDs survive across page reloads without colliding with restored saves
function makeWordId() { return 'w' + crypto.randomUUID().slice(0, 8); }

export class ScramblergramsGame {
  constructor(mode = 'classical', bag = null) {
    this.mode = mode;
    this.bag = bag ?? shuffleBag(createBag());
    this.unclaimed = [];
    this.words = [];
    this.score = 0;
    this.status = 'playing';
  }

  canDraw() {
    return this.status === 'playing'
      && this.bag.length > 0
      && this.unclaimed.length < UNCLAIMED_CAP;
  }

  draw() {
    if (!this.canDraw()) return { error: 'Cannot draw right now' };
    const tile = this.bag.pop();
    this.unclaimed.push(tile);
    return { ok: true, tile };
  }

  // Removes `letters` from unclaimed pool; returns new pool or null if any letter missing.
  _take(letters) {
    const pool = [...this.unclaimed];
    for (const l of letters) {
      const i = pool.findIndex(t => t.letter === l);
      if (i === -1) return null;
      pool.splice(i, 1);
    }
    return pool;
  }

  // Returns letters in `next` beyond what's in `prev` (multiset subtraction next − prev).
  // Returns null if `prev` is not a multiset subset of `next`.
  _extras(next, prev) {
    const pool = [...next];
    for (const l of prev) {
      const i = pool.indexOf(l);
      if (i === -1) return null;
      pool.splice(i, 1);
    }
    return pool;
  }

  _sameLetters(a, b) {
    return a.length === b.length
      && [...a].sort().join('') === [...b].sort().join('');
  }

  _recalc() {
    this.score = this.words.reduce((s, w) => s + (w.letters.length - 2), 0);
  }

  claim(raw) {
    const word = raw.toUpperCase().replace(/[^A-Z]/g, '');
    const letters = word.split('');

    if (letters.length < MIN_WORD_LEN) return { error: `Words must be at least ${MIN_WORD_LEN} letters` };
    if (!isValidWord(word)) return { error: `"${word}" isn't in the Scrabble dictionary` };

    const next = this._take(letters);
    if (!next) return { error: 'Those letters aren\'t all in your pool' };

    this.unclaimed = next;
    const w = { id: makeWordId(), letters, text: word };
    this.words.push(w);
    this._recalc();
    return { ok: true, word: w };
  }

  extend(wordId, raw) {
    const existing = this.words.find(w => w.id === wordId);
    if (!existing) return { error: 'Word not found' };

    const word = raw.toUpperCase().replace(/[^A-Z]/g, '');
    const letters = word.split('');

    if (!isValidWord(word)) return { error: `"${word}" isn't in the Scrabble dictionary` };

    const extras = this._extras(letters, existing.letters);
    if (extras === null) return { error: `New word must contain all letters of "${existing.text}"` };
    if (extras.length === 0) return { error: 'Must add at least one new tile — use Anagram to rearrange only' };

    const next = this._take(extras);
    if (!next) return { error: `Need ${extras.join(', ')} from your pool` };

    this.unclaimed = next;
    existing.letters = letters;
    existing.text = word;
    this._recalc();
    return { ok: true, word: existing };
  }

  anagram(wordId, raw) {
    const existing = this.words.find(w => w.id === wordId);
    if (!existing) return { error: 'Word not found' };

    const word = raw.toUpperCase().replace(/[^A-Z]/g, '');
    const letters = word.split('');

    if (!isValidWord(word)) return { error: `"${word}" isn't in the Scrabble dictionary` };
    if (!this._sameLetters(letters, existing.letters)) return { error: `Must use the exact letters of "${existing.text}"` };
    if (word === existing.text) return { error: `"${word}" is already the current arrangement` };

    existing.letters = letters;
    existing.text = word;
    return { ok: true, word: existing };
  }

  recombine(wordIds, raw) {
    if (wordIds.length < 2) return { error: 'Select at least 2 words to recombine' };

    const sources = wordIds.map(id => this.words.find(w => w.id === id)).filter(Boolean);
    if (sources.length !== wordIds.length) return { error: 'One or more selected words not found' };

    const word = raw.toUpperCase().replace(/[^A-Z]/g, '');
    const letters = word.split('');
    const srcLetters = sources.flatMap(w => w.letters);

    if (!isValidWord(word)) return { error: `"${word}" isn't in the Scrabble dictionary` };

    const extras = this._extras(letters, srcLetters);
    if (extras === null) return { error: 'New word must contain all letters from the selected words' };

    const next = extras.length > 0 ? this._take(extras) : [...this.unclaimed];
    if (!next) return { error: `Need ${extras.join(', ')} from your pool` };

    this.words = this.words.filter(w => !wordIds.includes(w.id));
    this.unclaimed = next;
    const w = { id: makeWordId(), letters, text: word };
    this.words.push(w);
    this._recalc();
    return { ok: true, word: w };
  }

  declareDone() {
    this.status = 'done';
  }
}
