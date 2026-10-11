import { useLazyRevisionAnalysis } from "./useLazyRevisionAnalysis";
import type { DeepWriteApi, ModelConfig } from "@deepwrite/contracts";
import { useLazyLongBookAnalysisController } from "./useLazyFeatureControllers";
import { useLazyShortBookAnalysisController } from "./useLazyShortBookAnalysis";
export function useBookAnalysisFeatures(api: () => DeepWriteApi | undefined) {
  const longBookAnalysisFeature = useLazyLongBookAnalysisController({ api });
  const shortBookAnalysisFeature = useLazyShortBookAnalysisController({ api });
  const revisionAnalysisFeature = useLazyRevisionAnalysis({ api });
  const analysisFeatures = [
    longBookAnalysisFeature,
    shortBookAnalysisFeature,
    revisionAnalysisFeature
  ];
  return {
    revisionAnalysisFeature,
    revisionAnalysisRunning: revisionAnalysisFeature.isBusy,
    configureAnalysisModels(
      models: readonly ModelConfig[],
      defaultModelId?: string
    ) {
      analysisFeatures.forEach((f) =>
        f.setConfiguredModels(models, defaultModelId)
      );
    },
    disposeAnalysisFeatures() {
      analysisFeatures.forEach((f) => f.dispose());
    },
    longBookAnalysisFeature,
    shortBookAnalysisFeature,
    longBookAnalysisRunning: longBookAnalysisFeature.isBusy,
    shortBookAnalysisRunning: shortBookAnalysisFeature.isBusy
  };
}
