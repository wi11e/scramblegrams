import { loadWordList, isValidWord } from './wordlist.js';
import { ScramblergramsGame, TIME_LIMITS } from './game.js';
import { getProfile, saveProfile, hasProfile, COUNTRIES, flagEmoji } from './profile.js';
import { submitScore, fetchLeaderboard } from './api.js';
import './elements.js';

// ── DOM refs ──────────────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);

const screens   = {
  start:       $('start-screen'),
  profile:     $('profile-screen'),
  leaderboard: $('leaderboard-screen'),
  game:        $('game-screen'),
  result:      $('result-screen'),
};
const header    = $('header');
const wordBoard = $('word-board');
const tileRack  = $('tile-rack');
const trayEl    = $('tray');
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
    autoFill();
  }

  startBtn.addEventListener('click', onStartClick);
  shareBtn.addEventListener('click', onShare);

  // Retire modal
  header.addEventListener('retire-click', () => { $('retire-modal').hidden = false; });
  $('retire-no').addEventListener('click',  () => { $('retire-modal').hidden = true; });
  $('retire-yes').addEventListener('click', () => { $('retire-modal').hidden = true; onDone(); });
  $('play-again-btn').addEventListener('click', () => { clearSavedState(); location.reload(); });
  $('lb-result-btn').addEventListener('click', () => openLeaderboard(game?.mode ?? 'classical', true));

  // Tile tap → add to tray
  tileRack.addEventListener('tile-tap', e => addTileToTray(e.detail.tileId));

  // Word tap → send all letters to tray
  wordBoard.addEventListener('word-tap', e => addWordToTray(e.detail.wordId));

  // Tray events
  trayEl.addEventListener('tray-clear',    onTrayClear);
  trayEl.addEventListener('tray-claim',    onClaim);
  trayEl.addEventListener('tray-reorder',  e => reorderTray(e.detail));
  trayEl.addEventListener('tray-tile-tap', e => returnTileFromTray(e.detail.idx));

  // Leaderboard icon on start screen
  $('lb-icon-btn').addEventListener('click', () => openLeaderboard('classical', false));

  initTour();

  // Profile screen
  $('profile-back').addEventListener('click', () => lbFromResult ? show('result') : show('start'));
  $('profile-save').addEventListener('click', onProfileSave);
  $('profile-name').addEventListener('input', updateProfileSaveBtn);
  buildFlagGrid();

  // Leaderboard screen
  $('lb-back').addEventListener('click', () => show('start'));
  document.querySelectorAll('.lb-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.lb-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      loadLeaderboard(tab.dataset.mode);
    });
  });
}

// ── Screen helper ─────────────────────────────────────────────────────────────

function show(name) {
  for (const [k, el] of Object.entries(screens)) el.hidden = (k !== name);
}

// ── Game start ────────────────────────────────────────────────────────────────

function onStartClick() {
  startGame();
}

function startGame() {
  const mode = document.querySelector('input[name="mode"]:checked').value;
  game        = new ScramblergramsGame(mode);
  timerSecs   = TIME_LIMITS[mode] ?? 0;
  tray          = [];
  wordIdsInTray = new Set();
  scoreSubmitted = false;

  show('game');
  startTimer(mode);
  render();
  autoFill();
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

function returnTileFromTray(idx) {
  const tile = tray[idx];
  if (!tile || tile.origin !== 'unclaimed') return; // word-origin tiles can't go back
  tray.splice(idx, 1);
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
    autoFill(150);
    // Scroll so the newly added word is visible
    requestAnimationFrame(() => {
      const body = document.getElementById('game-body');
      body.scrollTop = body.scrollHeight;
    });
  } else {
    flash(result.error, 'error');
    trayEl.classList.add('shake');
    setTimeout(() => trayEl.classList.remove('shake'), 400);
  }
}

// ── Auto-fill ─────────────────────────────────────────────────────────────────

function autoFill(initialDelay = 0) {
  clearTimeout(fillTimer);
  const step = () => {
    if (!game?.canDraw()) return;
    game.draw();
    render();
    saveState();
    if (game.canDraw()) fillTimer = setTimeout(step, 120);
  };
  fillTimer = setTimeout(step, initialDelay);
}

// ── Done ──────────────────────────────────────────────────────────────────────

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
    game.mode === 'classical' ? `${m}:${String(s).padStart(2, '0')}` : '';

  $('final-words').innerHTML = game.words.length
    ? game.words.map(w =>
        `<div class="result-word"><span>${w.text}</span><span class="rw-pts">+${w.letters.length - 2}</span></div>`
      ).join('')
    : '<p class="no-words">No words were claimed</p>';

  $('final-rank').textContent = '';
}

// ── Render ────────────────────────────────────────────────────────────────────

function render() {
  renderHeader();
  renderWordBoard();
  renderRack();
  renderTray();
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

function flash(msg, type) {
  statusEl.textContent = msg;
  statusEl.className   = `status-msg ${type}`;
}

// ── Persistence ───────────────────────────────────────────────────────────────

const SAVE_KEY = 'sg-state';
const TOUR_KEY = 'sg-tour-seen';
const TOUR_TOTAL = 8;

let fillTimer = null;
let scoreSubmitted = false;
let lbFromResult   = false;

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

  const text = `SCRAMBLEGRAMS 🧠\n${game.score} pts · ${modeLabel}${timeStr}\n\n${wordLines}`;

  try {
    await navigator.clipboard.writeText(text);
    shareBtn.textContent = 'Copied!';
    setTimeout(() => shareBtn.textContent = 'Share score', 2000);
  } catch {
    shareBtn.textContent = 'Copy failed';
    setTimeout(() => shareBtn.textContent = 'Share score', 2000);
  }
}

// ── Profile ───────────────────────────────────────────────────────────────────

let _selectedFlag = null;

function buildFlagGrid() {
  const grid = $('flag-grid');
  COUNTRIES.forEach(code => {
    const btn = document.createElement('button');
    btn.className  = 'flag-btn';
    btn.textContent = flagEmoji(code);
    btn.dataset.code = code;
    btn.setAttribute('aria-label', code);
    btn.addEventListener('click', () => {
      grid.querySelectorAll('.flag-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      _selectedFlag = code;
      updateProfileSaveBtn();
    });
    grid.appendChild(btn);
  });

  // Pre-select: existing profile country, or default to XX (checkered flag)
  const profile  = getProfile();
  const preselect = profile?.countryCode ?? 'XX';
  if (profile) $('profile-name').value = profile.playerName;
  _selectedFlag = preselect;
  grid.querySelector(`[data-code="${preselect}"]`)?.classList.add('selected');
  updateProfileSaveBtn();
}

function updateProfileSaveBtn() {
  $('profile-save').disabled = $('profile-name').value.trim().length < 1;
}

function onProfileSave() {
  const name = $('profile-name').value.trim().slice(0, 20);
  if (!name || !_selectedFlag) return;
  saveProfile(name, _selectedFlag);
  if (lbFromResult) submitCurrentScore();
  showLeaderboard(lbFromResult ? (game?.mode ?? 'classical') : 'classical');
}

// ── Leaderboard ───────────────────────────────────────────────────────────────

function openLeaderboard(mode, fromResult = false) {
  lbFromResult = fromResult;
  if (!hasProfile()) {
    show('profile');
    return;
  }
  if (fromResult) submitCurrentScore();
  showLeaderboard(mode);
}

async function submitCurrentScore() {
  if (scoreSubmitted || !game || game.score === 0) return;
  const profile = getProfile();
  if (!profile) return;

  scoreSubmitted = true;
  try {
    const res = await submitScore({
      playerName:  profile.playerName,
      countryCode: profile.countryCode,
      mode:        game.mode,
      score:       game.score,
      words:       game.words.map(w => ({ text: w.text })),
    });
    const rankEl = $('final-rank');
    if (rankEl && res.ok) rankEl.textContent = `You ranked #${res.rank} in ${game.mode} mode`;
  } catch {
    scoreSubmitted = false;
  }
}

function showLeaderboard(mode) {
  show('leaderboard');
  // Activate the correct tab
  document.querySelectorAll('.lb-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.mode === mode);
  });
  loadLeaderboard(mode);
}

async function loadLeaderboard(mode) {
  const list = $('lb-list');
  list.innerHTML = '<p class="lb-loading">Loading…</p>';

  try {
    const entries = await fetchLeaderboard(mode);

    if (!Array.isArray(entries) || entries.length === 0) {
      list.innerHTML = '<p class="lb-empty">No scores yet — be the first!</p>';
      return;
    }

    const profile = getProfile();
    const medals  = ['🥇', '🥈', '🥉'];

    list.innerHTML = entries.map(e => {
      const isMe  = profile && e.playerName === profile.playerName && e.countryCode === profile.countryCode;
      const medal = medals[e.rank - 1] ?? `${e.rank}`;
      return `
        <div class="lb-entry${isMe ? ' lb-me' : ''}">
          <span class="lb-rank">${medal}</span>
          <span class="lb-flag">${flagEmoji(e.countryCode)}</span>
          <span class="lb-name">${e.playerName}</span>
          <span class="lb-score">${e.score}</span>
        </div>`;
    }).join('');
  } catch {
    list.innerHTML = '<p class="lb-empty">Could not load leaderboard</p>';
  }
}

// ── Tour ──────────────────────────────────────────────────────────────────────

let tourSlide = 0;

function initTour() {
  $('tour-close').addEventListener('click', closeTour);
  $('tour-prev').addEventListener('click', () => gotoSlide(tourSlide - 1));
  $('tour-next').addEventListener('click', () => gotoSlide(tourSlide + 1));
  $('tour-got-it').addEventListener('click', closeTour);
  $('how-to-play-btn').addEventListener('click', openTour);

  if (!localStorage.getItem(TOUR_KEY)) openTour();
}

function openTour() {
  tourSlide = 0;
  renderTourSlide();
  $('tour-modal').hidden = false;
}

function closeTour() {
  $('tour-modal').hidden = true;
  localStorage.setItem(TOUR_KEY, '1');
}

function gotoSlide(n) {
  tourSlide = Math.max(0, Math.min(TOUR_TOTAL - 1, n));
  renderTourSlide();
}

function renderTourSlide() {
  document.querySelectorAll('.tour-slide').forEach((el, i) => {
    el.hidden = i !== tourSlide;
  });
  document.querySelectorAll('.tour-dot').forEach((el, i) => {
    el.classList.toggle('active', i === tourSlide);
  });
  $('tour-prev').classList.toggle('invisible', tourSlide === 0);
  $('tour-next').hidden = tourSlide === TOUR_TOTAL - 1;
  $('tour-got-it').hidden = tourSlide !== TOUR_TOTAL - 1;
}

// ── Go ────────────────────────────────────────────────────────────────────────

boot();
