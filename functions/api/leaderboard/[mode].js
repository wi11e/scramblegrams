// GET /api/leaderboard/today  — today's scores
// GET /api/leaderboard/best   — all-time personal bests across daily puzzles

const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

function todayUTC() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

export async function onRequestGet({ params, env }) {
  const { mode } = params;

  if (mode !== 'today' && mode !== 'best')
    return Response.json({ error: 'Invalid leaderboard' }, { status: 400, headers: CORS });

  try {
    let results;

    if (mode === 'today') {
      const today = todayUTC();
      ({ results } = await env.DB.prepare(`
        SELECT s.player_name, s.country_code, s.score, s.words, s.word_chains
        FROM scores s
        INNER JOIN (
          SELECT player_name, MAX(score) AS best, MIN(created_at) AS first_at
          FROM scores WHERE puzzle_date = ?
          GROUP BY player_name
        ) b ON s.player_name = b.player_name
            AND s.score = b.best
            AND s.puzzle_date = ?
        GROUP BY s.player_name
        ORDER BY s.score DESC, b.first_at ASC
        LIMIT 50
      `).bind(today, today).all());

    } else {
      ({ results } = await env.DB.prepare(`
        SELECT s.player_name, s.country_code, s.score, s.words, s.word_chains
        FROM scores s
        INNER JOIN (
          SELECT player_name, MAX(score) AS best, MIN(created_at) AS first_at
          FROM scores WHERE puzzle_date != ''
          GROUP BY player_name
        ) b ON s.player_name = b.player_name
            AND s.score = b.best
            AND s.puzzle_date != ''
        GROUP BY s.player_name
        ORDER BY s.score DESC, b.first_at ASC
        LIMIT 50
      `).bind().all());
    }

    const leaderboard = results.map((row, i) => {
      const words      = (() => { try { return JSON.parse(row.words       ?? '[]');   } catch { return [];   } })();
      const wordChains = (() => { try { return JSON.parse(row.word_chains ?? 'null'); } catch { return null; } })();
      const usedAllTiles = words.reduce((sum, w) => sum + w.length, 0) === 40;
      return {
        rank:        i + 1,
        playerName:  row.player_name,
        countryCode: row.country_code,
        score:       row.score,
        words,
        wordChains,
        usedAllTiles,
      };
    });

    return Response.json(leaderboard, {
      headers: { ...CORS, 'Cache-Control': mode === 'today' ? 'public, max-age=30' : 'public, max-age=300' },
    });

  } catch (err) {
    console.error(err);
    return Response.json({ error: 'Server error' }, { status: 500, headers: CORS });
  }
}
