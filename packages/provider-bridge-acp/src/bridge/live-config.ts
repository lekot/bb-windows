import type { AcpSessionParams } from '../session-params.js';
import type { AcpConfigOption } from '../wire.js';
import { acpNativeReasoningLevelToValue, findAcpModelConfigOption, findAcpThoughtLevelConfigOption } from './model-catalog.js';

export async function applyLiveConfig(
  options: readonly AcpConfigOption[] | undefined,
  selection: AcpSessionParams['modelSelection'],
  set: (id: string, value: string) => Promise<readonly AcpConfigOption[]>,
): Promise<readonly AcpConfigOption[] | undefined> {
  if (!selection || !('modelId' in selection)) return options;
  let current = options;
  const model = findAcpModelConfigOption(current);
  if (model && model.currentValue !== selection.modelId) {
    if (!model.options?.some(option => option.value === selection.modelId)) {
      throw new Error(`ACP model is unavailable: ${selection.modelId}`);
    }
    current = await set(model.id, selection.modelId);
  }
  const thought = findAcpThoughtLevelConfigOption(current);
  if (thought && selection.reasoningLevel !== undefined) {
    const value = acpNativeReasoningLevelToValue(selection.reasoningLevel, thought);
    if (value === undefined) {
      throw new Error(`ACP reasoning level is unavailable: ${selection.reasoningLevel} (native: ${(thought.options ?? []).map(o => o.value).join(', ')})`);
    }
    if (thought.currentValue !== value) current = await set(thought.id, value);
  }
  return current;
}
