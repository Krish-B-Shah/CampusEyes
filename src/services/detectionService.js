import '@tensorflow/tfjs-react-native';
import { decodeJpeg } from '@tensorflow/tfjs-react-native';
import * as tf from '@tensorflow/tfjs';
import * as cocoSsd from '@tensorflow-models/coco-ssd';

let model = null;
let modelLoading = false;
let modelPromise = null;

export async function loadModel() {
  if (model) return model;
  if (modelPromise) {
    // If loading is already in progress, wait for the same promise
    return modelPromise;
  }

  modelLoading = true;
  modelPromise = (async () => {
    try {
      // Set up TensorFlow.js for React Native
    await tf.ready();
    // Try webgl backend first - it's much faster than cpu on mobile
    try {
      await tf.setBackend('webgl');
    } catch {
      try {
        await tf.setBackend('cpu');
      } catch (cpuError) {
        console.warn('Both webgl and cpu backends failed, using default');
      }
    }
    model = await cocoSsd.load({
      base: 'lite_mobilenet_v2' // Faster variant
    });

    console.log('Model loaded successfully');
    return model;
  } catch (error) {
    console.error('Error loading model:', error);
    throw error;
  } finally {
    modelLoading = false;
    if (model && modelPromise) {
      // keep the modelPromise resolved for future calls
    } else {
      modelPromise = null;
    }
  }
})();

  try {
    return await modelPromise;
  } catch (error) {
    // If load failed, clear model variables so retries can run
    model = null;
    modelPromise = null;
    modelLoading = false;
    throw error;
  }
}

export async function detectObjects(imageUri) {
  if (!model) {
    await loadModel();
  }

  try {
    // Fetch the image as binary
    const response = await fetch(imageUri);
    if (!response.ok) {
      throw new Error(`Image load failed: ${response.status} ${response.statusText}`);
    }
    const imageData = await response.arrayBuffer();
    const imageBytes = new Uint8Array(imageData);

    // Decode JPEG to tensor [height, width, 3]
    const imageTensor = decodeJpeg(imageBytes, 3);

    // Run detection
    const predictions = await model.detect(imageTensor);

    // Clean up tensor to prevent memory leaks
    imageTensor.dispose();

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
