/** Template validation is needed only when saving a template. */
export async function loadBookTemplateDraftSchema() {
  return (await import("./book-templates")).BookTemplateDraftSchema;
}
