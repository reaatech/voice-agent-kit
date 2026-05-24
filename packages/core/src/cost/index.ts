export { CostTracker } from './cost-tracker.js';
export { DEFAULT_PRICING } from './default-pricing.js';

import type { CostTrackingConfig } from '../types/index.js';
import { CostTracker } from './cost-tracker.js';

export function createCostTracker(config: CostTrackingConfig): CostTracker {
  return new CostTracker(config);
}
