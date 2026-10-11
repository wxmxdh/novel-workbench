import type { ModelConfigInput, ModelSettings } from "@deepwrite/contracts";
import type { DeepWriteFreeModelCatalog } from "./deepwrite-free-model-config";
import {
  isFreeModelAvailable,
  toDiskModel,
  type DiskModelConfig,
  type DiskModelSettings
} from "./free-model-settings-state";

type PublicFreeModelSettings = Pick<
  ModelSettings,
  | "deepwriteFreeModels"
  | "deepwriteFreeEnabledModelIds"
  | "deepwriteFreeDeprecatedModels"
  | "deepwriteFreeDefaultModelId"
  | "deepwriteFreeMessage"
>;

function deprecatedIds(
  settings: Pick<DiskModelSettings, "deprecatedFreeModels">
): Set<string> {
  return new Set(settings.deprecatedFreeModels.map((model) => model.id));
}

function unavailableVisibleModels(
  settings: DiskModelSettings,
  catalog: DeepWriteFreeModelCatalog
): DiskModelConfig[] {
  const deprecated = deprecatedIds(settings);
  const visible = new Map<string, DiskModelConfig>();
  for (const model of catalog.models) {
    visible.set(model.id, { ...toDiskModel(model), status: 1 });
  }
  for (const model of settings.knownFreeModels) {
    if (!deprecated.has(model.id) && !visible.has(model.id)) {
      visible.set(model.id, { ...model, status: 1 });
    }
  }
  return [...visible.values()];
}

export function projectPublicFreeModelSettings(
  settings: DiskModelSettings,
  catalog: DeepWriteFreeModelCatalog,
  hasApiKey: (modelId: string) => boolean
): PublicFreeModelSettings {
  const visibleModels =
    catalog.manifestAvailable && !catalog.enabled
      ? unavailableVisibleModels(settings, catalog)
      : catalog.models;
  return {
    deepwriteFreeModels: visibleModels.map((model) => ({
      ...model,
      hasApiKey: hasApiKey(model.id)
    })),
    deepwriteFreeEnabledModelIds: settings.enabledFreeModelIds,
    deepwriteFreeDeprecatedModels: settings.deprecatedFreeModels.map(
      (model) => ({ ...model, hasApiKey: false })
    ),
    ...(catalog.defaultModelId
      ? { deepwriteFreeDefaultModelId: catalog.defaultModelId }
      : {}),
    ...(catalog.message ? { deepwriteFreeMessage: catalog.message } : {})
  };
}

export function effectiveFreeModels(
  settings: Pick<DiskModelSettings, "enabledFreeModelIds">,
  catalog: DeepWriteFreeModelCatalog
): DiskModelConfig[] {
  if (!catalog.enabled) return [];
  const enabledIds = new Set(settings.enabledFreeModelIds);
  return catalog.models
    .filter((model) => enabledIds.has(model.id) && isFreeModelAvailable(model))
    .map(toDiskModel);
}

export function reservedFreeModelIds(
  settings: Pick<DiskModelSettings, "knownFreeModels" | "deprecatedFreeModels">,
  catalog: DeepWriteFreeModelCatalog
): Set<string> {
  return new Set([
    ...catalog.models.map((model) => model.id),
    ...settings.knownFreeModels.map((model) => model.id),
    ...settings.deprecatedFreeModels.map((model) => model.id)
  ]);
}

export function managedFreeSecretIds(
  settings: Pick<
    DiskModelSettings,
    "enabledFreeModelIds" | "knownFreeModels" | "deprecatedFreeModels"
  >,
  catalog: DeepWriteFreeModelCatalog
): Set<string> {
  const deprecated = deprecatedIds(settings);
  const current = new Set(catalog.models.map((model) => model.id));
  return new Set(
    [
      ...current,
      ...settings.knownFreeModels.map((model) => model.id),
      ...settings.enabledFreeModelIds
    ].filter((id) => current.has(id) || !deprecated.has(id))
  );
}

export function removeDeprecatedFreeSecrets(
  encryptedApiKeys: Record<string, string>,
  settings: Pick<DiskModelSettings, "deprecatedFreeModels">
): Record<string, string> {
  const next = { ...encryptedApiKeys };
  for (const model of settings.deprecatedFreeModels) delete next[model.id];
  return next;
}

export function requireEnableableFreeModel(
  catalog: DeepWriteFreeModelCatalog,
  modelId: string
): ModelConfigInput {
  if (!catalog.enabled) {
    throw new Error(catalog.message || "DeepWrite 免费模型当前已暂停使用。");
  }
  return resolveCurrentFreeModel(catalog, modelId, false);
}

export function resolveCurrentFreeModel(
  catalog: DeepWriteFreeModelCatalog,
  modelId: string,
  enforceRemoteStatus: boolean
): ModelConfigInput {
  if (enforceRemoteStatus && catalog.manifestAvailable && !catalog.enabled) {
    throw new Error(catalog.message || "DeepWrite 免费模型当前已暂停使用。");
  }
  const model = catalog.models.find((candidate) => candidate.id === modelId);
  if (!model) {
    throw new Error("这个 DeepWrite 免费模型已废弃或不再受支持。");
  }
  if (!isFreeModelAvailable(model)) {
    throw new Error("这个 DeepWrite 免费模型当前不可用。");
  }
  return structuredClone(model);
}
