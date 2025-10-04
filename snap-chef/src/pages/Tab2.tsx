import React, {useEffect, useMemo, useState} from 'react';
import { IonContent, IonHeader, IonPage, IonTitle, IonToolbar, IonList, IonItem, IonLabel, IonAvatar, IonButtons, IonButton, IonIcon, IonChip, IonBadge, IonSearchbar, IonSpinner, IonModal} from '@ionic/react';
import {refreshOutline, informationCircleOutline, closeOutline} from 'ionicons/icons';
import './Tab2.css';

// config stuff
const MEALDB_BASE = 'https://www.themealdb.com/api/json/v1/1';
const filterByIng = (ing: string) => `${MEALDB_BASE}/filter.php?i=${encodeURIComponent(ing)}`;
const lookupById = (id: string) => `${MEALDB_BASE}/lookup.php?i=${encodeURIComponent(id)}`;

const MUST_THRESHOLD = 4;

// ingredient stuff
const INITIAL_INGREDIENTS: Record<string, number> = {
  chicken: 3,
  garlic: 3,
  milk: 3,
  fish: 3,
};

// allow exclusion of most condiments and stuff
const FORGIVABLE = new Set<string>([
  'salt','pepper','olive oil','vegetable oil','butter','sugar','garlic','onion','paprika',
  'chili powder','cumin','oregano','basil','thyme','vinegar','soy sauce','ketchup','mustard',
  'mayonnaise','lemon','lime','water'
]);

// types
type MealSummary = { idMeal: string; strMeal: string; strMealThumb?: string };
type MealDetail = { idMeal: string; strMeal: string; strMealThumb?: string; strInstructions?: string; [k: string]: any };
type ScoredMeal = {
  summary: MealSummary;
  missingPenalty: number;
  matchedMust: number;
  matchedOptional: number;
};

// helpers
const normalize = (s?: string | null) => (s || '').toLowerCase().trim();

function ingredientsFromDetail(meal: MealDetail): string[] {
  const out: string[] = [];
  for (let i = 1; i <= 20; i++) {
    const ing = normalize(meal[`strIngredient${i}`]);
    if (ing) out.push(ing);
  }
  return out;
}

function measuresFromDetail(meal: MealDetail): Array<{ ingredient: string; measure: string }> {
  const rows: Array<{ ingredient: string; measure: string }> = [];
  for (let i = 1; i <= 20; i++) {
    const ing = normalize(meal[`strIngredient${i}`]);
    const meas = (meal[`strMeasure${i}`] || '').toString().trim();
    if (ing) rows.push({ ingredient: ing, measure: meas });
  }
  return rows;
}

async function fetchMealsForIngredient(ing: string): Promise<MealSummary[]> {
  const res = await fetch(filterByIng(ing));
  const json = await res.json();
  return (json?.meals || []) as MealSummary[];
}

async function fetchMealDetail(idMeal: string): Promise<MealDetail | null> {
  const res = await fetch(lookupById(idMeal));
  const json = await res.json();
  return (json?.meals?.[0] as MealDetail) ?? null;
}

// page
const Menu: React.FC = () => {
  const [pantryMap] = useState<Record<string, number>>(INITIAL_INGREDIENTS); // replace with real state later
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<ScoredMeal[]>([]);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selected, setSelected] = useState<MealDetail | null>(null);

  const pantryList = useMemo(
    () =>
      Object.entries(pantryMap)
        .map(([name, score]) => ({ name: name.toLowerCase(), score }))
        .sort((a, b) => b.score - a.score),
    [pantryMap]
  );
  const filteredPantryList = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return pantryList;
    return pantryList.filter(p => p.name.includes(q));
  }, [pantryList, search]);

  const mustIngredients = useMemo(
    () => pantryList.filter(p => p.score >= MUST_THRESHOLD).map(p => p.name),
    [pantryList]
  );
  const optionalIngredients = useMemo(
    () => pantryList.filter(p => p.score < MUST_THRESHOLD).map(p => p.name),
    [pantryList]
  );

  async function runSearch() {
    setLoading(true);
    setResults([]);
    try {
      const drivers = mustIngredients.length > 0 ? mustIngredients : pantryList.slice(0, 3).map(p => p.name);
      if (drivers.length === 0) {
        setResults([]);
        return;
      }

      // Pull candidate lists for driver ingredients
      const lists = await Promise.all(drivers.map(fetchMealsForIngredient));

      // Intersect if we have MUSTs; otherwise take union
      const counts: Record<string, number> = {};
      const byId: Record<string, MealSummary> = {};
      lists.forEach(list => list.forEach(m => {
        counts[m.idMeal] = (counts[m.idMeal] || 0) + 1;
        byId[m.idMeal] = m;
      }));

      let candidateIds: string[];
      if (mustIngredients.length > 0) {
        const need = lists.length;
        candidateIds = Object.keys(counts).filter(id => counts[id] === need);
      } else {
        candidateIds = Object.keys(counts);
      }

      // Fetch details for scoring
      const details = await Promise.all(candidateIds.map(fetchMealDetail));
      const valid = details.filter(Boolean) as MealDetail[];

      const pantryNames = new Set(pantryList.map(p => p.name));
      const mustSet = new Set(mustIngredients);

      const scored: ScoredMeal[] = valid.map(meal => {
        const recipeIngs = ingredientsFromDetail(meal);
        const recipeSet = new Set(recipeIngs);

        // Hard requirement: recipe must include all MUST ingredients
        const missingMust = mustIngredients.filter(m => !recipeSet.has(m));
        if (missingMust.length) return null;

        let missingPenalty = 0;
        let matchedMust = 0;
        let matchedOptional = 0;

        for (const ing of recipeIngs) {
          if (pantryNames.has(ing)) {
            if (mustSet.has(ing)) matchedMust++;
            else matchedOptional++;
          } else if (!FORGIVABLE.has(ing)) {
            missingPenalty++;
          }
        }

        const summary = byId[meal.idMeal] || { idMeal: meal.idMeal, strMeal: meal.strMeal, strMealThumb: meal.strMealThumb };
        return { summary, missingPenalty, matchedMust, matchedOptional };
      }).filter(Boolean) as ScoredMeal[];

      // Sort best-first
      scored.sort((a, b) =>
        a.missingPenalty !== b.missingPenalty ? a.missingPenalty - b.missingPenalty :
        a.matchedMust !== b.matchedMust ? b.matchedMust - a.matchedMust :
        a.matchedOptional !== b.matchedOptional ? b.matchedOptional - a.matchedOptional :
        a.summary.strMeal.localeCompare(b.summary.strMeal)
      );

      setResults(scored);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  async function openDetail(mealId: string) {
    setDetailOpen(true);
    setSelected(null);
    const d = await fetchMealDetail(mealId);
    setSelected(d);
  }

  useEffect(() => {
    runSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Menu</IonTitle>
          <IonButtons slot="end">
            <IonButton onClick={runSearch}>
              <IonIcon icon={refreshOutline} slot="start" />
              Refresh
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <IonContent fullscreen>
        <IonHeader collapse="condense">
          <IonToolbar>
            <IonTitle size="large">Menu</IonTitle>
          </IonToolbar>
        </IonHeader>

        {/* Pantry overview */}
        <div className="ion-padding" style={{ display: 'grid', gap: 8 }}>
          <IonSearchbar
            value={search}
            debounce={150}
            onIonInput={(e) => setSearch(String(e.detail.value || ''))}
            placeholder="Filter pantry view (visual only)"
          />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {filteredPantryList.map(({ name, score }) => (
              <IonChip key={name} outline={score < MUST_THRESHOLD} color={score >= MUST_THRESHOLD ? 'success' : 'medium'}>
                {name}
                <IonBadge color={score >= MUST_THRESHOLD ? 'success' : 'light'} style={{ marginLeft: 6 }}>
                  {score}
                </IonBadge>
              </IonChip>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', color: 'var(--ion-color-medium)' }}>
            <IonIcon icon={informationCircleOutline} />
            <small>
              MUST ingredients are score ≥ {MUST_THRESHOLD}. Recipes must include all MUSTs. Missing condiments/spices are forgiven.
            </small>
          </div>
        </div>

        {/* Results */}
        {loading ? (
          <div className="ion-padding" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <IonSpinner name="lines" /> Searching recipes…
          </div>
        ) : (
          <IonList>
            {results.map((r) => (
              <IonItem key={r.summary.idMeal} button detail onClick={() => openDetail(r.summary.idMeal)}>
                <IonAvatar slot="start">
                  {/* eslint-disable-next-line jsx-a11y/alt-text */}
                  <img src={r.summary.strMealThumb || ''} />
                </IonAvatar>
                <IonLabel>
                  <h2>{r.summary.strMeal}</h2>
                  <p>
                    Missing penalty: <b>{r.missingPenalty}</b> • MUST matched: <b>{r.matchedMust}</b> • Optional matched:{' '}
                    <b>{r.matchedOptional}</b>
                  </p>
                </IonLabel>
              </IonItem>
            ))}
            {!loading && results.length === 0 && (
              <div className="ion-padding">No matches — try adding more pantry items or lowering MUST threshold.</div>
            )}
          </IonList>
        )}

        {/* Recipe details modal */}
        <IonModal isOpen={detailOpen} onDidDismiss={() => setDetailOpen(false)}>
          <IonHeader>
            <IonToolbar>
              <IonTitle>{selected?.strMeal || 'Recipe'}</IonTitle>
              <IonButtons slot="end">
                <IonButton onClick={() => setDetailOpen(false)}>
                  <IonIcon icon={closeOutline} slot="icon-only" />
                </IonButton>
              </IonButtons>
            </IonToolbar>
          </IonHeader>
          <IonContent className="ion-padding">
            {!selected ? (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <IonSpinner /> Loading…
              </div>
            ) : (
              <>
                {selected.strMealThumb && (
                  // eslint-disable-next-line jsx-a11y/alt-text
                  <img
                    src={selected.strMealThumb}
                    style={{ width: '100%', borderRadius: 12, marginBottom: 12, objectFit: 'cover', maxHeight: 260 }}
                  />
                )}
                <h2>Ingredients</h2>
                <ul>
                  {measuresFromDetail(selected).map((row, i) => (
                    <li key={i}>{row.measure ? `${row.measure} ` : ''}{row.ingredient}</li>
                  ))}
                </ul>
                {selected.strInstructions && (
                  <>
                    <h2 style={{ marginTop: 16 }}>Instructions</h2>
                    <p style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{selected.strInstructions}</p>
                  </>
                )}
              </>
            )}
          </IonContent>
        </IonModal>
      </IonContent>
    </IonPage>
  );
};

export default Menu;
