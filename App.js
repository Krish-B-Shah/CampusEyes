import React from 'react';
import { StatusBar } from 'expo-status-bar';
import MobileModeScreen from './src/screens/MobileModeScreen';

export default function App() {
  return (
    <>
      <StatusBar style="light" />
      <MobileModeScreen />
    </>
  );
}
