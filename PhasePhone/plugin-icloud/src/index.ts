import { registerPlugin } from '@capacitor/core';

import type { PhaseICloudPlugin } from './definitions';

const PhaseICloud = registerPlugin<PhaseICloudPlugin>('PhaseICloud', {
  web: () => import('./web').then((m) => new m.PhaseICloudWeb()),
});

export * from './definitions';
export { PhaseICloud };
