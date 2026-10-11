import { createScopedTranslator } from "../i18n";
import type { IconName } from "../types/workspace";

const t = createScopedTranslator("components.sidebarMoreFeatures");
export const moreFeatures: Array<{
  id:
    | "chat-assistant"
    | "long-book-analysis"
    | "revision-analysis"
    | "short-book-analysis"
    | "style-comparison"
    | "zhuque-detection"
    | "otter-workbench";
  label: string;
  description: string;
  icon: IconName;
}> = [
  {
    id: "chat-assistant",
    get label() {
      return t("chat");
    },
    get description() {
      return t("openStandaloneChatAssistant");
    },
    icon: "message"
  },
  {
    id: "short-book-analysis",
    get label() {
      return t("shortStoryAnalysis");
    },
    get description() {
      return t("analyzeFullWorksCombiningUpTo10Books");
    },
    icon: "book"
  },
  {
    id: "long-book-analysis",
    get label() {
      return t("novelAnalysis");
    },
    get description() {
      return t("extractNovelPlotCharactersAndStyleInBatches");
    },
    icon: "book"
  },
  {
    id: "revision-analysis",
    get label() {
      return t("revisionAnalysis");
    },
    get description() {
      return t("learnReusableSkillsFromManuscriptRevisions");
    },
    icon: "file"
  },
  {
    id: "style-comparison",
    get label() {
      return t("styleComparison");
    },
    get description() {
      return t("compareTheStyleAndSimilarityOfTwoTexts");
    },
    icon: "file"
  },
  {
    id: "zhuque-detection",
    get label() {
      return t("aITextDetection");
    },
    get description() {
      return t("detectAIGeneratedText");
    },
    icon: "globe"
  },
  {
    id: "otter-workbench",
    get label() {
      return t("otterWorkbench");
    },
    get description() {
      return t("otterWorkbenchDescription");
    },
    icon: "book"
  }
];
