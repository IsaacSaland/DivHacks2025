import { IngredientType } from "./FridgeStore";

/** Map lots of label/word patterns → canonical ingredient + type */
export const ALIASES: Array<{ rx: RegExp; name: string; type: IngredientType }> = [
  // beef / steak
  { rx: /\b(steak|ribeye|rib eye|sirloin|t-bone|porterhouse|beef steak|filet mignon)\b/i, name: 'beef', type: 'protein' },
  { rx: /\b(ground\s*beef|minced\s*beef|beef mince|hamburger)\b/i, name: 'beef', type: 'protein' },

  // chicken
  { rx: /\b(chicken breast|chicken breasts|chicken tender|chicken thigh|chicken thighs|rotisserie chicken|chicken)\b/i, name: 'chicken', type: 'protein' },

  // pork
  { rx: /\b(pork|ham|bacon|prosciutto)\b/i, name: 'pork', type: 'protein' },

  // seafood
  { rx: /\b(salmon|tuna|cod|tilapia|trout)\b/i, name: 'fish', type: 'seafood' },
  { rx: /\b(shrimp|prawn)\b/i, name: 'shrimp', type: 'seafood' },

  // pantry carbs
  { rx: /\b(white rice|brown rice|jasmine rice|basmati rice|rice)\b/i, name: 'rice', type: 'grain' },
  { rx: /\b(pasta|spaghetti|penne|macaroni|noodles|lasagna)\b/i, name: 'pasta', type: 'grain' },
  { rx: /\b(bread|loaf|baguette|tortilla|naan|pita|roll)\b/i, name: 'bread', type: 'grain' },

  // veg
  { rx: /\b(broccoli)\b/i, name: 'broccoli', type: 'vegetable' },
  { rx: /\b(cauliflower)\b/i, name: 'cauliflower', type: 'vegetable' },
  { rx: /\b(carrot|carrots)\b/i, name: 'carrot', type: 'vegetable' },
  { rx: /\b(potato|potatoes)\b/i, name: 'potato', type: 'vegetable' },
  { rx: /\b(tomato|tomatoes)\b/i, name: 'tomato', type: 'vegetable' },
  { rx: /\b(onion|shallot)\b/i, name: 'onion', type: 'vegetable' },
  { rx: /\b(pepper|bell pepper|capsicum)\b/i, name: 'pepper', type: 'vegetable' },
  { rx: /\b(mushroom|portobello|shiitake|button mushroom)\b/i, name: 'mushroom', type: 'vegetable' },
  { rx: /\b(spinach|kale|arugula|lettuce)\b/i, name: 'spinach', type: 'greens' },
  { rx: /\b(cucumber)\b/i, name: 'cucumber', type: 'vegetable' },
  { rx: /\b(zucchini|courgette)\b/i, name: 'zucchini', type: 'vegetable' },

  // dairy / sweets / nuts
  { rx: /\b(cheese|parmesan|mozzarella|cheddar|feta|goat cheese)\b/i, name: 'cheese', type: 'dairy' },
  { rx: /\b(milk)\b/i, name: 'milk', type: 'dairy' },
  { rx: /\b(yogurt|yoghurt)\b/i, name: 'yogurt', type: 'dairy' },
  { rx: /\b(chocolate|cocoa)\b/i, name: 'chocolate', type: 'sweet' },
  { rx: /\b(almond|almonds|pecan|pecans|walnut|walnuts|cashew|peanut|nuts?)\b/i, name: 'nuts', type: 'nut' },

  // baking
  { rx: /\b(flour)\b/i, name: 'flour', type: 'baking' },
  { rx: /\b(sugar|brown sugar)\b/i, name: 'sugar', type: 'baking' },
];

export function aliasMatch(label: string): { name: string; type: IngredientType } | null {
  for (const a of ALIASES) if (a.rx.test(label)) return { name: a.name, type: a.type };
  return null;
}
