// POST /api/scores
// Validates words server-side, inserts daily score, returns today's rank.

let _words = null;

async function getWordSet(origin) {
  if (_words) return _words;
  const res = await fetch(`${origin}/wordlist.txt`);
  const text = await res.text();
  _words = new Set(text.split('\n').filter(Boolean));
  return _words;
}

const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

function todayUTC() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: { ...CORS, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' },
  });
}

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); }
  catch { return Response.json({ error: 'Invalid JSON' }, { status: 400, headers: CORS }); }

  const { playerName, countryCode, score, words, puzzleDate } = body;

  // ── Input sanity ──────────────────────────────────────────────────────────

  const name = String(playerName ?? '').trim().slice(0, 20);
  if (name.length < 1)
    return Response.json({ error: 'Name required' }, { status: 400, headers: CORS });

  if (typeof countryCode !== 'string' || !/^[A-Z]{2}$/.test(countryCode))
    return Response.json({ error: 'Invalid country code' }, { status: 400, headers: CORS });

  // Only accept today's date (prevents backdating scores)
  const today = todayUTC();
  if (puzzleDate !== today)
    return Response.json({ error: 'Invalid puzzle date' }, { status: 400, headers: CORS });

  if (typeof score !== 'number' || !Number.isInteger(score) || score < 0 || score > 500)
    return Response.json({ error: 'Invalid score' }, { status: 400, headers: CORS });

  if (!Array.isArray(words) || words.length === 0)
    return Response.json({ error: 'No words submitted' }, { status: 400, headers: CORS });

  // ── Word validation + score recompute ─────────────────────────────────────

  try {
    const origin  = new URL(request.url).origin;
    const valid   = await getWordSet(origin);
    let computed  = 0;

    for (const w of words) {
      const text = String(w?.text ?? '').toUpperCase().replace(/[^A-Z]/g, '');
      if (text.length < 4)
        return Response.json({ error: `Word too short: ${w?.text}` }, { status: 400, headers: CORS });
      if (!valid.has(text))
        return Response.json({ error: `Not a valid word: ${text}` }, { status: 400, headers: CORS });
      computed += text.length - 2;
    }

    if (computed !== score)
      return Response.json({ error: 'Score does not match words' }, { status: 400, headers: CORS });

    // ── Persist ───────────────────────────────────────────────────────────────

    const wordsJson = JSON.stringify(words.map(w => String(w.text).toUpperCase()));

    await env.DB.prepare(
      'INSERT INTO scores (player_name, country_code, score, words, puzzle_date) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(name, countryCode, 'classical', score, wordsJson, today).run();

    // Today's rank
    const { rank } = await env.DB.prepare(`
      SELECT COUNT(*) + 1 AS rank
      FROM (
        SELECT player_name, MAX(score) AS top
        FROM scores WHERE puzzle_date = ?
        GROUP BY player_name
      )
      WHERE top > ?
    `).bind(today, score).first();

    return Response.json({ ok: true, rank }, { headers: CORS });

  } catch (err) {
    console.error(err);
    return Response.json({ error: 'Server error' }, { status: 500, headers: CORS });
  }
}
