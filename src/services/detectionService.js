import '@tensorflow/tfjs-react-native';
import * as tf from '@tensorflow/tfjs';
import * as cocoSsd from '@tensorflow-models/coco-ssd';

let model = null;
let modelLoading = false;

export async function loadModel() {
  if (model) return model;
  if (modelLoading) {
    // Wait for existing load to complete
    while (!model) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return model;
  }

  modelLoading = true;
  try {
    // Set up TensorFlow.js for React Native
      await tf.ready();
      await tf.setBackend('cpu');
    model = await cocoSsd.load({
      base: 'lite_mobilenet_v2' // Faster variant
    });

    console.log('Model loaded successfully');
    return model;
  } catch (error) {
    console.error('Error loading model:', error);
    modelLoading = false;
    throw error;
  }
}

export async function detectObjects(imageElement) {
  if (!model) {
    await loadModel();
  }

  try {
    const predictions = await model.detect(imageElement);
    return predictions.map(pred => ({
      class: pred.class,
      score: pred.score,
      bbox: pred.bbox
    }));
  } catch (error) {
    console.error('Detection error:', error);
    return [];
  }
}

export function filterRelevantObjects(predictions, targetClasses) {
  const lowerTargets = targetClasses.map(c => c.toLowerCase());
  return predictions.filter(
    pred => lowerTargets.includes(pred.class.toLowerCase())
  );
}

export function isModelLoaded() {
  return model !== null;
}
