import { describe, it, expect } from 'vitest';
import { ROLE_REGISTRY, ROLE_REGISTRY_READY, ROLE_SETUPS } from '../roles/index.js';

// Ensure the THIEF role is registered and available in setups

describe('THIEF role', () => {
  it('is registered in the role registry', async () => {
    await ROLE_REGISTRY_READY;
    expect(ROLE_REGISTRY.THIEF).toBeDefined();
  });

  it('is included with default counts in all setups', () => {
    for (const setup of Object.values(ROLE_SETUPS)) {
      expect(setup.THIEF).toEqual({ min: 0, max: 1 });
    }
  });
});
