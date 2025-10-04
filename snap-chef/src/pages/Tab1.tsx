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
        // autoplay/play may require a user gesture in some browsers
        try {
          await videoRef.current.play();
        } catch {
          // ignore play errors; video will still display when user interacts
        }
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
                      <div className="thumb-actions">
                        <IonButton size="small" onClick={() => removePhoto(idx)} color="danger">
                          Delete
                        </IonButton>
                      </div>
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
