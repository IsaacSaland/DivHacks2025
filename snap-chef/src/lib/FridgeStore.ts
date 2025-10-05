// src/lib/FridgeStore.ts
import { Preferences } from '@capacitor/preferences';

export type IngredientType =
  | 'protein' | 'vegetable' | 'fruit' | 'dairy' | 'grain'
  | 'baking'  | 'sweet'     | 'nut'   | 'seafood' | 'legume' | 'greens' | 'other';

export type FridgeMap = Record<string, IngredientType>; // normalized name -> type

const KEY = 'fridgeMapV1';

export async function saveFridgeMap(map: FridgeMap) {
  await Preferences.set({ key: KEY, value: JSON.stringify(map) });
}

export async function loadFridgeMap(): Promise<FridgeMap> {
  const res = await Preferences.get({ key: KEY });
  if (!res.value) return {};
  const parsed = JSON.parse(res.value);
  if (parsed && typeof parsed === 'object') return parsed;
  return {};
}
