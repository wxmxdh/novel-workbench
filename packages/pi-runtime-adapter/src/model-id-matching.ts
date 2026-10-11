interface ModelIdCandidate {
  id: string;
}

/**
 * Match provider route aliases that add a prefix or suffix to a catalog id.
 * When multiple catalog ids match, the most specific (longest) id wins.
 */
export function findLongestModelIdBoundaryMatch<T extends ModelIdCandidate>(
  models: readonly T[],
  configuredModelId: string
): T | undefined {
  const normalizedConfiguredId = configuredModelId.toLowerCase();
  let matchedModel: T | undefined;

  for (const model of models) {
    const normalizedCatalogId = model.id.toLowerCase();
    if (
      !normalizedCatalogId ||
      (!normalizedConfiguredId.startsWith(normalizedCatalogId) &&
        !normalizedConfiguredId.endsWith(normalizedCatalogId))
    ) {
      continue;
    }
    if (!matchedModel || model.id.length > matchedModel.id.length) {
      matchedModel = model;
    }
  }

  return matchedModel;
}
