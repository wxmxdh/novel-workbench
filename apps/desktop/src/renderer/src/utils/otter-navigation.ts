import { ref } from "vue";

export const otterSections = [
  ["overview", "projectsTab"],
  ["story", "storySpaceTab"],
  ["workflow", "discussionTab"],
  ["review", "manuscriptsTab"],
  ["external", "externalReviewTab"],
  ["teams", "modelTeamsTab"]
] as const;
export const otterSection = ref<(typeof otterSections)[number][0]>("overview");
