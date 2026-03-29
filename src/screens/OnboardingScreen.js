import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  Animated, Easing, SafeAreaView
} from 'react-native';
import { speak, stopSpeaking, initVoice } from '../services/speechService';
import { listenOnce } from '../services/voiceService';
import * as Haptics from 'expo-haptics';

const ONBOARDING_QUESTIONS = [
  { id: 'name', question: "Welcome to CampusEyes! I'm Lily, your guide. I'd love to get to know you first. What should I call you?", key: 'name' },
  { id: 'age', question: "Hello [Name]! It's so good to meet you. Now, could you tell me how old you are?", key: 'age' },
  { id: 'campus', question: "Thank you, [Name]. And just one last thing before we start: which university campus will you be exploring today?", key: 'campus' },
];

export default function OnboardingScreen({ onComplete }) {
  const [currentStep, setCurrentStep] = useState(0);
  const [answers, setAnswers] = useState({ name: '', age: '', needs: '' });
  const [isListening, setIsListening] = useState(false);
  const [statusText, setStatusText] = useState('Lily is preparing...');
  const [isStarted, setIsStarted] = useState(false);
  
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const orbAnim = useRef(new Animated.Value(0)).current;

  // Initial animations
  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 1000,
      useNativeDriver: true,
    }).start();

    // Orb float animation
    Animated.loop(
      Animated.sequence([
        Animated.timing(orbAnim, {
          toValue: 1,
          duration: 3000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(orbAnim, {
          toValue: 0,
          duration: 3000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ])
    ).start();

    // Auto-start onboarding after animations
    const timer = setTimeout(() => {
      startOnboarding();
    }, 1500);
    return () => clearTimeout(timer);
  }, []);

  // Listen for the current question
  const askQuestion = useCallback(async (stepIndex, updatedAnswers = null) => {
    const activeAnswers = updatedAnswers || answers;
    if (stepIndex >= ONBOARDING_QUESTIONS.length) {
      setStatusText('Setting up your experience...');
      await speak("Perfect! We're all set. Let's explore the campus together.", true);
      onComplete(activeAnswers);
      return;
    }

    let { question } = ONBOARDING_QUESTIONS[stepIndex];
    // Personalize with name if available
    if (activeAnswers.name) {
      question = question.replace('[Name]', activeAnswers.name);
    }
    
    setStatusText(question); 
    
    // Pulsing effect while speaking
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.2, duration: 500, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
      ])
    );
    pulseLoop.start();

    // Await speech completion — this ensures Lily is NEVER interrupted
    await speak(question, true);
    
    pulseLoop.stop();
    Animated.timing(pulseAnim, { toValue: 1, duration: 300, useNativeDriver: true }).start();

    // Start listening only AFTER speech is completely finished
    startListening(stepIndex, activeAnswers);
  }, [answers, onComplete]);

  const startListening = async (stepIndex, currentAnswersState) => {
    if (isListening) return;
    
    setIsListening(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    await listenOnce(
      async (result) => {
        setIsListening(false);
        const heard = result.args?.[0] || '';
        
        if (heard && result.command !== 'error') {
          const key = ONBOARDING_QUESTIONS[stepIndex].key;
          
          let finalValue = heard;
          if (key === 'age') {
            const match = heard.match(/\d+/);
            if (match) finalValue = match[0];
          }

          const newAnswers = { ...currentAnswersState, [key]: finalValue };
          setAnswers(newAnswers);
          setStatusText(`Recorded: "${finalValue}"`);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          
          setTimeout(() => {
            setCurrentStep(stepIndex + 1);
            askQuestion(stepIndex + 1, newAnswers);
          }, 1000);
        } else {
          await speak('I didn\'t catch that. Could you please say it again?', true);
          startListening(stepIndex, currentAnswersState);
        }
      },
      (listening) => setIsListening(listening)
    );
  };

  const startOnboarding = () => {
    setIsStarted(true);
    initVoice().then(() => {
      askQuestion(0);
    });
  };

  const orbTranslateY = orbAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -20],
  });

  return (
    <SafeAreaView style={styles.container}>
      <Animated.View style={[styles.content, { opacity: fadeAnim }]}>
        <View style={styles.header}>
          <Text style={styles.title}>CampusEyes</Text>
          <Text style={styles.subtitle}>Empowering Vision Together</Text>
        </View>

        <View style={styles.orbContainer}>
          <Animated.View style={[
            styles.orb,
            { transform: [{ translateY: orbTranslateY }, { scale: pulseAnim }] }
          ]}>
            <View style={styles.orbInner} />
            <View style={styles.orbGlow} />
          </Animated.View>
        </View>

        <View style={styles.statsContainer}>
          <Text style={styles.statusLabel} numberOfLines={0}>{statusText}</Text>
          {isListening && (
            <View style={styles.listeningIndicator}>
              <View style={styles.dot} />
              <View style={[styles.dot, { opacity: 0.5 }]} />
              <View style={[styles.dot, { opacity: 0.2 }]} />
            </View>
          )}
        </View>

        <View style={styles.progressContainer}>
          {ONBOARDING_QUESTIONS.map((_, i) => (
            <View 
              key={i} 
              style={[
                styles.progressDot, 
                i === currentStep && styles.progressDotActive,
                i < currentStep && styles.progressDotComplete
              ]} 
            />
          ))}
        </View>
      </Animated.View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a12',
  },
  content: {
    flex: 1,
    padding: 30,
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  header: {
    alignItems: 'center',
    marginTop: 40,
  },
  title: {
    color: '#fff',
    fontSize: 34,
    fontWeight: 'bold',
    letterSpacing: 2,
  },
  subtitle: {
    color: '#3b82f6',
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 3,
    textTransform: 'uppercase',
    marginTop: 10,
  },
  orbContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  orb: {
    width: 140,
    height: 140,
    borderRadius: 70,
    justifyContent: 'center',
    alignItems: 'center',
  },
  orbInner: {
    width: '100%',
    height: '100%',
    borderRadius: 70,
    backgroundColor: '#3b82f6',
    opacity: 0.8,
    shadowColor: '#3b82f6',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 30,
    elevation: 20,
  },
  orbGlow: {
    position: 'absolute',
    width: '140%',
    height: '140%',
    borderRadius: 100,
    backgroundColor: '#3b82f6',
    opacity: 0.15,
  },
  statsContainer: {
    alignItems: 'center',
    marginBottom: 40,
    minHeight: 160, // Increased further
    width: '100%',
    justifyContent: 'center',
    paddingTop: 10,
  },
  statusLabel: {
    color: '#e5e5e5',
    fontSize: 22, // Slightly larger for readability
    textAlign: 'center',
    fontWeight: '300',
    lineHeight: 32,
    paddingHorizontal: 15,
  },
  listeningIndicator: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 15,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#f59e0b',
  },
  startButton: {
    backgroundColor: '#2563eb',
    paddingHorizontal: 40,
    paddingVertical: 18,
    borderRadius: 30,
    shadowColor: '#2563eb',
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 8,
  },
  startButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  progressContainer: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 20,
  },
  progressDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#1a1a2a',
    borderWidth: 1,
    borderColor: '#333',
  },
  progressDotActive: {
    backgroundColor: '#3b82f6',
    borderColor: '#3b82f6',
    width: 20,
  },
  progressDotComplete: {
    backgroundColor: '#10b981',
    borderColor: '#10b981',
  },
});
