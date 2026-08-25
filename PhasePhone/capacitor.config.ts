import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.phaseapp.phone',
  appName: 'Phase',
  webDir: 'dist',
  ios: { contentInset: 'always' },
};

export default config;
