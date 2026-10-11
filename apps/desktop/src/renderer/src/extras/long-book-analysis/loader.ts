/** Keep analysis-only dependency manifests out of the workspace startup graph. */
export function loadPage() {
  return import("./LongBookAnalysisPage.vue");
}
export function loadController() {
  return import("./useLongBookAnalysis");
}
