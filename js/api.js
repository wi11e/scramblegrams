export async function submitScore({ playerName, countryCode, score, words, puzzleDate }) {
  const res = await fetch('/api/scores', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ playerName, countryCode, score, words, puzzleDate }),
  });
  return res.json();
}

export async function fetchLeaderboard(tab) {
  const res = await fetch(`/api/leaderboard/${tab}`);
  return res.json();
}
