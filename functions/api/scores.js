// POST /api/scores
// Validates words server-side, inserts score, returns player rank.

let _words = null;

async function getWordSet(origin) {
  if (_words) return _words;
  const res = await fetch(`${origin}/wordlist.txt`);
  const text = await res.text();
  _words = new Set(text.split('\n').filter(Boolean));
  return _words;
}

const MODES = new Set(['classical', 'bullet', 'blitz', 'rapid']);
const CORS  = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

export async function onRequestOptions() {
  return new Response(null, {
    headers: { ...CORS, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' },
  });
}

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); }
  catch { return Response.json({ error: 'Invalid JSON' }, { status: 400, headers: CORS }); }

  const { playerName, countryCode, mode, score, words } = body;

  // ── Input sanity ──────────────────────────────────────────────────────────

  const name = String(playerName ?? '').trim().slice(0, 20);
  if (name.length < 1)
    return Response.json({ error: 'Name required' }, { status: 400, headers: CORS });

  // XX = checkered flag (no country); any 2-letter code passes — ^[A-Z]{2}$ already matches XX
  if (typeof countryCode !== 'string' || !/^[A-Z]{2}$/.test(countryCode))
    return Response.json({ error: 'Invalid country code' }, { status: 400, headers: CORS });

  if (!MODES.has(mode))
    return Response.json({ error: 'Invalid mode' }, { status: 400, headers: CORS });

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
      'INSERT INTO scores (player_name, country_code, mode, score, words) VALUES (?, ?, ?, ?, ?)'
    ).bind(name, countryCode, mode, score, wordsJson).run();

    // Rank = number of players whose best score beats this one, + 1
    const { rank } = await env.DB.prepare(`
      SELECT COUNT(*) + 1 AS rank
      FROM (
        SELECT player_name, MAX(score) AS top
        FROM scores WHERE mode = ?
        GROUP BY player_name
      )
      WHERE top > ?
    `).bind(mode, score).first();

    return Response.json({ ok: true, rank }, { headers: CORS });

  } catch (err) {
    console.error(err);
    return Response.json({ error: 'Server error' }, { status: 500, headers: CORS });
  }
}
