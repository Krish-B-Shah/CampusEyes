import React, { useRef, useEffect } from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import { Camera } from 'expo-camera';
import DetectionOverlay from './DetectionOverlay';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export default function CameraView({
  isActive,
  onFrameProcessed,
  detections,
  permission
}) {
  const cameraRef = useRef(null);
  const lastDetectionTime = useRef(0);
  const DETECTION_INTERVAL = 1000; // Process every 1 second

  useEffect(() => {
    let interval;
    if (isActive && cameraRef.current) {
      interval = setInterval(async () => {
        const now = Date.now();
        if (now - lastDetectionTime.current >= DETECTION_INTERVAL) {
          lastDetectionTime.current = now;
          try {
            const image = await cameraRef.current.takePictureAsync({
              quality: 0.5,
              base64: false,
              skipProcessing: true
            });
            if (onFrameProcessed) {
              onFrameProcessed(image);
            }
          } catch (error) {
            console.log('Camera capture skipped:', error.message);
          }
        }
      }, DETECTION_INTERVAL);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isActive, onFrameProcessed]);

  if (!permission) {
    return <View style={styles.container} />;
  }

  return (
    <View style={styles.container}>
      <Camera
        ref={cameraRef}
        style={styles.camera}
        type={Camera.Constants.Type.back}
        ratio="16:9"
      />
      <DetectionOverlay detections={detections} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000'
  },
  camera: {
    flex: 1
  }
});
