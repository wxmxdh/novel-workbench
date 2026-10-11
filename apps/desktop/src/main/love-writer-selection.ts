import type {
  AgentProviderRuntimeConfig,
  ComparisonDraftWriterContext,
  ShortAgentSubagentDefinition
} from "@deepwrite/contracts";
import {
  comparisonWritingIntent,
  parallelWritingRequest,
  splitAuthorActionClauses
} from "./comparison-writing-intent";
import { loveRedraftIntent } from "./love-workflow-intent";

export interface LoveWriterSelection {
  definitions: ShortAgentSubagentDefinition[];
  writers: ComparisonDraftWriterContext["writers"];
}

const GENERIC_ALIASES = new Set([
  "writer",
  "model",
  "agent",
  "assistant",
  "openai",
  "anthropic",
  "google",
  "azure",
  "custom",
  "local"
]);
const NON_MODEL_WORDS = new Set([
  "again",
  "and",
  "body",
  "chapter",
  "comparison",
  "create",
  "draft",
  "drafts",
  "each",
  "existing",
  "failed",
  "first",
  "for",
  "generate",
  "keep",
  "love",
  "main",
  "model",
  "models",
  "now",
  "other",
  "parallel",
  "please",
  "redo",
  "redraft",
  "retry",
  "rerun",
  "saved",
  "separately",
  "team",
  "teams",
  "the",
  "two",
  "independent",
  "independently",
  "write",
  "writer",
  "writers",
  "writing"
]);

function normalize(value: string): string {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]/gu, "");
}

function aliasPrefixes(value: string): string[] {
  const tokens = value.match(/[a-z]+|\d+/giu) ?? [];
  const prefixes: string[] = [];
  let prefix = "";
  for (const token of tokens) {
    prefix += token.toLocaleLowerCase();
    if (prefix.length >= 3 && !GENERIC_ALIASES.has(prefix))
      prefixes.push(prefix);
  }
  return prefixes;
}

function explicitActionText(text: string): string {
  return splitAuthorActionClauses(text)
    .filter(
      ({ text: clause }) =>
        comparisonWritingIntent(clause) !== undefined ||
        parallelWritingRequest(clause) !== undefined ||
        loveRedraftIntent(clause) !== undefined
    )
    .map(({ text: clause }) => clause)
    .join(" ");
}

type NamedWriterResolution =
  | { kind: "none" }
  | { kind: "ambiguous" }
  | { kind: "resolved"; ids: string[] };

function namedWriterIds(
  actionText: string,
  definitions: ShortAgentSubagentDefinition[],
  runtimeConfigs: Record<string, AgentProviderRuntimeConfig>
): NamedWriterResolution {
  const text = normalize(actionText);
  if (!text) return { kind: "none" };
  const candidates = definitions.flatMap((definition) => {
    const config = definition.modelId
      ? runtimeConfigs[definition.modelId]
      : undefined;
    if (!config) return [];
    const aliases = [
      config.modelId,
      ...(GENERIC_ALIASES.has(config.provider.toLocaleLowerCase())
        ? []
        : [config.provider])
    ].filter((value): value is string => Boolean(value?.trim()));
    const prefixes = [...new Set(aliases.flatMap(aliasPrefixes))];
    return prefixes.map((prefix) => ({ id: definition.id, prefix }));
  });
  const matches: Array<{ id: string; start: number; end: number }> = [];
  for (const candidate of candidates) {
    let start = text.indexOf(candidate.prefix);
    while (start >= 0) {
      matches.push({
        id: candidate.id,
        start,
        end: start + candidate.prefix.length
      });
      start = text.indexOf(candidate.prefix, start + 1);
    }
  }
  if (!matches.length) return { kind: "none" };
  matches.sort((a, b) => a.start - b.start || b.end - a.end);

  const selected = new Set<string>();
  for (let index = 0; index < matches.length;) {
    const group = [matches[index]!];
    let end = group[0]!.end;
    index += 1;
    while (index < matches.length && matches[index]!.start < end) {
      group.push(matches[index]!);
      end = Math.max(end, matches[index]!.end);
      index += 1;
    }
    const specificity = Math.max(
      ...group.map(({ start, end: matchEnd }) => matchEnd - start)
    );
    const best = new Set(
      group
        .filter(({ start, end: matchEnd }) => matchEnd - start === specificity)
        .map(({ id }) => id)
    );
    if (best.size !== 1) return { kind: "ambiguous" };
    selected.add([...best][0]!);
  }
  return { kind: "resolved", ids: [...selected] };
}

function hasUnmatchedLatinName(
  actionText: string,
  definitions: ShortAgentSubagentDefinition[],
  runtimeConfigs: Record<string, AgentProviderRuntimeConfig>
): boolean {
  const candidatePrefixes = new Set(
    definitions.flatMap((definition) => {
      const config = definition.modelId
        ? runtimeConfigs[definition.modelId]
        : undefined;
      if (!config) return [];
      return [
        config.modelId,
        ...(GENERIC_ALIASES.has(config.provider.toLocaleLowerCase())
          ? []
          : [config.provider])
      ]
        .filter((value): value is string => Boolean(value?.trim()))
        .flatMap(aliasPrefixes);
    })
  );
  const words = actionText.match(/[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*/giu) ?? [];
  return words.some((word) => {
    if (!/[A-Z0-9.-]/u.test(word)) return false;
    const token = normalize(word);
    if (!token || NON_MODEL_WORDS.has(token)) return false;
    return ![...candidatePrefixes].some((prefix) => prefix.includes(token));
  });
}

function hasUnconfiguredRequestedVersion(
  actionText: string,
  definitions: ShortAgentSubagentDefinition[],
  runtimeConfigs: Record<string, AgentProviderRuntimeConfig>
): boolean {
  const models = definitions.flatMap((definition) => {
    const config = definition.modelId
      ? runtimeConfigs[definition.modelId]
      : undefined;
    if (!config) return [];
    const family = config.modelId.match(/^([a-z]+)/iu)?.[1];
    return family ? [{ family, modelId: normalize(config.modelId) }] : [];
  });
  const requests = new Map<string, string>();
  for (const { family } of models) {
    const match = new RegExp(
      `${family}\\s*[-/]?\\s*(\\d+(?:\\.\\d+)+)`,
      "iu"
    ).exec(actionText);
    if (match?.[1]) requests.set(normalize(family), normalize(match[1]));
  }
  return [...requests].some(
    ([family, version]) =>
      !models.some(({ modelId }) => modelId.includes(`${family}${version}`))
  );
}

function hasUnconfiguredExplicitModelSpecification(
  actionText: string,
  definitions: ShortAgentSubagentDefinition[],
  runtimeConfigs: Record<string, AgentProviderRuntimeConfig>
): boolean {
  const models = definitions.flatMap((definition) => {
    const config = definition.modelId
      ? runtimeConfigs[definition.modelId]
      : undefined;
    const family = config?.modelId
      .match(/^([a-z]+)/iu)?.[1]
      ?.toLocaleLowerCase();
    return config && family
      ? [{ family, modelId: normalize(config.modelId) }]
      : [];
  });
  const families = new Set(models.map(({ family }) => family));

  for (const family of families) {
    const specificationPattern = new RegExp(
      `\\b${family}(?=\\s*[-/]?\\s*\\d)\\s*[-/]?\\s*(\\d+(?:\\s*\\.\\s*\\d+)+)(?:\\s+|[-/])([a-z][a-z0-9]*)\\b`,
      "giu"
    );
    for (const match of actionText.matchAll(specificationPattern)) {
      const specification = normalize(match[2]!);
      if (!specification || NON_MODEL_WORDS.has(specification)) continue;
      const requestedModel = `${family}${normalize(match[1]!)}${specification}`;
      if (
        !models.some(
          (model) =>
            model.family === family && model.modelId.includes(requestedModel)
        )
      )
        return true;
    }
  }
  return false;
}

export function explicitlyNamesLoveWriter(authorText: string): boolean {
  const actionText = explicitActionText(authorText);
  if (!actionText) return false;
  return hasUnmatchedLatinName(actionText, [], {});
}

/** No implicit fan-out: names must resolve uniquely, or an exact count must match all candidates. */
export function selectLoveWriters(input: {
  authorText: string;
  writerCount?: number;
  definitions: ShortAgentSubagentDefinition[] | undefined;
  runtimeConfigs: Record<string, AgentProviderRuntimeConfig>;
}): LoveWriterSelection | undefined {
  const definitions = (input.definitions ?? []).filter(
    (definition) =>
      definition.enabled && definition.id.startsWith("love-writer-")
  );
  const ready = definitions.filter(
    (definition) =>
      definition.modelId && input.runtimeConfigs[definition.modelId]
  );
  if (!ready.length) return undefined;

  const actionText = explicitActionText(input.authorText);
  if (!actionText) return undefined;
  const named = namedWriterIds(actionText, ready, input.runtimeConfigs);
  if (
    named.kind === "ambiguous" ||
    hasUnmatchedLatinName(actionText, ready, input.runtimeConfigs) ||
    hasUnconfiguredRequestedVersion(actionText, ready, input.runtimeConfigs) ||
    hasUnconfiguredExplicitModelSpecification(
      actionText,
      ready,
      input.runtimeConfigs
    )
  )
    return undefined;
  let selected: ShortAgentSubagentDefinition[];
  if (named.kind === "resolved") {
    selected = ready.filter(({ id }) => named.ids.includes(id));
    if (selected.length !== named.ids.length) return undefined;
    if (
      input.writerCount !== undefined &&
      selected.length !== input.writerCount
    )
      return undefined;
  } else if (input.writerCount !== undefined) {
    if (ready.length !== input.writerCount) return undefined;
    selected = ready;
  } else {
    if (ready.length !== 1) return undefined;
    selected = ready;
  }

  return {
    definitions: selected,
    writers: selected.map((definition) => {
      const config = input.runtimeConfigs[definition.modelId!]!;
      return {
        definitionId: definition.id,
        runtime: {
          provider: config.provider,
          model: config.modelId,
          mode: "provider",
          configId: config.id
        }
      };
    })
  };
}

export function selectRecoveredLoveWriters(input: {
  writers: ComparisonDraftWriterContext["writers"];
  definitions: ShortAgentSubagentDefinition[] | undefined;
  runtimeConfigs: Record<string, AgentProviderRuntimeConfig>;
}): LoveWriterSelection | undefined {
  const available = (input.definitions ?? []).filter(
    (definition) =>
      definition.enabled && definition.id.startsWith("love-writer-")
  );
  const selectedDefinitions: ShortAgentSubagentDefinition[] = [];
  for (const writer of input.writers) {
    const matches = available.filter((definition) => {
      const config = definition.modelId
        ? input.runtimeConfigs[definition.modelId]
        : undefined;
      return (
        definition.id === writer.definitionId &&
        config?.provider === writer.runtime.provider &&
        config.modelId === writer.runtime.model &&
        config.id === writer.runtime.configId &&
        writer.runtime.mode === "provider"
      );
    });
    if (matches.length !== 1) return undefined;
    selectedDefinitions.push(matches[0]!);
  }
  if (
    new Set(input.writers.map(({ definitionId }) => definitionId)).size !==
    input.writers.length
  )
    return undefined;
  return {
    definitions: selectedDefinitions,
    writers: input.writers
  };
}
