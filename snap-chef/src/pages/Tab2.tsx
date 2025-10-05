import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  IonContent, IonHeader, IonPage, IonTitle, IonToolbar,
  IonList, IonItem, IonLabel, IonAvatar, IonChip, IonBadge,
  IonSpinner, IonModal, IonIcon, IonButtons, IonButton
} from '@ionic/react';
import { informationCircleOutline, closeOutline } from 'ionicons/icons';
import { loadFridgeMap } from '../lib/FridgeStore';
import './Tab2.css';

const API_BASE = 'http://localhost:5050';

type TriState = 'opt' | 'must' | 'exc';
type SortMode = 'match' | 'time_asc' | 'time_desc';

type SearchRow = {
  id: number; name: string; minutes: number | null;
  must_matched: number; opt_matched: number; subs_matched: number;
  missing_penalty: number;
};
type RecipeDetail = {
  id: number; name: string; minutes: number | null; description: string | null;
  steps: string[]; ingredients: string[]; tags: string[];
};

const normalize = (s?: string | null) => (s || '').toLowerCase().trim();

const INCOMING_PANTRY_TYPES: Record<string, string> = {
  chicken: 'protein', broccoli: 'vegetable', milk: 'dairy', fish: 'protein',
  rice: 'grain', egg: 'protein', tomato: 'vegetable', cheese: 'dairy',
  pasta: 'grain', beef: 'protein', potato: 'vegetable', yogurt: 'dairy',
  bread: 'grain', carrot: 'vegetable', pork: 'protein', spinach: 'vegetable',
  pecan: 'nut', almond: 'nut', walnut: 'nut', chocolate: 'sweet',
  flour: 'baking', sugar: 'baking',
};

const Menu: React.FC = () => {
  const [pantryTypes, setPantryTypes] = useState<Record<string, string>>({});

  useEffect(() => {
    (async () => {
      const map = await loadFridgeMap();
      if (!map || Object.keys(map).length === 0) {
        // fallback if user hasn’t scanned yet
        setPantryTypes({
          chicken: 'protein',
          broccoli: 'vegetable',
          milk: 'dairy',
          rice: 'grain',
          egg: 'protein',
        });
      } else {
        setPantryTypes(map);
      }
    })();
  }, []);

  const [pantryState, setPantryState] = useState<Record<string, TriState>>(
    Object.fromEntries(Object.keys(pantryTypes).map((name) => [name, 'opt']))
  );

  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<SearchRow[]>([]);
  const [selected, setSelected] = useState<RecipeDetail | null>(null);
  const [sort, setSort] = useState<SortMode>('match');

  const pantryList = useMemo(
    () => Object.keys(pantryTypes).map((name) => ({ name, type: pantryTypes[name], state: pantryState[name] })),
    [pantryTypes, pantryState]
  );

  const must = useMemo(() => pantryList.filter(p => p.state === 'must').map(p => p.name), [pantryList]);
  const optional = useMemo(() => pantryList.filter(p => p.state === 'opt').map(p => p.name), [pantryList]);
  const exclude = useMemo(() => pantryList.filter(p => p.state === 'exc').map(p => p.name), [pantryList]);

  function onChipClick(name: string) {
    setPantryState(prev => {
      const cur = prev[name] || 'opt';
      const next: TriState = cur === 'opt' ? 'must' : cur === 'must' ? 'exc' : 'opt';
      return { ...prev, [name]: next };
    });
  }
  function onToggleSort() {
    setSort(prev => prev === 'match' ? 'time_asc' : prev === 'time_asc' ? 'time_desc' : 'match');
  }

  const deb = useRef<number | null>(null);
  useEffect(() => {
    if (deb.current) window.clearTimeout(deb.current);
    deb.current = window.setTimeout(() => { runSearch(); }, 200);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pantryState, sort]);
  useEffect(() => { runSearch(); }, []);

  async function runSearch() {
    setLoading(true);
    setRows([]);
    try {
      const r = await fetch(`${API_BASE}/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ must, optional, exclude, sort, limit: 50 })
      });
      const data: SearchRow[] = await r.json();
      setRows(data);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  async function openDetail(id: number) {
    try {
      const r = await fetch(`${API_BASE}/recipe/${id}`);
      const data: RecipeDetail = await r.json();
      setSelected(data);
    } catch (e) { console.error(e); }
  }

  const sortLabel = sort === 'match' ? 'Sort: Match' : sort === 'time_asc' ? 'Time ↑' : 'Time ↓';

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Menu (Food.com)</IonTitle>
          <IonButtons slot="end"><IonButton onClick={onToggleSort}>{sortLabel}</IonButton></IonButtons>
        </IonToolbar>
      </IonHeader>

      <IonContent fullscreen>
        <IonHeader collapse="condense"><IonToolbar><IonTitle size="large">Menu</IonTitle></IonToolbar></IonHeader>

        <div className="ion-padding" style={{ display: 'grid', gap: 8 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {pantryList.map(({ name, type, state }) => {
              const color = state === 'must' ? 'success' : state === 'exc' ? 'danger' : 'warning';
              const outline = state === 'opt';
              const label = state === 'must' ? 'Must' : state === 'exc' ? 'Exclude' : 'Optional';
              return (
                <IonChip key={name} color={color as any} outline={outline} onClick={() => onChipClick(name)} style={{ userSelect: 'none' }}>
                  {name}
                  <IonBadge color={color as any} style={{ marginLeft: 6 }}>{label}</IonBadge>
                  <IonBadge color="light" style={{ marginLeft: 6 }}>{type}</IonBadge>
                </IonChip>
              );
            })}
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', color: 'var(--ion-color-medium)' }}>
            <IonIcon icon={informationCircleOutline} />
            <small>
              Click to cycle: Optional → Must → Exclude → Optional<br></br>
              You are assumed to have many basic ingredients (salt, sugar, flour, spices, etc.) on hand.
            </small>
          </div>
        </div>

        {loading ? (
          <div className="ion-padding" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <IonSpinner name="lines" /> Searching recipes…
          </div>
        ) : (
          <IonList>
            {rows.map((r) => (
              <IonItem key={r.id} button detail onClick={() => openDetail(r.id)}>
                <IonLabel>
                  <h2>{r.name || `Recipe #${r.id}`}</h2>
                  <p>
                    {r.minutes ? `${r.minutes} min • ` : ''}Missing: <b>{r.missing_penalty}</b> •
                    Must: <b>{r.must_matched}</b> • Optional: <b>{r.opt_matched}</b>
                  </p>
                </IonLabel>
              </IonItem>
            ))}
            {!loading && rows.length === 0 && (
              <div className="ion-padding">No matches — try removing some <b>Exclude</b> items or reducing <b>Must</b>.</div>
            )}
          </IonList>
        )}

        <IonModal isOpen={!!selected} onDidDismiss={() => setSelected(null)}>
          <IonHeader>
            <IonToolbar>
              <IonTitle>{selected?.name || 'Recipe'}</IonTitle>
              <div slot="end" style={{ paddingRight: 8 }}>
                <IonIcon icon={closeOutline} onClick={() => setSelected(null)} style={{ fontSize: 22, cursor: 'pointer' }} />
              </div>
            </IonToolbar>
          </IonHeader>
          <IonContent className="ion-padding">
            {!selected ? (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><IonSpinner /> Loading…</div>
            ) : (
              <>
                <h2>Ingredients</h2>
                <ul>{selected.ingredients?.map((ing, i) => <li key={i}>{(ing || '').toString()}</li>)}</ul>
                {selected.steps?.length ? (
                  <>
                    <h2 style={{ marginTop: 16 }}>Instructions</h2>
                    <ol style={{ lineHeight: 1.6 }}>
                      {selected.steps.map((s, i) => <li key={i}>{s}</li>)}
                    </ol>
                  </>
                ) : null}
              </>
            )}
          </IonContent>
        </IonModal>
      </IonContent>
    </IonPage>
  );
};

export default Menu;
