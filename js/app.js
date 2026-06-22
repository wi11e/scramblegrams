import { loadWordList, isValidWord } from './wordlist.js';
import { ScramblergramsGame, TIME_LIMITS } from './game.js';
import './elements.js';

// ── DOM refs ──────────────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);

const screens   = { start: $('start-screen'), game: $('game-screen'), result: $('result-screen') };
const header    = $('header');
const wordBoard = $('word-board');
const tileRack  = $('tile-rack');
const trayEl    = $('tray');
const drawBtn   = $('draw-btn');
const doneBtn   = $('done-btn');
const statusEl  = $('status-msg');
const startBtn  = $('start-btn');
const shareBtn  = $('share-btn');

// ── State ─────────────────────────────────────────────────────────────────────

let game          = null;
let timerSecs     = 0;
let timerInterval = null;

// Each entry: { letter, tileId, origin }
// origin = 'unclaimed'  OR  { wordId, wordText }
let tray         = [];
let wordIdsInTray = new Set();

// ── Boot ──────────────────────────────────────────────────────────────────────

async function boot() {
  startBtn.disabled    = true;
  startBtn.textContent = 'Loading dictionary…';

  try {
    await loadWordList();
  } catch {
    startBtn.textContent = 'Error loading dictionary — reload page';
    return;
  }

  startBtn.disabled    = false;
  startBtn.textContent = 'Start Game';

  // Auto-resume an in-progress game
  const saved = loadSavedState();
  if (saved?.status === 'playing') {
    restoreGame(saved);
    show('game');
    startTimer(saved.mode);
    render();
  }

  startBtn.addEventListener('click', startGame);
  drawBtn.addEventListener('click', onDraw);
  doneBtn.addEventListener('click', onDone);
  shareBtn.addEventListener('click', onShare);
  $('play-again-btn').addEventListener('click', () => { clearSavedState(); location.reload(); });

  // Tile tap → add to tray
  tileRack.addEventListener('tile-tap', e => addTileToTray(e.detail.tileId));

  // Word tap → send all letters to tray
  wordBoard.addEventListener('word-tap', e => addWordToTray(e.detail.wordId));

  // Tray events
  trayEl.addEventListener('tray-clear',   onTrayClear);
  trayEl.addEventListener('tray-claim',   onClaim);
  trayEl.addEventListener('tray-reorder', e => reorderTray(e.detail));
}

// ── Screen helper ─────────────────────────────────────────────────────────────

function show(name) {
  for (const [k, el] of Object.entries(screens)) el.hidden = (k !== name);
}

// ── Game start ────────────────────────────────────────────────────────────────

function startGame() {
  const mode = document.querySelector('input[name="mode"]:checked').value;
  game        = new ScramblergramsGame(mode);
  timerSecs   = TIME_LIMITS[mode] ?? 0;
  tray        = [];
  wordIdsInTray = new Set();

  show('game');
  startTimer(mode);
  render();
  drawBtn.focus();
}

// ── Timer ─────────────────────────────────────────────────────────────────────

function startTimer(mode) {
  clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    timerSecs += (mode === 'classical') ? 1 : -1;
    if (mode !== 'classical' && timerSecs <= 0) {
      timerSecs = 0;
      clearInterval(timerInterval);
      clearSavedState();
      endGame();
    } else {
      saveState();
      renderHeader();
    }
  }, 1000);
}

// ── Tray actions ──────────────────────────────────────────────────────────────

function addTileToTray(tileId) {
  const tile = game.unclaimed.find(t => t.id === tileId);
  if (!tile) return;
  tray.push({ letter: tile.letter, tileId: tile.id, origin: 'unclaimed' });
  render();
}

function addWordToTray(wordId) {
  if (wordIdsInTray.has(wordId)) return;
  const word = game.words.find(w => w.id === wordId);
  if (!word) return;
  word.letters.forEach((letter, i) => {
    tray.push({
      letter,
      tileId: `${wordId}:${i}`,
      origin: { wordId, wordText: word.text },
    });
  });
  wordIdsInTray.add(wordId);
  render();
}

function onTrayClear() {
  tray = [];
  wordIdsInTray.clear();
  flash('', '');
  render();
}

function reorderTray({ from, to }) {
  const [item] = tray.splice(from, 1);
  tray.splice(to > from ? to - 1 : to, 0, item);
  render();
}

// ── Claim ─────────────────────────────────────────────────────────────────────

function onClaim() {
  const word   = tray.map(t => t.letter).join('');
  const wIds   = [...wordIdsInTray];
  const hasNew = tray.some(t => t.origin === 'unclaimed');

  let result;
  if (wIds.length === 0) {
    result = game.claim(word);
  } else if (wIds.length === 1 && !hasNew) {
    result = game.anagram(wIds[0], word);
  } else if (wIds.length === 1) {
    result = game.extend(wIds[0], word);
  } else {
    result = game.recombine(wIds, word);
  }

  if (result.ok) {
    const pts = result.word.letters.length - 2;
    flash(`${result.word.text}  +${pts}`, 'success');
    tray = [];
    wordIdsInTray.clear();
    render();
    saveState();
  } else {
    flash(result.error, 'error');
    trayEl.classList.add('shake');
    setTimeout(() => trayEl.classList.remove('shake'), 400);
  }
}

// ── Draw / Done ───────────────────────────────────────────────────────────────

function onDraw() {
  const r = game.draw();
  if (r.error) { flash(r.error, 'error'); return; }
  flash('', '');
  render();
  saveState();
}

function onDone() {
  clearInterval(timerInterval);
  game.declareDone();
  clearSavedState();
  endGame();
}

// ── End game ──────────────────────────────────────────────────────────────────

function endGame() {
  show('result');

  $('final-score').innerHTML =
    `<div class="big-score">${game.score}</div><div class="score-lbl">points</div>`;

  const m = Math.floor(timerSecs / 60);
  const s = timerSecs % 60;
  $('final-time').textContent =
    game.mode === 'classical' ? `Time: ${m}:${String(s).padStart(2, '0')}` : '';

  $('final-words').innerHTML = game.words.length
    ? game.words.map(w =>
        `<div class="result-word"><span>${w.text}</span><span class="rw-pts">+${w.letters.length - 2}</span></div>`
      ).join('')
    : '<p class="no-words">No words were claimed</p>';
}

// ── Render ────────────────────────────────────────────────────────────────────

function render() {
  renderHeader();
  renderWordBoard();
  renderRack();
  renderTray();
  updateDrawButton();
}

function renderHeader() {
  header.update({ score: game.score, seconds: timerSecs, bagCount: game.bag.length, mode: game.mode });
}

function renderWordBoard() {
  // Hide words whose letters are currently in the tray
  wordBoard.setWords(game.words.filter(w => !wordIdsInTray.has(w.id)));
}

function renderRack() {
  // Hide unclaimed tiles that are in the tray
  const inTray = new Set(
    tray.filter(t => t.origin === 'unclaimed').map(t => t.tileId)
  );
  tileRack.setTiles(game.unclaimed.filter(t => !inTray.has(t.id)));
}

function renderTray() {
  const word  = tray.map(t => t.letter).join('');
  const valid = tray.length >= 4 && isValidWord(word);
  trayEl.setTiles(tray, valid);
}

function updateDrawButton() {
  drawBtn.disabled = !game.canDraw();
  drawBtn.textContent = game.bag.length === 0
    ? 'Bag empty'
    : `Draw  (${game.bag.length})`;
}

function flash(msg, type) {
  statusEl.textContent = msg;
  statusEl.className   = `status-msg ${type}`;
}

// ── Persistence ───────────────────────────────────────────────────────────────

const SAVE_KEY = 'sg-state';

function saveState() {
  if (!game || game.status !== 'playing') return;
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      mode:         game.mode,
      bag:          game.bag,
      unclaimed:    game.unclaimed,
      words:        game.words,
      score:        game.score,
      status:       game.status,
      timerSecs,
      tray,
      wordIdsInTray: [...wordIdsInTray],
    }));
  } catch { /* storage full — silently skip */ }
}

function loadSavedState() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function clearSavedState() {
  localStorage.removeItem(SAVE_KEY);
}

function restoreGame(saved) {
  game = new ScramblergramsGame(saved.mode);
  game.bag       = saved.bag;
  game.unclaimed = saved.unclaimed;
  game.words     = saved.words;
  game.score     = saved.score;
  game.status    = saved.status;
  timerSecs      = saved.timerSecs;
  tray           = saved.tray;
  wordIdsInTray  = new Set(saved.wordIdsInTray);
}

// ── Share ─────────────────────────────────────────────────────────────────────

async function onShare() {
  const modeLabel = { classical: 'Classical', bullet: 'Bullet', blitz: 'Blitz', rapid: 'Rapid' }[game.mode];
  const m = Math.floor(timerSecs / 60);
  const s = String(timerSecs % 60).padStart(2, '0');
  const timeStr = game.mode === 'classical' ? ` · ${m}:${s}` : '';
  const wordLines = game.words.map(w => `${w.text}  +${w.letters.length - 2}`).join('\n');

  const text = `SCRAMBLEGRAMS 🍌\n${game.score} pts · ${modeLabel}${timeStr}\n\n${wordLines}`;

  try {
    await navigator.clipboard.writeText(text);
    shareBtn.textContent = 'Copied!';
    setTimeout(() => shareBtn.textContent = 'Share score', 2000);
  } catch {
    shareBtn.textContent = 'Copy failed';
    setTimeout(() => shareBtn.textContent = 'Share score', 2000);
  }
}

// ── Go ────────────────────────────────────────────────────────────────────────

boot();
