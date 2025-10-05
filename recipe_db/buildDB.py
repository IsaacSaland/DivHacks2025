# buildDB.py
# Build a smaller foodcom.db (~100k recipes) from Food.com RAW_recipes.csv
# Fixes "datatype mismatch" by coercing ints and replacing NaN with None.
# Usage: python buildDB.py

import json, sqlite3, pandas as pd, ast, re
from pathlib import Path

# ---------- CONFIG ----------
MAX_RECIPES = 10_001
DATA = Path(".")
DB_PATH = Path("foodcom.db")

RAW_RECIPES = DATA / "RAW_recipes.csv"
INTERACTIONS_VAL = DATA / "interactions_validation.csv"
INTERACTIONS_TEST = DATA / "interactions_test.csv"

assert RAW_RECIPES.exists(), "RAW_recipes.csv not found in this folder."

if DB_PATH.exists():
    DB_PATH.unlink()

print(f"Building {DB_PATH} from {RAW_RECIPES} (limit={MAX_RECIPES:,}) …")

# ---------- SQLite connect + pragmas ----------
con = sqlite3.connect(DB_PATH)
cur = con.cursor()
cur.execute("PRAGMA foreign_keys=ON;")
cur.executescript("""
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;
PRAGMA temp_store=MEMORY;
PRAGMA cache_size=-20000;
""")

# ---------- Schema ----------
cur.executescript("""
CREATE TABLE recipes (
  id INTEGER PRIMARY KEY,
  name TEXT,
  minutes INTEGER,
  contributor_id INTEGER,
  submitted TEXT,
  n_steps INTEGER,
  steps TEXT,            -- JSON array string
  description TEXT,
  ingredients TEXT,      -- JSON array string
  n_ingredients INTEGER,
  tags TEXT              -- JSON array string
);
CREATE TABLE recipe_ingredients (
  recipe_id INTEGER,
  ingredient TEXT
);
CREATE INDEX idx_recipes_name   ON recipes(name);
CREATE INDEX idx_recipes_min    ON recipes(minutes);
CREATE INDEX idx_ri_ing         ON recipe_ingredients(ingredient);
CREATE INDEX idx_ri_rec         ON recipe_ingredients(recipe_id);

CREATE TABLE interactions (
  user_id INTEGER,
  recipe_id INTEGER,
  date TEXT,
  rating REAL,
  u INTEGER,
  i INTEGER,
  source TEXT
);
""")

# ---------- Helpers ----------
def as_int(v):
    """Return int(v) or None if missing/NaN/blank."""
    if pd.isna(v):
        return None
    try:
        return int(v)
    except Exception:
        try:
            # sometimes minutes etc. are floats like 30.0
            return int(float(v))
        except Exception:
            return None

def as_text(v):
    """Return string or '' for NaN."""
    if pd.isna(v):
        return ""
    s = str(v)
    return s

def parse_list_literal(s):
    s = as_text(s)
    try:
        if s.startswith('[') and s.endswith(']'):
            return ast.literal_eval(s)
    except Exception:
        pass
    return []

def normalize_ing(x: str) -> str:
    x = (x or "").strip().lower()
    x = re.sub(r'[_\\-]+', ' ', x)
    x = re.sub(r'\\s+', ' ', x)
    return x

# ---------- Load limited recipes ----------
print("Loading RAW_recipes.csv (limited) …")
usecols = [
    'id','name','minutes','contributor_id','submitted','n_steps',
    'steps','description','ingredients','n_ingredients','tags'
]
raw = pd.read_csv(RAW_RECIPES, usecols=usecols, nrows=MAX_RECIPES, low_memory=False)
print(f"Loaded {len(raw):,} recipe rows.")

# ---------- Insert recipes (NaN-safe) ----------
rows = []
for _, r in raw.iterrows():
    rows.append((
        as_int(r['id']),
        as_text(r['name']),
        as_int(r['minutes']),
        as_int(r['contributor_id']),
        as_text(r['submitted']),
        as_int(r['n_steps']),
        as_text(r['steps']),
        as_text(r['description']),
        as_text(r['ingredients']),
        as_int(r['n_ingredients']),
        as_text(r['tags']),
    ))

cur.executemany("""
INSERT INTO recipes (id,name,minutes,contributor_id,submitted,n_steps,steps,description,ingredients,n_ingredients,tags)
VALUES (?,?,?,?,?,?,?,?,?,?,?)
""", rows)
con.commit()

# ---------- Explode ingredients -> recipe_ingredients ----------
print("Exploding ingredients → recipe_ingredients …")
pairs = []
BATCH = 50_000

for rid, ing_json in zip(raw['id'], raw['ingredients']):
    items = parse_list_literal(ing_json)
    for it in items:
        n = normalize_ing(str(it))
        if n:
            pairs.append((as_int(rid), n))
    if len(pairs) >= BATCH:
        cur.executemany("INSERT INTO recipe_ingredients (recipe_id, ingredient) VALUES (?,?)", pairs)
        con.commit()
        pairs.clear()

if pairs:
    cur.executemany("INSERT INTO recipe_ingredients (recipe_id, ingredient) VALUES (?,?)", pairs)
    con.commit()
    pairs.clear()

# ---------- Optional interactions (filtered to kept ids) ----------
kept_ids = set(int(i) for i in raw['id'].dropna().astype(int).tolist())

def load_interactions(path, source):
    if not path.exists():
        return
    print(f"Loading interactions from {path.name} (filtered) …")
    df = pd.read_csv(path, low_memory=False)
    cols = set(df.columns.str.lower())
    if 'recipe_id' in cols:
        df = df[df['recipe_id'].isin(kept_ids)]
    batch = []
    for _, rr in df.iterrows():
        batch.append((
            as_int(rr.get('user_id')),
            as_int(rr.get('recipe_id')),
            as_text(rr.get('date')),
            float(rr.get('rating')) if (('rating' in df.columns) and pd.notna(rr.get('rating'))) else None,
            as_int(rr.get('u')),
            as_int(rr.get('i')),
            source
        ))
        if len(batch) >= 100_000:
            cur.executemany("""
              INSERT INTO interactions (user_id, recipe_id, date, rating, u, i, source)
              VALUES (?,?,?,?,?,?,?)
            """, batch)
            con.commit()
            batch.clear()
    if batch:
        cur.executemany("""
          INSERT INTO interactions (user_id, recipe_id, date, rating, u, i, source)
          VALUES (?,?,?,?,?,?,?)
        """, batch)
        con.commit()

load_interactions(INTERACTIONS_VAL, "validation")
load_interactions(INTERACTIONS_TEST, "test")

# ---------- Analyze ----------
cur.executescript("ANALYZE;")

# ---------- Report ----------
counts = {
    "recipes": cur.execute("SELECT COUNT(*) FROM recipes").fetchone()[0],
    "recipe_ingredients": cur.execute("SELECT COUNT(*) FROM recipe_ingredients").fetchone()[0],
    "interactions": cur.execute("SELECT COUNT(*) FROM interactions").fetchone()[0],
}
print("Built foodcom.db (limited)")
print(json.dumps(counts, indent=2))

con.close()
