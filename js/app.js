import { loadWordList, isValidWord } from './wordlist.js';
import { ScramblergramsGame } from './game.js';
import { getProfile, saveProfile, hasProfile, COUNTRIES, flagEmoji } from './profile.js';
import { submitScore, fetchLeaderboard } from './api.js';
import { loadTodaysBag, getPuzzleDateString, getDayNumber } from './tiles.js';
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
let countdownInterval = null;

let tray          = [];
let wordIdsInTray = new Set();

const SAVE_KEY   = 'sg-state';
const SAVE_ON    =  true
const TOUR_KEY   = 'sg-tour-seen';
const STATS_KEY  = 'sg-stats';
const TOUR_TOTAL = 7;

let fillTimer           = null;
let scoreSubmitted      = false;
let allTilesCelebrated  = false;
// 'start' | 'leaderboard' | 'result'
let profileContext = 'start';

// ── Stats ─────────────────────────────────────────────────────────────────────

function loadStats() {
  try {
    return JSON.parse(localStorage.getItem(STATS_KEY)) ?? {};
  } catch { return {}; }
}

function saveStats(stats) {
  localStorage.setItem(STATS_KEY, JSON.stringify(stats));
}

function recordGamePlayed(score) {
  const stats     = loadStats();
  const today     = getPuzzleDateString();
  const yesterday = new Date(Date.UTC(...today.split('-').map((v, i) => i === 1 ? v - 1 : +v)));
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const yStr = yesterday.toISOString().slice(0, 10);

  const streak = stats.lastPlayed === yStr ? (stats.streak ?? 0) + 1 : 1;

  saveStats({
    streak,
    maxStreak:   Math.max(streak, stats.maxStreak ?? 0),
    gamesPlayed: (stats.gamesPlayed ?? 0) + 1,
    personalBest: Math.max(score, stats.personalBest ?? 0),
    lastPlayed:  today,
  });
}

function alreadyPlayedToday() {
  return loadStats().lastPlayed === getPuzzleDateString();
}

// ── Boot ──────────────────────────────────────────────────────────────────────

async function boot() {
  initTheme();

  startBtn.disabled    = true;
  startBtn.textContent = 'Loading…';

  try {
    await loadWordList();
  } catch {
    startBtn.textContent = 'Error loading — reload page';
    return;
  }

  updateStartScreen();

  // Auto-resume an in-progress game from today
  const saved = loadSavedState();
  if (saved?.puzzleDate === getPuzzleDateString() && saved?.status === 'playing') {
    restoreGame(saved);
    show('game');
    startTimer();
    render();
    autoFill();
    return;
  }

  startBtn.addEventListener('click', onStartClick);
  shareBtn.addEventListener('click', onShare);
  $('theme-btn').addEventListener('click', toggleTheme);

  // Retire modal
  header.addEventListener('retire-click', () => { $('retire-modal').hidden = false; });
  $('retire-no').addEventListener('click',  () => { $('retire-modal').hidden = true; });
  $('retire-yes').addEventListener('click', () => { $('retire-modal').hidden = true; onDone(); });

  $('lb-result-btn').addEventListener('click', () => openLeaderboard('today', 'result'));

  // Tile tap → add to tray
  tileRack.addEventListener('tile-tap', e => addTileToTray(e.detail.tileId));
  wordBoard.addEventListener('word-tap', e => addWordToTray(e.detail.wordId));

  trayEl.addEventListener('tray-clear',    onTrayClear);
  trayEl.addEventListener('tray-claim',    onClaim);
  trayEl.addEventListener('tray-reorder',  e => reorderTray(e.detail));
  trayEl.addEventListener('tray-tile-tap', e => returnTileFromTray(e.detail.idx));

  $('lb-icon-btn').addEventListener('click', () => openLeaderboard('today', 'leaderboard'));
  $('profile-icon-btn').addEventListener('click', () => { profileContext = 'start'; show('profile'); });

  // Stats modal
  $('stats-btn').addEventListener('click', openStats);
  $('stats-close').addEventListener('click', () => { $('stats-modal').hidden = true; });

  initTour();

  // Profile screen
  $('profile-back').addEventListener('click', () => profileContext === 'result' ? show('result') : show('start'));
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

// ── Start screen ──────────────────────────────────────────────────────────────

function updateStartScreen() {
  const dayNum = getDayNumber();
  $('day-number').textContent = `Day ${dayNum}`;

  if (alreadyPlayedToday()) {
    startBtn.hidden = true;
    $('played-today').hidden = false;
    startCountdown();
  } else {
    startBtn.hidden = false;
    startBtn.disabled = false;
    startBtn.textContent = 'Play';
    $('played-today').hidden = true;
  }
}

// ── Theme ─────────────────────────────────────────────────────────────────────

function initTheme() {
  const saved      = localStorage.getItem('sg-theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  applyTheme(saved ?? (prefersDark ? 'dark' : 'light'));
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('sg-theme', theme);
  const isDark = theme === 'dark';
  $('theme-icon-moon').hidden = isDark;
  $('theme-icon-sun').hidden  = !isDark;
  $('theme-btn').setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
}

function toggleTheme() {
  applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
}

// ── Screen helper ─────────────────────────────────────────────────────────────

function show(name) {
  for (const [k, el] of Object.entries(screens)) el.hidden = (k !== name);
}

function startCountdown() {
  const el = $('next-puzzle-countdown');
  const tick = () => {
    const now  = new Date();
    const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
    const diff = next - now;
    const h    = Math.floor(diff / 3600000);
    const m    = Math.floor((diff % 3600000) / 60000);
    const s    = Math.floor((diff % 60000) / 1000);
    el.textContent = `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
  };
  tick();
  countdownInterval = setInterval(tick, 1000);
}

// ── Stats modal ───────────────────────────────────────────────────────────────

function openStats() {
  renderStats();
  $('stats-modal').hidden = false;
}

function renderStats() {
  const s = loadStats();
  $('stat-streak').textContent       = s.streak       ?? 0;
  $('stat-max-streak').textContent   = s.maxStreak    ?? 0;
  $('stat-games-played').textContent = s.gamesPlayed  ?? 0;
  $('stat-personal-best').textContent = s.personalBest ?? 0;
}

// ── Game start ────────────────────────────────────────────────────────────────

function onStartClick() {
  startGame();
}

async function startGame() {
  const bag = await loadTodaysBag();
  game      = new ScramblergramsGame('classical', bag);
  timerSecs = 0;
  tray                 = [];
  wordIdsInTray        = new Set();
  scoreSubmitted       = false;
  allTilesCelebrated   = false;

  show('game');
  startTimer();
  render();
  autoFill();
}

// ── Timer ─────────────────────────────────────────────────────────────────────

function startTimer() {
  clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    timerSecs++;
    saveState();
    renderHeader();
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
    tray.push({ letter, tileId: `${wordId}:${i}`, origin: { wordId, wordText: word.text } });
  });
  wordIdsInTray.add(wordId);
  render();
}

function returnTileFromTray(idx) {
  const tile = tray[idx];
  if (!tile || tile.origin !== 'unclaimed') return;
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
  if (wIds.length === 0)            result = game.claim(word);
  else if (wIds.length === 1 && !hasNew) result = game.anagram(wIds[0], word);
  else if (wIds.length === 1)       result = game.extend(wIds[0], word);
  else                              result = game.recombine(wIds, word);

  if (result.ok) {
    const pts = result.word.letters.length - 2;
    flash(`${result.word.text}  +${pts}`, 'success');
    tray = [];
    wordIdsInTray.clear();
    render();
    saveState();
    autoFill(150);
    requestAnimationFrame(() => {
      document.getElementById('game-body').scrollTop = document.getElementById('game-body').scrollHeight;
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
  recordGamePlayed(game.score);
  endGame();
}

// ── End game ──────────────────────────────────────────────────────────────────

function endGame() {
  show('result');

  const dayNum = getDayNumber();
  $('final-day').textContent = `Day ${dayNum}`;
  $('final-score').innerHTML =
    `<div class="big-score">${game.score}</div><div class="score-lbl">points</div>`;

  const m = Math.floor(timerSecs / 60);
  const s = timerSecs % 60;
  $('final-time').textContent = `${m}:${String(s).padStart(2, '0')}`;

  $('final-words').innerHTML = game.words.length
    ? game.words.map(w =>
        `<div class="result-word"><span>${w.text}</span><span class="rw-pts">+${w.letters.length - 2}</span></div>`
      ).join('')
    : '<p class="no-words">No words were claimed</p>';

  $('final-rank').textContent = '';

  // Show updated stats
  renderStats();
  $('result-stats').hidden = false;
}

// ── Render ────────────────────────────────────────────────────────────────────

function render() {
  renderHeader();
  renderWordBoard();
  renderRack();
  renderTray();
}

function renderHeader() {
  header.update({ score: game.score, seconds: timerSecs, bagCount: game.bag.length, mode: 'classical' });
}

function renderWordBoard() {
  wordBoard.setWords(game.words.filter(w => !wordIdsInTray.has(w.id)));
}

function renderRack() {
  const inTray = new Set(tray.filter(t => t.origin === 'unclaimed').map(t => t.tileId));
  tileRack.setTiles(game.unclaimed.filter(t => !inTray.has(t.id)));

  if (!allTilesCelebrated && game.bag.length === 0 && game.unclaimed.length === 0 && game.words.length > 0) {
    allTilesCelebrated = true;
    triggerConfetti();
  }
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

function saveState() {
  if (!game || game.status !== 'playing' || !SAVE_ON) return;
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      puzzleDate:   getPuzzleDateString(),
      bag:          game.bag,
      unclaimed:    game.unclaimed,
      words:        game.words,
      score:        game.score,
      status:       game.status,
      timerSecs,
      tray,
      wordIdsInTray: [...wordIdsInTray],
    }));
  } catch { /* storage full */ }
}

function loadSavedState() {
  if (!SAVE_ON) return;
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function clearSavedState() {
  localStorage.removeItem(SAVE_KEY);
}

function restoreGame(saved) {
  game = new ScramblergramsGame('classical', []);
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
  const dayNum  = getDayNumber();
  const lengths = {};
  for (const w of game.words) {
    lengths[w.letters.length] = (lengths[w.letters.length] ?? 0) + 1;
  }

  const BLOCK = '█';
  const NUM_EMOJI = { 4:'4️⃣', 5:'5️⃣', 6:'6️⃣', 7:'7️⃣', 8:'8️⃣', 9:'9️⃣', 10:'🔟' };

  const grid = Object.entries(lengths)
    .sort(([a], [b]) => a - b)
    .map(([len, count]) => `${NUM_EMOJI[len] ?? `${len}:`} ${BLOCK.repeat(count)}`)
    .join('\n');

  const m = Math.floor(timerSecs / 60);
  const s = String(timerSecs % 60).padStart(2, '0');
  const text = `SCRAMBLEGRAMS 🧠\nDay ${dayNum} · ${game.score} pts · ${m}:${s}\n\n${grid}`;

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
    btn.className   = 'flag-btn';
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

  const profile   = getProfile();
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
  if (profileContext === 'start') {
    show('start');
  } else {
    if (profileContext === 'result') submitCurrentScore();
    showLeaderboard('today');
  }
}

// ── Leaderboard ───────────────────────────────────────────────────────────────

async function openLeaderboard(tab, context = 'leaderboard') {
  profileContext = context;
  if (context === 'result' && !hasProfile()) {
    show('profile');
    return;
  }
  if (context === 'result') await submitCurrentScore();
  showLeaderboard(tab);
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
      score:       game.score,
      words:       game.words.map(w => ({ text: w.text })),
      puzzleDate:  getPuzzleDateString(),
    });
    if (!res.ok) scoreSubmitted = false; // allow retry if server rejected
    const rankEl = $('final-rank');
    if (rankEl && res.ok) rankEl.textContent = `You ranked #${res.rank} today`;
  } catch {
    scoreSubmitted = false;
  }
}

function showLeaderboard(tab) {
  show('leaderboard');
  document.querySelectorAll('.lb-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.mode === tab);
  });
  loadLeaderboard(tab);
}

async function loadLeaderboard(tab) {
  const list = $('lb-list');
  list.innerHTML = '<p class="lb-loading">Loading…</p>';

  try {
    const entries = await fetchLeaderboard(tab);

    if (!Array.isArray(entries) || entries.length === 0) {
      list.innerHTML = '<p class="lb-empty">No scores yet — be the first!</p>';
      return;
    }

    const profile = getProfile();
    const medals  = ['🥇', '🥈', '🥉'];

    list.innerHTML = entries.map(e => {
      const isMe  = profile && e.playerName === profile.playerName && e.countryCode === profile.countryCode;
      const medal = medals[e.rank - 1] ?? `${e.rank}`;
      const star = e.usedAllTiles
        ? `<span class="lb-perfect" title="Used all tiles">★</span>` : '';
      const wordScore = e.words?.length
        ? `<div class="lb-words">${e.words.join(' · ')}<span class="lb-words-score">${e.score}${star}</span></div>` : '';
      return `
        <div class="lb-entry${isMe ? ' lb-me' : ''}">
          <span class="lb-rank">${medal}</span>
          <span class="lb-name">${e.playerName}</span>
          <span class="lb-flag">${flagEmoji(e.countryCode)}</span>
          ${wordScore}
        </div>`;
    }).join('');
  } catch {
    list.innerHTML = '<p class="lb-empty">Could not load leaderboard</p>';
  }
}

// ── Confetti ──────────────────────────────────────────────────────────────────

function triggerConfetti() {
  const COLORS  = ['#538d4e','#b59f3b','#c9414b','#4a9fe3','#9b59b6','#e67e22','#ffffff'];
  const W       = window.innerWidth;
  const H       = window.innerHeight;
  const COUNT   = 70;

  for (let i = 0; i < COUNT; i++) {
    const fromLeft = i < COUNT / 2;
    const el       = document.createElement('div');
    el.className   = 'confetti-piece';

    const color    = COLORS[Math.floor(Math.random() * COLORS.length)];
    const w        = 6  + Math.random() * 8;
    const h        = w  * (0.4 + Math.random() * 0.8);
    const startY   = H  * (0.15 + Math.random() * 0.55);
    const tx       = (fromLeft ? 1 : -1) * W * (0.3 + Math.random() * 0.55);
    const ty       = -(H * (0.15 + Math.random() * 0.45));
    const rot      = (fromLeft ? 1 : -1) * (200 + Math.random() * 540);
    const duration = 1.2 + Math.random() * 0.9;
    const delay    = Math.random() * 0.35;

    Object.assign(el.style, {
      background:         color,
      width:              `${w}px`,
      height:             `${h}px`,
      left:               `${fromLeft ? 0 : W}px`,
      top:                `${startY}px`,
      animationDuration:  `${duration}s`,
      animationDelay:     `${delay}s`,
    });
    el.style.setProperty('--cx', `${tx}px`);
    el.style.setProperty('--cy', `${ty}px`);
    el.style.setProperty('--cr', `${rot}deg`);

    document.body.appendChild(el);
    el.addEventListener('animationend', () => el.remove());
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
  document.querySelectorAll('.tour-slide').forEach((el, i) => { el.hidden = i !== tourSlide; });
  document.querySelectorAll('.tour-dot').forEach((el, i) => { el.classList.toggle('active', i === tourSlide); });
  $('tour-prev').classList.toggle('invisible', tourSlide === 0);
  $('tour-next').hidden    = tourSlide === TOUR_TOTAL - 1;
  $('tour-got-it').hidden  = tourSlide !== TOUR_TOTAL - 1;
}

// ── Go ────────────────────────────────────────────────────────────────────────

boot();
