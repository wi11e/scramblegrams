export async function submitScore({ playerName, countryCode, mode, score, words }) {
  const res = await fetch('/api/scores', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ playerName, countryCode, mode, score, words }),
  });
  return res.json();
}

export async function fetchLeaderboard(mode) {
  const res = await fetch(`/api/leaderboard/${mode}`);
  return res.json();
}
