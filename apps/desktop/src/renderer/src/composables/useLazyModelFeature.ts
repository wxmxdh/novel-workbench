import { computed, shallowRef, type ComputedRef, type ShallowRef } from "vue";
import type { ModelConfig, SystemEventEnvelope } from "@deepwrite/contracts";
interface ModelFeature {
  isBusy: ComputedRef<boolean>;
  setConfiguredModels(
    models: readonly ModelConfig[],
    defaultModelId?: string
  ): void;
  handleEvent(event: SystemEventEnvelope): void;
  dispose(): void;
}
/** Shared lifecycle for model-driven features that keep running after navigation. */
export function useLazyModelFeature<T extends ModelFeature>(
  feature: string,
  load: () => Promise<T>
) {
  const controller: ShallowRef<T | null> = shallowRef(null);
  const isBusy = computed(() => controller.value?.isBusy.value ?? false);
  let pending: Promise<T> | null = null;
  let generation = 0;
  let models: readonly ModelConfig[] = [];
  let defaultModelId: string | undefined;
  async function ensureLoaded(): Promise<T> {
    if (controller.value) return controller.value;
    if (pending) return pending;
    const epoch = generation;
    const task = (async () => {
      const instance = await load();
      instance.setConfiguredModels(models, defaultModelId);
      if (epoch !== generation) {
        instance.dispose();
        throw new Error(`${feature} controller load was cancelled.`);
      }
      controller.value = instance;
      return instance;
    })();
    pending = task;
    try {
      return await task;
    } finally {
      if (pending === task) pending = null;
    }
  }
  return {
    controller,
    isBusy,
    ensureLoaded,
    setConfiguredModels(next: readonly ModelConfig[], selected?: string) {
      models = next;
      defaultModelId = selected;
      controller.value?.setConfiguredModels(next, selected);
    },
    handleEvent(event: SystemEventEnvelope) {
      controller.value?.handleEvent(event);
    },
    dispose() {
      generation++;
      pending = null;
      controller.value?.dispose();
      controller.value = null;
    }
  };
}
