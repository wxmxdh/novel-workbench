/** Keep this feature's dependency preload manifest out of the workspace startup chunk. */
export function loadPage() {
  return import("./ShortBookAnalysisPage.vue");
}
export function loadController() {
  return import("./useShortBookAnalysis");
}
