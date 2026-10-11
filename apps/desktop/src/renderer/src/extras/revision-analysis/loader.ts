/** Load dependency manifests only when this feature is opened. */
export function loadPage() {
  return import("./RevisionAnalysisPage.vue");
}
export function loadController() {
  return import("./useRevisionAnalysis");
}
