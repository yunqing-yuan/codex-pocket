import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'studio.codexpocket.mobile',
  appName: 'Codex Pocket',
  webDir: 'dist',
  backgroundColor: '#f5f3ec',
  android: {
    backgroundColor: '#f5f3ec',
    allowMixedContent: true
  },
  server: {
    androidScheme: 'https',
    cleartext: true
  }
};

export default config;
