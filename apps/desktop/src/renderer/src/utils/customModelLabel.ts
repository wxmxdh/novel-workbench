const CUSTOM_MODEL_LABEL_MAX = 120;

/** Shared custom-model name: empty falls back to model id; batches append （model id）. */
export function resolveSavedModelLabel(
  sourceLabel: string,
  modelId: string,
  selectedCount = 1
): string {
  const filled = sourceLabel.trim();
  const id = modelId.trim();
  if (!filled) return id.slice(0, CUSTOM_MODEL_LABEL_MAX);
  if (selectedCount <= 1) return filled.slice(0, CUSTOM_MODEL_LABEL_MAX);
  return `${filled}（${id}）`.slice(0, CUSTOM_MODEL_LABEL_MAX);
}
