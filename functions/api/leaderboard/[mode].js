// GET /api/leaderboard/:mode
// Returns top 50 scores (best per player) for the given mode.

const MODES = new Set(['classical', 'bullet', 'blitz', 'rapid']);
const CORS  = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

export async function onRequestGet({ params, env }) {
  const { mode } = params;

  if (!MODES.has(mode))
    return Response.json({ error: 'Invalid mode' }, { status: 400, headers: CORS });

  try {
    // One row per player — their best score, country from that game.
    const { results } = await env.DB.prepare(`
      SELECT s.player_name, s.country_code, s.score
      FROM scores s
      INNER JOIN (
        SELECT player_name, MAX(score) AS best, MIN(created_at) AS first_at
        FROM scores WHERE mode = ?
        GROUP BY player_name
      ) b ON s.player_name = b.player_name
          AND s.score = b.best
          AND s.mode = ?
      GROUP BY s.player_name
      ORDER BY s.score DESC, b.first_at ASC
      LIMIT 50
    `).bind(mode, mode).all();

    const leaderboard = results.map((row, i) => ({
      rank:        i + 1,
      playerName:  row.player_name,
      countryCode: row.country_code,
      score:       row.score,
    }));

    return Response.json(leaderboard, {
      headers: { ...CORS, 'Cache-Control': 'public, max-age=30' },
    });

  } catch (err) {
    console.error(err);
    return Response.json({ error: 'Server error' }, { status: 500, headers: CORS });
  }
}
