import React, { useState, useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import MobileModeScreen from './src/screens/MobileModeScreen';
import OnboardingScreen from './src/screens/OnboardingScreen';

export default function App() {
  const [isOnboarded, setIsOnboarded] = useState(false);
  const [userData, setUserData] = useState(null);

  const handleOnboardingComplete = (data) => {
    setUserData(data);
    setIsOnboarded(true);
  };

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      {!isOnboarded ? (
        <OnboardingScreen onComplete={handleOnboardingComplete} />
      ) : (
        <MobileModeScreen initialUserData={userData} />
      )}
    </SafeAreaProvider>
  );
}
