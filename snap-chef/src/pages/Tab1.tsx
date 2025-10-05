import React, { useEffect, useRef, useState } from 'react';
import {
  IonContent,
  IonHeader,
  IonPage,
  IonTitle,
  IonToolbar,
  IonButton,
  IonGrid,
  IonRow,
  IonCol,
  IonImg,
  IonLabel,
} from '@ionic/react';
import './Tab1.css';
import { Capacitor } from '@capacitor/core';
import { IngredientType, FridgeMap, saveFridgeMap } from '../lib/FridgeStore';
import { aliasMatch } from '../lib/Aliases';

import { useIonRouter } from '@ionic/react';

const Scanner: React.FC = () => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [photos, setPhotos] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // cleanup on unmount
    return () => stopCamera();
  }, []);

  // Determine platform once (web | ios | android)
  const platform = Capacitor.getPlatform();
  const router = useIonRouter();

  const startCamera = async () => {
    setError(null);
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setError('Live camera not supported in this browser.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setIsStreaming(true);
    } catch (err) {
      console.error(err);
      setError('Could not access camera. Please allow permissions or try a different device.');
    }
  };

  const stopCamera = () => {
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current.srcObject = null;
      }
    } catch (e) {
      console.warn('Error stopping camera', e);
    }
    setIsStreaming(false);
  };

  const captureFromVideo = () => {
    const video = videoRef.current;
    if (!video) return;
    const w = video.videoWidth || 640;
    const h = video.videoHeight || 480;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, w, h);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
    setPhotos((p) => [dataUrl, ...p]);
  };

  const handleFiles = (files: FileList | null) => {
    if (!files) return;
    const fileArray = Array.from(files);
    fileArray.forEach((file) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const result = e.target?.result;
        if (typeof result === 'string') setPhotos((p) => [result, ...p]);
      };
      reader.readAsDataURL(file);
    });
  };

  const removePhoto = (index: number) => {
    setPhotos((p) => p.filter((_, i) => i !== index));
  };

  
  const FORGIVABLE_TYPES: Record<string, IngredientType> = {
    // baking / spices
    'salt': 'baking', 'pepper': 'baking', 'sugar': 'baking', 'flour': 'baking', 'baking powder': 'baking', 'baking soda': 'baking',
    'paprika': 'baking', 'chili powder': 'baking', 'cumin': 'baking', 'oregano': 'baking', 'basil': 'baking', 'thyme': 'baking',
    // produce
    'garlic': 'vegetable', 'onion': 'vegetable', 'lemon': 'fruit', 'lime': 'fruit', 'tomato paste': 'vegetable', 'tomato sauce': 'vegetable',
    // dairy / oils / condiments / misc
    'butter': 'dairy', 'olive oil': 'other', 'vegetable oil': 'other', 'vinegar': 'other', 'soy sauce': 'other', 'ketchup': 'other', 'mustard': 'other',
    'mayonnaise': 'other', 'stock': 'other', 'broth': 'other', 'water': 'other',
  };
  const FORGIVABLE = Object.keys(FORGIVABLE_TYPES);
  
  /*
  const continueToRecipes = async () => {
    // Merge display items with typed forgivables (hidden in UI but saved with proper types)
    const merged: FridgeMap = { ...detected };
    await saveFridgeMap(merged);
    const maybePush = (router as unknown as { push?: (...args: unknown[]) => void })?.push;
    if (typeof maybePush === 'function') {
      try { maybePush('/menu', 'forward'); } catch { router.push('/menu'); }
    } else {
      router.push('/menu');
    }
  };
  */


  const analyzePhotos = () => async () => {
    if (photos.length === 0) {
      setError('Please add at least one photo to analyze.');
      return;
    }
    setError(null);

    const ingredients: FridgeMap = {};

    // helper to register a detected label
    const register = (label: string, confidence?: number) => {
      if (!label) return;
      const norm = label.trim().toLowerCase();
      if (typeof confidence === 'number' && confidence < 0.2) return;
      const m = aliasMatch(norm);
      if (m) {
        ingredients[m.name] = m.type;
      } else {
        ingredients[norm] = 'other';
      }
    };

    // send each photo to the inference endpoint and parse predictions
    for (const p of photos) {
      try {
        const response = await fetch('https://serverless.roboflow.com/infer/workflows/snapchef-f8wpm/custom-workflow-2', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: 'SECRET', inputs: { image: p } }),
        });

        const result = await response.json();
        // Expected shape: { outputs: [ { predictions: { predictions: [ { class, confidence, ... } ] } } ] }
        const outputs = result?.outputs;
        if (Array.isArray(outputs)) {
          for (const out of outputs) {
            const preds = out?.predictions?.predictions || out?.predictions || out?.predictions?.output || [];
            if (Array.isArray(preds)) {
              for (const pitem of preds) {
                const cls = pitem.class.toString();
                const conf = typeof pitem.confidence === 'number' ? pitem.confidence : (pitem.score || pitem.confidence_score || 0);
                register(cls, conf as number);
              }
            }
          }
        } else {
          console.warn('Unexpected inference result shape', result);
        }
      } catch (e) {
        console.error('Error calling inference', e);
      }
    }

    for (const f of FORGIVABLE) {
      if (!(f in ingredients)) ingredients[f] = FORGIVABLE_TYPES[f];
    }

    try {
      await saveFridgeMap(ingredients);
      console.log('Saved fridge map', ingredients);
    } catch (e) {
      console.error('Failed to save fridge map', e);
      setError('Failed to save detected items.');
    }
  };

      
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
          <div className="controls">
            {platform === 'web' && (
              <>
                <IonButton onClick={startCamera} disabled={isStreaming}>
                  Start Camera
                </IonButton>
                <IonButton onClick={stopCamera} disabled={!isStreaming}>
                  Stop Camera
                </IonButton>
                <IonButton onClick={captureFromVideo} disabled={!isStreaming}>
                  Capture Photo
                </IonButton>
              </>
            )}

            <IonButton style={{ marginLeft: 8 }} onClick={() => fileInputRef.current?.click()}>
              Upload Images
            </IonButton>
            {/* hidden file input triggered by the Upload Images button */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              style={{ display: 'none' }}
              onChange={(e) => handleFiles(e.target.files)}
            />
          </div>

          <IonButton className="analyze-button" onClick={analyzePhotos()} disabled={photos.length === 0}>
            Analyze
          </IonButton>
          {error && <div className="scanner-error">{error}</div>}

          {platform === 'web' && (
            <div className="video-wrap">
              {/* Video element for web live feed */}
              <video
                ref={videoRef}
                className="scanner-video"
                playsInline
                muted
                style={{ width: '100%', maxHeight: 480, background: '#000' }}
              />
            </div>
          )}

          <div className="thumbnails">
            <IonGrid>
              <IonRow>
                {photos.map((p, idx) => (
                  <IonCol size="6" sizeMd="4" key={idx} className="thumb-col">
                    <div className="thumb-card">
                      <IonImg src={p} alt={`photo-${idx}`} />
                      {/* overlay delete button in top-right */}
                      <button
                        className="delete-btn"
                        onClick={() => removePhoto(idx)}
                        aria-label={`Delete photo ${idx}`}
                        title="Delete photo"
                      >
                        ×
                      </button>
                    </div>
                  </IonCol>
                ))}
                {photos.length === 0 && (
                  <IonCol>
                    <IonLabel>For AI recipe recommendations, please take photos of your fridge!</IonLabel>
                  </IonCol>
                )}
              </IonRow>
            </IonGrid>
          </div>
        </div>
      </IonContent>
    </IonPage>
  );
};

export default Scanner;
