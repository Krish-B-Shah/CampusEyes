import React from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

export default function DetectionOverlay({ detections }) {
  if (!detections || detections.length === 0) {
    return null;
  }

  return (
    <View style={styles.container} pointerEvents="none">
      {detections.map((detection, index) => {
        const [x, y, w, h] = detection.bbox;
        const scaleX = SCREEN_WIDTH / 640;
        const scaleY = SCREEN_HEIGHT / 480;

        return (
          <View
            key={index}
            style={[
              styles.boundingBox,
              {
                left: x * scaleX,
                top: y * scaleY,
                width: w * scaleX,
                height: h * scaleY
              }
            ]}
          >
            <Text style={styles.label}>
              {detection.class} {Math.round(detection.score * 100)}%
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject
  },
  boundingBox: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: '#00FF00',
    borderRadius: 4,
    backgroundColor: 'rgba(0, 255, 0, 0.1)'
  },
  label: {
    color: '#00FF00',
    fontSize: 12,
    fontWeight: 'bold',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    paddingHorizontal: 4,
    paddingVertical: 2
  }
});
