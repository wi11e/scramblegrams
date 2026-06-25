export async function submitScore({ playerName, countryCode, score, words, puzzleDate }) {
  const res = await fetch('/api/scores', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ playerName, countryCode, score, words, puzzleDate }),
  });
  return res.json();
}

export async function fetchLeaderboard(tab, { bust = false } = {}) {
  const url = bust ? `/api/leaderboard/${tab}?t=${Date.now()}` : `/api/leaderboard/${tab}`;
  const res = await fetch(url);
  return res.json();
}

export async function fetchPlayerCount() {
  const res = await fetch('/api/players/today');
  return res.json();
}
