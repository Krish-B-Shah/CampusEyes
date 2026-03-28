import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

export default function ModeToggle({ mode, onModeChange }) {
  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={[styles.button, mode === 'mobile' && styles.activeButton]}
        onPress={() => onModeChange('mobile')}
      >
        <Text style={[styles.text, mode === 'mobile' && styles.activeText]}>
          Mobile Mode
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.button, mode === 'test' && styles.activeButton]}
        onPress={() => onModeChange('test')}
      >
        <Text style={[styles.text, mode === 'test' && styles.activeText]}>
          Test Mode
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: '#1a1a2e',
    borderRadius: 25,
    padding: 4,
    marginHorizontal: 20,
    marginVertical: 10
  },
  button: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 22,
    alignItems: 'center'
  },
  activeButton: {
    backgroundColor: '#4a90d9'
  },
  text: {
    color: '#888',
    fontSize: 14,
    fontWeight: '600'
  },
  activeText: {
    color: '#fff'
  }
});
