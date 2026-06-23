export const TILE_DISTRIBUTION = {
  A:13, B:3, C:3, D:6, E:18, F:3, G:4, H:3, I:12, J:2, K:2,
  L:5,  M:3, N:8, O:11, P:3, Q:2, R:9, S:6, T:9, U:6, V:3, W:3, X:2, Y:3, Z:2,
};

export const TOTAL_TILES = Object.values(TILE_DISTRIBUTION).reduce((a, b) => a + b, 0); // 144

let _uid = 0;

export function createBag() {
  const bag = [];
  for (const [letter, count] of Object.entries(TILE_DISTRIBUTION)) {
    for (let i = 0; i < count; i++) {
      bag.push({ letter, id: `t${++_uid}` });
    }
  }
  return bag;
}

export function shuffleBag(bag) {
  const arr = [...bag];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// mulberry32 seeded PRNG
function makeRng(seed) {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export const DAILY_TILE_COUNT = 40;
export const LAUNCH_DATE = new Date(Date.UTC(2026, 5, 23)); // 2026-06-23 = Day 1

export function getPuzzleDate() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function getPuzzleDateString() {
  const d = getPuzzleDate();
  return d.toISOString().slice(0, 10); // 'YYYY-MM-DD'
}

export function getDayNumber() {
  return Math.floor((getPuzzleDate() - LAUNCH_DATE) / 86400000) + 1;
}

// Build a bag from a letters array (from puzzles.json or seeded fallback)
function lettersToTiles(letters) {
  return letters.map(letter => ({ letter, id: `t${++_uid}` }));
}

export async function loadTodaysBag() {
  const today = getPuzzleDateString();
  try {
    const res     = await fetch('/puzzles.json');
    const puzzles = await res.json();
    const puzzle  = puzzles.find(p => p.date === today);
    if (puzzle) {
      // Store solution on window for result screen reveal
      window.__puzzleSolution = puzzle.solution;
      // tiles array is in draw order; reverse so .pop() draws from the front
      return lettersToTiles([...puzzle.tiles].reverse());
    }
  } catch { /* fall through to seeded fallback */ }

  // Seeded fallback when no curated puzzle exists for today
  window.__puzzleSolution = null;
  const d    = getPuzzleDate();
  const seed = d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
  const rng  = makeRng(seed);
  const full = createBag();
  for (let i = full.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [full[i], full[j]] = [full[j], full[i]];
  }
  return full.slice(full.length - DAILY_TILE_COUNT);
}
