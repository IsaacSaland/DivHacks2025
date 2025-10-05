// server.js — MUST & EXCLUDE fixed, lowercase matching, context-guarded; fast ranking via token index.
const express = require('express');
const Database = require('better-sqlite3');
const cors = require('cors');
const path = require('path');

const DB_PATH = path.join(__dirname, 'foodcom.db');
const db = new Database(DB_PATH, { fileMustExist: true });

const app = express();
app.use(cors());
app.use(express.json());

// ---------- helpers ----------
const norm = (s) => String(s || '').toLowerCase().trim();
const arr  = (v) => (Array.isArray(v) ? v : []);
const uniq = (xs) => Array.from(new Set(xs));
const placeholders = (n) => Array.from({ length: n }, () => '?').join(', ');

function tableExists(name) {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name=?").get(name);
}
function columnsOf(table) {
  return db.prepare(`PRAGMA table_info('${table}')`).all().map(r => r.name);
}
function pickCol(table, candidates, required = false) {
  const cols = columnsOf(table);
  for (const c of candidates) if (cols.includes(c)) return c;
  if (required) throw new Error(`Missing column in ${table}: tried ${candidates.join(', ')}`);
  return null;
}
function jsonLoose(x) {
  try { return JSON.parse(x); } catch {
    try { return JSON.parse(String(x||'').replace(/'/g, '"')); } catch { return null; }
  }
}

// Variant expansion for pantry terms (plural/underscore/space)
function expandVariants(tokens) {
  const out = new Set();
  for (const raw of tokens) {
    const t = norm(raw);
    if (!t) continue;
    out.add(t);
    out.add(t.replace(/[_-]/g, ' '));
    out.add(t.replace(/ /g, '_'));
    if (t.endsWith('ies')) out.add(t.slice(0, -3) + 'y');
    if (t.endsWith('ses')) out.add(t.slice(0, -2));
    if (t.endsWith('es'))  out.add(t.slice(0, -2));
    if (t.endsWith('s'))   out.add(t.slice(0, -1));
    out.add(t + 's');
    if (t.endsWith('y')) out.add(t.slice(0, -1) + 'ies');
    if (t.endsWith('o')) out.add(t + 'es');
  }
  return Array.from(out);
}

// ---------- schema detection ----------
if (!tableExists('recipes')) throw new Error("recipes table not found");
const RID   = pickCol('recipes', ['id','i','recipe_id'], true);
const RNAME = pickCol('recipes', ['name','title']) || 'name';
const RMIN  = pickCol('recipes', ['minutes','time','total_minutes','cook_time']); // optional
const RINGS = pickCol('recipes', ['ingredients']);
const RSTEPS= pickCol('recipes', ['steps','directions']);
const RDESCR= pickCol('recipes', ['description','desc','summary']);
const HAS_MINUTES = !!RMIN;

const HAS_RI      = tableExists('recipe_ingredients');
let RI_RECIPE_ID = 'recipe_id';
let RI_ING       = 'ingredient';
if (HAS_RI) {
  RI_RECIPE_ID = pickCol('recipe_ingredients', ['recipe_id','rid','id'], true);
  RI_ING       = pickCol('recipe_ingredients', ['ingredient','ing','item'], true);
}
console.log('[schema]', { RID, RNAME, RMIN, HAS_MINUTES, HAS_RI, RI_RECIPE_ID, RI_ING });

// ---------- token index (ranking only) ----------
function ensureTokenIndex() {
  db.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA synchronous=NORMAL;

    CREATE TABLE IF NOT EXISTS recipe_ing_tokens (
      recipe_id INTEGER NOT NULL,
      token TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tokens_token  ON recipe_ing_tokens(token);
    CREATE INDEX IF NOT EXISTS idx_tokens_recipe ON recipe_ing_tokens(recipe_id);

    CREATE TABLE IF NOT EXISTS recipe_token_counts (
      recipe_id INTEGER PRIMARY KEY,
      tok_total INTEGER NOT NULL
    );
  `);

  const hasAny = !!db.prepare(`SELECT 1 FROM recipe_ing_tokens LIMIT 1`).get();
  if (hasAny) {
    db.exec(`
      DELETE FROM recipe_token_counts;
      INSERT INTO recipe_token_counts (recipe_id, tok_total)
      SELECT recipe_id, COUNT(DISTINCT token)
      FROM recipe_ing_tokens
      GROUP BY recipe_id;
    `);
    return;
  }

  console.log('[tokenize] populating tokens… (one-time)');
  const tok = (s) => String(s||'').toLowerCase().replace(/[_-]/g,' ').match(/[a-z]+/g) || [];

  const rows = db.prepare(`SELECT ${RID} AS id ${RINGS ? `, ${RINGS} AS ings` : ''} FROM recipes`).all();
  const insTok = db.prepare(`INSERT INTO recipe_ing_tokens (recipe_id, token) VALUES (?, ?)`);
  const selRi  = HAS_RI
    ? db.prepare(`SELECT ${RI_ING} AS ing FROM recipe_ingredients WHERE ${RI_RECIPE_ID} = ?`)
    : null;

  const tx = db.transaction(() => {
    for (const row of rows) {
      const id = row.id;
      let items = [];
      if (HAS_RI) {
        items = selRi.all(id).map(r => r.ing);
      } else if (RINGS) {
        const parsed = typeof row.ings === 'string' ? jsonLoose(row.ings) : row.ings;
        items = Array.isArray(parsed) ? parsed.map(String)
              : String(row.ings||'').split(/\n|•|;|,/g).map(s=>s.trim()).filter(Boolean);
      }
      const set = new Set();
      for (const it of items) tok(it).forEach(t => set.add(t));
      for (const t of set) insTok.run(id, t);
    }
    db.exec(`
      DELETE FROM recipe_token_counts;
      INSERT INTO recipe_token_counts (recipe_id, tok_total)
      SELECT recipe_id, COUNT(DISTINCT token)
      FROM recipe_ing_tokens
      GROUP BY recipe_id;
    `);
  });

  tx();
  console.log('[tokenize] done ✔');
}
ensureTokenIndex();

// Context guard to prevent e.g. "garlic" matching "garlic powder"
const DISALLOWED_FOLLOW = [
  ' powder',' broth',' stock',' bouillon',' extract',' seasoning',' sauce',' mix',' gravy',' condensed'
];

// Forgivable tokens for penalty (don’t count as matches; just don’t penalize)
const FORGIVABLE = [
  'salt','pepper','olive','oil','vegetable','butter','sugar','garlic','onion','vinegar',
  'soy','sauce','ketchup','mustard','mayonnaise','lemon','lime','water','stock','broth',
  'flour','baking','powder','soda','tomato','paste','sauce','vanilla','extract','cocoa','yeast','honey'
];
const MODIFIERS = [
  'fresh','dried','ground','large','small','medium','chopped','minced','diced','sliced','shredded','grated',
  'peeled','seeded','boneless','skinless','red','yellow','green','brown','semi','sweet','all','purpose'
];

// --- MUST where (context-guarded, lowercased) ---
function buildMustWhere(rawTerms) {
  if (!rawTerms.length || !HAS_RI) return { clause: '1=1', params: [] };
  const pieces = [];
  const params = [];
  for (const base of rawTerms) {
    const vars = expandVariants([base]).map(norm);
    const orParts = [];
    for (const v of vars) {
      const nots = DISALLOWED_FOLLOW
        .map(f => `LOWER(ri.${RI_ING}) NOT LIKE '%' || ? || '${f.replace(/'/g,"''")}%'`)
        .join(' AND ');
      orParts.push(`(LOWER(ri.${RI_ING}) LIKE '%' || ? || '%' AND ${nots})`);
      params.push(v, ...DISALLOWED_FOLLOW.map(() => v));
    }
    pieces.push(`EXISTS (SELECT 1 FROM recipe_ingredients ri WHERE ri.${RI_RECIPE_ID}=r.${RID} AND (${orParts.join(' OR ')}))`);
  }
  return { clause: pieces.join(' AND '), params };
}

// --- OPTIONAL match CTE (count, context-guarded) ---
function buildOptCTE(rawTerms) {
  if (!rawTerms.length || !HAS_RI) return { cte: `, opt_hits AS (SELECT NULL AS recipe_id, 0 AS matched WHERE 1=0)`, params: [] };
  const params = [];
  const orExpr = rawTerms.map(base => {
    const vars = expandVariants([base]).map(norm);
    const inner = vars.map(v => {
      const nots = DISALLOWED_FOLLOW
        .map(f => `LOWER(ri.${RI_ING}) NOT LIKE '%' || ? || '${f.replace(/'/g,"''")}%'`)
        .join(' AND ');
      params.push(v, ...DISALLOWED_FOLLOW.map(() => v));
      return `(LOWER(ri.${RI_ING}) LIKE '%' || ? || '%' AND ${nots})`;
    }).join(' OR ');
    return `(${inner})`;
  }).join(' OR ');
  const cte = `
    , opt_hits AS (
        SELECT ri.${RI_RECIPE_ID} AS recipe_id, COUNT(DISTINCT LOWER(ri.${RI_ING})) AS matched
        FROM recipe_ingredients ri
        WHERE ${orExpr}
        GROUP BY ri.${RI_RECIPE_ID}
      )`;
  return { cte, params };
}

// --- EXCLUDE where (lowercased, broad) ---
function buildExcludeWhere(rawTerms) {
  if (!rawTerms.length || !HAS_RI) return { clause: '1=1', params: [] };
  const vars = expandVariants(rawTerms).map(norm);
  const ors  = vars.map(() => `LOWER(ri.${RI_ING}) LIKE '%' || ? || '%'`).join(' OR ');
  return {
    clause: `NOT EXISTS (SELECT 1 FROM recipe_ingredients ri WHERE ri.${RI_RECIPE_ID}=r.${RID} AND (${ors}))`,
    params: vars
  };
}

app.get('/health', (req, res) => {
  const c = db.prepare(`SELECT COUNT(*) AS c FROM recipes`).get().c;
  res.json({ ok: true, recipes: c, hasMinutes: !!RMIN, hasRI: HAS_RI });
});

// Body: { must[], optional[], exclude[], limit?, offset?, sort? }
app.post('/search', (req, res) => {
  const mustRaw = uniq(arr(req.body.must).map(norm).filter(Boolean));
  const optRaw  = uniq(arr(req.body.optional).map(norm).filter(Boolean));
  const excRaw  = uniq(arr(req.body.exclude).map(norm).filter(Boolean));

  const limit  = Math.min(Math.max(parseInt(req.body.limit ?? 50), 1), 200);
  const offset = Math.max(parseInt(req.body.offset ?? 0), 0);
  let sort = req.body.sort || 'match';
  if (!RMIN && (sort === 'time_asc' || sort === 'time_desc')) sort = 'match';

  // Allowed universe for "outside" penalty (ranking only)
  let allowedAll = uniq([...expandVariants([...mustRaw, ...optRaw]).map(norm), ...FORGIVABLE, ...MODIFIERS]);

  // WHERE parts
  let where = '1=1', whereParams = [];
  let excludeWhere = '1=1', excludeParams = [];
  if (HAS_RI) {
    const m = buildMustWhere(mustRaw);
    where = m.clause; whereParams = m.params;

    const ex = buildExcludeWhere(excRaw);
    excludeWhere = ex.clause; excludeParams = ex.params;
  } else {
    // Token fallback (rare)
    const mvars = expandVariants(mustRaw);
    where = mvars.length
      ? mvars.map(() => `EXISTS (SELECT 1 FROM recipe_ing_tokens t WHERE t.recipe_id=r.${RID} AND t.token IN (?))`).join(' AND ')
      : '1=1';
    whereParams = mvars.length ? mvars : [];
    const evars = expandVariants(excRaw);
    excludeWhere = evars.length
      ? `NOT EXISTS (SELECT 1 FROM recipe_ing_tokens t WHERE t.recipe_id=r.${RID} AND t.token IN (${placeholders(evars.length)}))`
      : '1=1';
    excludeParams = evars;
  }

  // Sorting
  let order = `ORDER BY missing_penalty ASC, must_matched DESC, opt_matched DESC, ${RMIN ? `minutes IS NULL, minutes ASC,` : ''} name ASC`;
  if (RMIN && sort === 'time_asc')  order = `ORDER BY minutes IS NULL, minutes ASC, missing_penalty ASC, name ASC`;
  if (RMIN && sort === 'time_desc') order = `ORDER BY minutes IS NULL, minutes DESC, missing_penalty ASC, name ASC`;

  // Optional hits CTE
  const opt = buildOptCTE(optRaw);

  const sql = `
    WITH base AS (
      SELECT r.${RID} AS id,
             COALESCE(r.${RNAME}, '') AS name
             ${RMIN ? `, r.${RMIN} AS minutes` : `, NULL AS minutes`}
      FROM recipes r
      WHERE ${where} AND ${excludeWhere}
    )
    ${opt.cte}
    , tok_counts AS (
        SELECT b.id, c.tok_total
        FROM base b
        JOIN recipe_token_counts c ON c.recipe_id = b.id
      )
    , outside AS (
        SELECT b.id, COUNT(DISTINCT t.token) AS outside_count
        FROM base b
        JOIN recipe_ing_tokens t ON t.recipe_id = b.id
        WHERE t.token NOT IN (${placeholders(allowedAll.length)})
        GROUP BY b.id
      )
    , must_hits AS (
        SELECT b.id, ${mustRaw.length ? `${mustRaw.length}` : `0`} AS matched
        FROM base b
    )
    , joined AS (
        SELECT b.id, b.name, b.minutes,
               mh.matched            AS must_matched,
               COALESCE(oh.matched,0) AS opt_matched,
               COALESCE(o.outside_count,0) AS missing_penalty
        FROM base b
        LEFT JOIN must_hits mh ON mh.id = b.id
        LEFT JOIN opt_hits  oh ON oh.recipe_id = b.id
        LEFT JOIN outside   o  ON o.id = b.id
      )
    SELECT id, name, minutes, must_matched, opt_matched, 0 AS subs_matched, missing_penalty
    FROM joined
    ${order}
    LIMIT ? OFFSET ?;
  `;

  const params = [
    ...whereParams,
    ...excludeParams,
    ...opt.params,
    ...allowedAll,
    limit, offset
  ];

  try {
    const rows = db.prepare(sql).all(...params);
    rows.forEach(r => { if (!r.name || !String(r.name).trim()) r.name = `Recipe #${r.id}`; });
    res.json(rows);
  } catch (e) {
    console.error('[search] SQL error:', e.message);
    res.status(500).json({ error: 'search_failed', message: e.message });
  }
});

app.get('/recipe/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad_id' });

  const row = db.prepare(`
    SELECT ${RID} AS id,
           COALESCE(${RNAME}, '') AS name
           ${RMIN ? `, ${RMIN} AS minutes` : `, NULL AS minutes`}
           ${RDESCR ? `, ${RDESCR} AS description` : `, NULL AS description`}
           ${RSTEPS ? `, ${RSTEPS} AS steps` : `, NULL AS steps`}
           ${RINGS ? `, ${RINGS} AS ings` : `, NULL AS ings`}
    FROM recipes WHERE ${RID} = ?
  `).get(id);
  if (!row) return res.status(404).json({ error: 'not_found' });

  let ingredients = [];
  if (HAS_RI) {
    ingredients = db.prepare(`SELECT ${RI_ING} AS ingredient FROM recipe_ingredients WHERE ${RI_RECIPE_ID}=? ORDER BY rowid`)
      .all(id).map(r => r.ingredient);
  } else if (row.ings) {
    const parsed = typeof row.ings === 'string' ? jsonLoose(row.ings) : row.ings;
    if (Array.isArray(parsed)) ingredients = parsed.map(String);
    else {
      const txt = String(row.ings||'');
      ingredients = (txt.includes('\n') ? txt.split(/\n+/) : txt.split(/•|;|,/)).map(s=>s.trim()).filter(Boolean);
    }
  }

  let steps = [];
  if (row.steps) {
    const parsed = typeof row.steps === 'string' ? jsonLoose(row.steps) : row.steps;
    steps = Array.isArray(parsed)
      ? parsed.map(String)
      : String(row.steps||'').split(/\n+|\.\s+/).map(s=>s.trim()).filter(Boolean);
  }

  res.json({
    id: row.id,
    name: row.name || `Recipe #${row.id}`,
    minutes: row.minutes ?? null,
    description: row.description ?? null,
    ingredients,
    steps,
    tags: []
  });
});

const PORT = process.env.PORT || 5050;
app.listen(PORT, () => console.log(`Food.com API on http://localhost:${PORT}`));
