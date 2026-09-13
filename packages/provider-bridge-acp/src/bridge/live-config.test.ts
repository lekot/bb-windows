import { describe, expect, it } from 'vitest';
import type { AcpConfigOption } from '../wire.js';
import { applyLiveConfig } from './live-config.js';

function config(model: string, level: string): AcpConfigOption[] {
  return [
    { id: 'model', type: 'select', category: 'model', currentValue: model, options: [{ value: 'glm' }, { value: 'flash' }] },
    { id: 'thought', type: 'select', category: 'thought_level', currentValue: level, options: [{ value: 'low' }, { value: 'max' }] },
  ];
}

describe('live ACP configuration', () => {
  it('switches models in both directions and applies reasoning after model changes', async () => {
    const calls: string[] = [];
    let state = config('glm', 'low');
    const set = async (id: string, value: string) => {
      calls.push(`${id}:${value}`);
      state = id === 'model' ? config(value, 'low') : config(state[0].currentValue!, value);
      return state;
    };
    let result = await applyLiveConfig(state, { modelId: 'flash', reasoningLevel: 'max' }, set);
    result = await applyLiveConfig(result, { modelId: 'glm', reasoningLevel: 'max' }, set);
    await applyLiveConfig(result, { modelId: 'glm', reasoningLevel: 'max' }, set);
    expect(calls).toEqual(['model:flash', 'thought:max', 'model:glm', 'thought:max']);
  });

  it('does not silently start a turn when a configuration change fails', async () => {
    await expect(applyLiveConfig(config('glm', 'low'), { modelId: 'flash' }, async () => { throw new Error('native rejection'); })).rejects.toThrow('native rejection');
    await expect(applyLiveConfig(config('glm', 'low'), { modelId: 'missing' }, async () => [])).rejects.toThrow('unavailable');
  });
});
