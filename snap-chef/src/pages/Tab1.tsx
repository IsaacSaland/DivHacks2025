// src/pages/Tab1.tsx
import React, { useEffect, useRef, useState } from 'react';
import {
  IonContent, IonHeader, IonPage, IonTitle, IonToolbar, IonButton, IonGrid,
  IonRow, IonCol, IonImg, IonLabel, IonChip, IonBadge, IonInput, IonIcon, IonSpinner
} from '@ionic/react';
import './Tab1.css';
import { Capacitor } from '@capacitor/core';
import * as tf from '@tensorflow/tfjs';
import '@tensorflow/tfjs-backend-webgl';
import * as mobilenet from '@tensorflow-models/mobilenet';
import * as cocoSsd from '@tensorflow-models/coco-ssd';
import Tesseract from 'tesseract.js';
import { saveFridgeMap, FridgeMap, IngredientType } from '../lib/FridgeStore';
import { addCircleOutline, trashOutline } from 'ionicons/icons';
import { useIonRouter } from '@ionic/react';

type CocoModel = cocoSsd.ObjectDetection | null;
type MobileModel = mobilenet.MobileNet | null;

const NORM = (s: string) => s.toLowerCase().trim().replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ');
const SING = (s: string) => s.replace(/ies\b/g, 'y').replace(/ses\b/g, 's').replace(/s\b/g, ''); // crude plural→singular

/** Typed forgivables: included when saving (hidden in UI) */
const FORGIVABLE_TYPES: Record<string, IngredientType> = {
  // baking / spices
  'salt':'baking','pepper':'baking','sugar':'baking','flour':'baking','baking powder':'baking','baking soda':'baking',
  'paprika':'baking','chili powder':'baking','cumin':'baking','oregano':'baking','basil':'baking','thyme':'baking',
  // produce
  'garlic':'vegetable','onion':'vegetable','lemon':'fruit','lime':'fruit','tomato paste':'vegetable','tomato sauce':'vegetable',
  // dairy / oils / condiments / misc
  'butter':'dairy','olive oil':'other','vegetable oil':'other','vinegar':'other','soy sauce':'other','ketchup':'other','mustard':'other',
  'mayonnaise':'other','stock':'other','broth':'other','water':'other',
};
const FORGIVABLE = Object.keys(FORGIVABLE_TYPES);

/** Map lots of label/word patterns → canonical ingredient + type */
const ALIASES: Array<{ rx: RegExp; name: string; type: IngredientType }> = [
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

function aliasMatch(label: string): { name: string; type: IngredientType } | null {
  for (const a of ALIASES) if (a.rx.test(label)) return { name: NORM(a.name), type: a.type };
  return null;
}

const Scanner: React.FC = () => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [photos, setPhotos] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [cocoModel, setCocoModel] = useState<CocoModel>(null);
  const [mobileModel, setMobileModel] = useState<MobileModel>(null);

  const [detecting, setDetecting] = useState(false);
  const [ocring, setOcring] = useState(false);

  /** Only non-forgivable items are displayed */
  const [detected, setDetected] = useState<FridgeMap>({});
  const [manualName, setManualName] = useState('');
  const [manualType, setManualType] = useState<IngredientType>('other');

  const router = useIonRouter();
  const platform = Capacitor.getPlatform();

  useEffect(() => () => stopCamera(), []);

  useEffect(() => {
    (async () => {
      try {
        await tf.setBackend('webgl');
        await tf.ready();
        const [coco, mobile] = await Promise.all([
          cocoSsd.load({ base: 'lite_mobilenet_v2' }),
          mobilenet.load({ version: 2, alpha: 1.0 }),
        ]);
        setCocoModel(coco);
        setMobileModel(mobile);
      } catch (e) {
        console.error(e);
        setError('Failed to initialize on-device models. You can still add items manually.');
      }
    })();
  }, []);

  const startCamera = async () => {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Live camera not supported on this device.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      streamRef.current = stream;
      if (videoRef.current) {
        // @ts-ignore
        videoRef.current.srcObject = stream;
        try { await videoRef.current.play(); } catch {}
      }
      setIsStreaming(true);
    } catch (err) {
      console.error(err);
      setError('Could not access camera. Check permissions.');
    }
  };

  const stopCamera = () => {
    try {
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
      if (videoRef.current) {
        videoRef.current.pause();
        // @ts-ignore
        videoRef.current.srcObject = null;
      }
    } catch {}
    setIsStreaming(false);
  };

  const captureFromVideo = () => {
    const video = videoRef.current;
    if (!video) return;
    const w = video.videoWidth || 640;
    const h = video.videoHeight || 480;
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, w, h);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
    setPhotos(p => [dataUrl, ...p]);
  };

  const handleFiles = (files: FileList | null) => {
    if (!files) return;
    Array.from(files).forEach(file => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const result = e.target?.result;
        if (typeof result === 'string') setPhotos(p => [result, ...p]);
      };
      reader.readAsDataURL(file);
    });
  };

  const removePhoto = (index: number) => setPhotos(p => p.filter((_, i) => i !== index));

  /** OCR one image and return normalized text */
  async function ocrImage(dataUrl: string): Promise<string> {
    const res = await Tesseract.recognize(dataUrl, 'eng', { logger: () => {} });
    return NORM(res.data.text || '');
  }

  /** Extract useful tokens from OCR text and map via ALIASES */
  function tokensToItems(text: string): Array<{ name: string; type: IngredientType }> {
    if (!text) return [];
    // keep bigrams/trigrams for phrases like "ground beef", "chicken breasts", "white rice"
    const keepPhrases = [
      /ground beef/, /white rice/, /brown rice/, /jasmine rice/, /basmati rice/,
      /chicken breast[s]?/, /chicken thigh[s]?/
    ];
    const out: Array<{ name: string; type: IngredientType }> = [];

    // phrase first
    keepPhrases.forEach(rx => {
      const m = text.match(rx);
      if (m) {
        const ali = aliasMatch(m[0]);
        if (ali) out.push(ali);
      }
    });

    // single-word sweep as a fallback
    const words = Array.from(new Set(text.split(/[^a-z]+/g).filter(Boolean))).slice(0, 200);
    for (const w of words) {
      const ali = aliasMatch(w);
      if (ali) out.push(ali);
    }
    return out;
  }

  /** Combine models + OCR into votes */
  const analyzePhotos = async () => {
    if (!cocoModel && !mobileModel) { setError('Models not loaded yet.'); return; }
    if (photos.length === 0) { setError('Add or capture at least one photo.'); return; }

    setError(null);
    setDetecting(true);
    setOcring(true);
    const votes: Record<string, number> = {};
    const types: Record<string, IngredientType> = {};

    try {
      // OCR first (best for packages)
      for (const dataUrl of photos) {
        try {
          const text = await ocrImage(dataUrl);
          const items = tokensToItems(text);
          for (const it of items) {
            const key = NORM(it.name);
            votes[key] = (votes[key] || 0) + 3;         // OCR gets strong vote
            types[key] = types[key] || it.type;
          }
        } catch {}
      }
      setOcring(false);

      // Vision models for fresh produce / raw cuts
      for (const dataUrl of photos) {
        const img = new Image();
        img.src = dataUrl;
        await new Promise(res => { img.onload = () => res(null); });

        // COCO SSD (object boxes) — very limited label set, but keep it
        if (cocoModel) {
          const dets = await cocoModel.detect(img);
          dets.forEach(d => {
            if (d.score >= 0.45) { // slightly lower threshold
              const ali = aliasMatch(d.class);
              if (ali) {
                const key = NORM(ali.name);
                votes[key] = (votes[key] || 0) + 1.5;
                types[key] = types[key] || ali.type;
              }
            }
          });
        }

        // MobileNet (image-level labels)
        if (mobileModel) {
          const preds = await mobileModel.classify(img, 8);
          preds.forEach(p => {
            if (p.probability >= 0.08) { // lower a bit to catch meat cuts
              const ali = aliasMatch(p.className || '');
              if (ali) {
                const key = NORM(ali.name);
                votes[key] = (votes[key] || 0) + 1;
                types[key] = types[key] || ali.type;
              }
            }
          });
        }
      }

      // Decide final picks
      const picks = Object.entries(votes)
        .filter(([, v]) => v >= 2.5) // needs at least one good signal (OCR or multiple weak signals)
        .sort((a, b) => b[1] - a[1])
        .map(([name]) => name);

      const out: FridgeMap = {};
      picks.forEach((name) => { out[name] = types[name] || 'other'; });
      setDetected(out);
    } catch (e) {
      console.error(e);
      setError('Image analysis failed. You can add items manually.');
    } finally {
      setDetecting(false);
      setOcring(false);
    }
  };

  const addManual = () => {
    const n = SING(NORM(manualName));
    if (!n) return;
    setDetected(prev => ({ ...prev, [n]: manualType }));
    setManualName('');
  };

  const removeDetected = (name: string) => {
    setDetected(prev => {
      const c = { ...prev };
      delete c[name];
      return c;
    });
  };

  const continueToRecipes = async () => {
    // Merge display items with typed forgivables (hidden in UI but saved with proper types)
    const merged: FridgeMap = { ...detected };
    FORGIVABLE.forEach(f => {
      const k = NORM(f);
      if (!merged[k]) merged[k] = FORGIVABLE_TYPES[k];
    });
    await saveFridgeMap(merged);
    (router as any).push?.('/menu', 'forward') ?? router.push('/menu');
  };

  const isForgivable = (name: string) => FORGIVABLE.includes(NORM(name));

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Scanner</IonTitle>
        </IonToolbar>
      </IonHeader>

      <IonContent fullscreen>
        <IonHeader collapse="condense">
          <IonToolbar>
            <IonTitle size="large">Scanner</IonTitle>
          </IonToolbar>
        </IonHeader>

        <div className="scanner-container">
          {/* Controls */}
          <div className="controls" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {Capacitor.getPlatform() === 'web' && (
              <>
                <IonButton onClick={startCamera} disabled={isStreaming}>Start Camera</IonButton>
                <IonButton onClick={stopCamera} disabled={!isStreaming}>Stop Camera</IonButton>
                <IonButton onClick={captureFromVideo} disabled={!isStreaming}>Capture Photo</IonButton>
              </>
            )}
            <IonButton onClick={() => fileInputRef.current?.click()}>Upload Images</IonButton>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              style={{ display: 'none' }}
              onChange={(e) => handleFiles(e.target.files)}
            />
            <IonButton
              color="tertiary"
              onClick={analyzePhotos}
              disabled={detecting || photos.length === 0 || (!cocoModel && !mobileModel)}
            >
              {(detecting || ocring) ? (<><IonSpinner name="lines" />&nbsp;Analyzing…</>) : 'Analyze Photos'}
            </IonButton>
          </div>

          {error && <div className="scanner-error">{error}</div>}

          {/* Live feed (web) */}
          {Capacitor.getPlatform() === 'web' && (
            <div className="video-wrap">
              <video
                ref={videoRef}
                className="scanner-video"
                playsInline
                muted
                style={{ width: '100%', maxHeight: 480, background: '#000' }}
              />
            </div>
          )}

          {/* Thumbnails */}
          <div className="thumbnails">
            <IonGrid>
              <IonRow>
                {photos.map((p, idx) => (
                  <IonCol size="6" sizeMd="4" key={idx} className="thumb-col">
                    <div className="thumb-card">
                      <IonImg src={p} alt={`photo-${idx}`} />
                      <button className="delete-btn" onClick={() => removePhoto(idx)} aria-label={`Delete photo ${idx}`} title="Delete photo">×</button>
                    </div>
                  </IonCol>
                ))}
                {photos.length === 0 && (
                  <IonCol>
                    <IonLabel>Upload a few clear photos of your fridge's contents.</IonLabel>
                  </IonCol>
                )}
              </IonRow>
            </IonGrid>
          </div>

          {/* Detected ingredients review — hides forgivables in UI, but saves them (typed) */}
          <div className="ion-padding" style={{ display: 'grid', gap: 10 }}>
            <h2>Detected Ingredients</h2>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {Object.entries(detected)
                .filter(([name]) => !isForgivable(name))
                .map(([name, type]) => (
                  <IonChip key={name} color="medium" outline style={{ userSelect: 'none' }}>
                    {name}
                    <IonBadge color="light" style={{ marginLeft: 6 }}>{type}</IonBadge>
                    <IonIcon
                      icon={trashOutline}
                      onClick={() => removeDetected(name)}
                      style={{ marginLeft: 6, cursor: 'pointer' }}
                    />
                  </IonChip>
                ))}
              {Object.keys(detected).filter(n => !isForgivable(n)).length === 0 && (
                <small style={{ color: 'var(--ion-color-medium)' }}>
                  Nothing detected yet. Enter some manually below, or add photos and run analysis.
                </small>
              )}
            </div>

            {/* Manual add */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <IonInput
                placeholder="enter ingredient"
                value={manualName}
                onIonInput={(e) => setManualName(String(e.detail.value || ''))}
                style={{ flex: '1 1 220px' }}
              />
              <select
                value={manualType}
                onChange={(e) => setManualType(e.target.value as IngredientType)}
                style={{ height: 40, borderRadius: 8, padding: '0 8px' }}
              >
                <option value="protein">protein</option>
                <option value="vegetable">vegetable</option>
                <option value="greens">greens</option>
                <option value="fruit">fruit</option>
                <option value="dairy">dairy</option>
                <option value="grain">grain</option>
                <option value="legume">legume</option>
                <option value="nut">nut</option>
                <option value="baking">baking</option>
                <option value="sweet">sweet</option>
                <option value="seafood">seafood</option>
                <option value="other">other</option>
              </select>
              <IonButton onClick={addManual}>
                <IonIcon icon={addCircleOutline} slot="start" />
                Add
              </IonButton>
            </div>

            <small style={{ color: 'var(--ion-color-medium)' }}>
              Basics like salt/pepper/oil are assumed and hidden, but saved with proper categories for matching.
            </small>

            <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
              <IonButton color="success" onClick={continueToRecipes} disabled={Object.keys(detected).length === 0}>
                Generate Recipes!
              </IonButton>
            </div>
          </div>
        </div>
      </IonContent>
    </IonPage>
  );
};

export default Scanner;
