// GET /api/players/today — distinct player count for today's puzzle

const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

function todayUTC() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

export async function onRequestGet({ env }) {
  try {
    const today = todayUTC();
    const { count } = await env.DB.prepare(
      'SELECT COUNT(DISTINCT player_name) AS count FROM scores WHERE puzzle_date = ?'
    ).bind(today).first();

    return Response.json({ count }, {
      headers: { ...CORS, 'Cache-Control': 'public, max-age=30' },
    });
  } catch (err) {
    console.error(err);
    return Response.json({ error: 'Server error' }, { status: 500, headers: CORS });
  }
}
