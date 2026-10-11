import { createHash } from "node:crypto";
import {
  comparisonWritingIntent,
  parallelWritingRequest
} from "./comparison-writing-intent";
import {
  loveFailureContinuationIntent,
  loveRedraftIntent,
  loveWritingAuthorizationRevoked
} from "./love-workflow-intent";

export interface LoveFailureContinuationMessage {
  position: number;
  value: Record<string, unknown>;
}

export interface LoveFailureContinuationInput {
  chapter?: number;
  writerCount?: number;
  quote: string;
}

export interface LoveFailureContinuationRecovery {
  chapter: number;
  chapterCardId: string;
  chapterCardSha256: string;
  volumeId: string;
  volumeSha256: string;
  sourceMode: "independent" | "redraft";
  writers: Array<{
    definitionId: string;
    runtime: {
      mode: "provider";
      provider: string;
      model: string;
      configId: string;
    };
  }>;
  authorizationId: string;
  priorAuthorTextSha256: string;
}

interface RuntimeRef {
  mode: "provider";
  provider: string;
  model: string;
  configId: string;
}

interface ScopeEvidence {
  version: 1;
  bookId: "longbook_9a146bbe";
  authorizationId: string;
  chapter: number;
  chapterCardId: string;
  chapterCardSha256: string;
  volumeId: string;
  volumeSha256: string;
  sourceMode: "independent" | "redraft";
  definitionId: string;
  runtime: RuntimeRef;
  authorRequestId: string;
  authorTextSha256: string;
  authorRequestQuote: string;
  priorAuthorizationId?: string;
  priorAuthorTextSha256?: string;
}

interface AuthorScope {
  authorizationId: string;
  authorTextSha256: string;
  chapter: number;
  chapterCardId: string;
  chapterCardSha256: string;
  volumeId: string;
  volumeSha256: string;
  sourceMode: "independent" | "redraft";
}

interface WriterAttempt {
  definitionId: string;
  runtime: RuntimeRef;
  status: unknown;
  toolCalls: unknown[];
}

interface AttemptResult {
  scope?: AuthorScope;
  writers: LoveFailureContinuationRecovery["writers"];
  complete: boolean;
}

function sameAttempt(left: ScopeEvidence, right: ScopeEvidence): boolean {
  return (
    left.authorizationId === right.authorizationId &&
    left.authorTextSha256 === right.authorTextSha256 &&
    left.chapter === right.chapter &&
    left.chapterCardId === right.chapterCardId &&
    left.chapterCardSha256 === right.chapterCardSha256 &&
    left.volumeId === right.volumeId &&
    left.volumeSha256 === right.volumeSha256 &&
    left.sourceMode === right.sourceMode &&
    left.authorRequestId === right.authorRequestId &&
    left.authorRequestQuote === right.authorRequestQuote
  );
}

const PREPARE_MARKER = "【LOVE对照稿恢复证据 v1】";
const DELIVERY_MARKER = "【LOVE对照稿交付证据 v1】";
const WRITER_ID = /^love-writer-[a-z0-9-]+$/u;
const SHA256 = /^[a-f0-9]{64}$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function sha256(text: string): string {
  return createHash("sha256").update(text.trim(), "utf8").digest("hex");
}

function parseMarker<T>(
  summary: unknown,
  marker: string
):
  | { found: false }
  | { found: true; valid: false }
  | { found: true; valid: true; value: T } {
  if (typeof summary !== "string" || !summary.includes(marker))
    return { found: false };
  const matches = [
    ...summary.matchAll(new RegExp(`${marker}([^\\r\\n]+)`, "gu"))
  ];
  if (matches.length !== 1) return { found: true, valid: false };
  try {
    return {
      found: true,
      valid: true,
      value: JSON.parse(matches[0]![1]!) as T
    };
  } catch {
    return { found: true, valid: false };
  }
}

function runtimeRef(value: unknown): RuntimeRef | undefined {
  if (
    !isRecord(value) ||
    value.mode !== "provider" ||
    typeof value.provider !== "string" ||
    !value.provider.trim() ||
    typeof value.model !== "string" ||
    !value.model.trim() ||
    typeof value.configId !== "string" ||
    !value.configId.trim()
  )
    return undefined;
  return {
    mode: "provider",
    provider: value.provider,
    model: value.model,
    configId: value.configId
  };
}

function runtimeEquals(left: RuntimeRef, right: RuntimeRef): boolean {
  return (
    left.mode === right.mode &&
    left.provider === right.provider &&
    left.model === right.model &&
    left.configId === right.configId
  );
}

function parseScopeEvidence(value: unknown): ScopeEvidence | undefined {
  if (!isRecord(value)) return undefined;
  const runtime = runtimeRef(value.runtime);
  if (
    value.version !== 1 ||
    value.bookId !== "longbook_9a146bbe" ||
    typeof value.authorizationId !== "string" ||
    value.authorizationId.length < 16 ||
    !Number.isInteger(value.chapter) ||
    (value.chapter as number) < 1 ||
    typeof value.chapterCardId !== "string" ||
    !value.chapterCardId.trim() ||
    typeof value.chapterCardSha256 !== "string" ||
    !SHA256.test(value.chapterCardSha256) ||
    typeof value.volumeId !== "string" ||
    !value.volumeId.trim() ||
    typeof value.volumeSha256 !== "string" ||
    !SHA256.test(value.volumeSha256) ||
    (value.sourceMode !== "independent" && value.sourceMode !== "redraft") ||
    typeof value.definitionId !== "string" ||
    !WRITER_ID.test(value.definitionId) ||
    !runtime ||
    typeof value.authorRequestId !== "string" ||
    !value.authorRequestId.trim() ||
    typeof value.authorTextSha256 !== "string" ||
    !SHA256.test(value.authorTextSha256) ||
    typeof value.authorRequestQuote !== "string" ||
    !value.authorRequestQuote.trim() ||
    value.authorRequestQuote.length > 200 ||
    (value.priorAuthorizationId !== undefined &&
      (typeof value.priorAuthorizationId !== "string" ||
        value.priorAuthorizationId.length < 16)) ||
    (value.priorAuthorTextSha256 !== undefined &&
      (typeof value.priorAuthorTextSha256 !== "string" ||
        !SHA256.test(value.priorAuthorTextSha256)))
  )
    return undefined;
  if (
    (value.priorAuthorizationId === undefined) !==
    (value.priorAuthorTextSha256 === undefined)
  )
    return undefined;
  return {
    ...(value as Omit<ScopeEvidence, "runtime">),
    runtime
  };
}

function sameScopeFields(left: ScopeEvidence, right: AuthorScope): boolean {
  return (
    left.chapter === right.chapter &&
    left.chapterCardId === right.chapterCardId &&
    left.chapterCardSha256 === right.chapterCardSha256 &&
    left.volumeId === right.volumeId &&
    left.volumeSha256 === right.volumeSha256 &&
    left.sourceMode === right.sourceMode
  );
}

function parseDeliveryEvidence(
  value: unknown
): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  const runtime = runtimeRef(value.runtime);
  const safeRelativePath = (path: unknown) =>
    typeof path === "string" &&
    Boolean(path.trim()) &&
    path.length <= 1000 &&
    !path.startsWith("/") &&
    !path.startsWith("\\") &&
    !/^[a-z]:/iu.test(path) &&
    !path.split(/[\\/]/u).includes("..");
  if (
    value.version !== 1 ||
    value.bookId !== "longbook_9a146bbe" ||
    typeof value.authorizationId !== "string" ||
    !runtime ||
    typeof value.definitionId !== "string" ||
    !WRITER_ID.test(value.definitionId) ||
    !safeRelativePath(value.path) ||
    typeof value.sha256 !== "string" ||
    !SHA256.test(value.sha256) ||
    typeof value.model !== "string" ||
    !value.model.trim() ||
    value.model !== runtime.model ||
    value.status !== "待审阅" ||
    !safeRelativePath(value.deliveryRecord) ||
    value.path === value.deliveryRecord ||
    value.path === "." ||
    value.deliveryRecord === "."
  )
    return undefined;
  return { ...value, runtime };
}

function getToolCalls(value: Record<string, unknown>): unknown[] | undefined {
  return Array.isArray(value.toolCalls) ? value.toolCalls : undefined;
}

function writerAttempts(
  assistant: Record<string, unknown>
): WriterAttempt[] | undefined {
  const writers: WriterAttempt[] = [];
  if (Array.isArray(assistant.subagentRuns)) {
    for (const run of assistant.subagentRuns) {
      if (!isRecord(run) || typeof run.subagentId !== "string")
        return undefined;
      if (!run.subagentId.startsWith("love-writer-")) continue;
      const runtime = runtimeRef(run.runtime);
      const toolCalls = getToolCalls(run);
      if (
        !runtime ||
        !toolCalls ||
        (run.status !== "completed" &&
          run.status !== "error" &&
          run.status !== "stopped" &&
          run.status !== "running")
      )
        return undefined;
      if (run.status === "running") return undefined;
      writers.push({
        definitionId: run.subagentId,
        runtime,
        status: run.status,
        toolCalls
      });
    }
  }
  const rootCalls = getToolCalls(assistant);
  if (rootCalls) {
    const hasMainPrep = rootCalls.some((entry) => {
      if (!isRecord(entry) || entry.name !== "prepare_comparison_draft")
        return false;
      const marker = parseMarker(entry.resultSummary, PREPARE_MARKER);
      return marker.found && marker.valid;
    });
    if (hasMainPrep) {
      const mainPreparations = rootCalls
        .map((entry) => {
          if (!isRecord(entry) || entry.name !== "prepare_comparison_draft")
            return undefined;
          const marker = parseMarker(entry.resultSummary, PREPARE_MARKER);
          return marker.found && marker.valid
            ? parseScopeEvidence(marker.value)
            : undefined;
        })
        .filter((entry): entry is ScopeEvidence => Boolean(entry));
      const prepared = mainPreparations.at(-1);
      if (!prepared) return undefined;
      writers.push({
        definitionId: prepared.definitionId,
        runtime: prepared.runtime,
        status: assistant.status,
        toolCalls: rootCalls
      });
    }
  }
  return writers;
}

function analyzeAttempt(input: {
  assistant: Record<string, unknown>;
  userText: string;
  expectedQuote: string;
  expectedSourceMode?: "independent" | "redraft";
  baseScope?: AuthorScope;
  previousFailures?: LoveFailureContinuationRecovery["writers"];
}): AttemptResult | undefined {
  const attempts = writerAttempts(input.assistant);
  if (!attempts) return undefined;
  const expectedHash = sha256(input.userText);
  const expectedFailures = new Map(
    (input.previousFailures ?? []).map((writer) => [
      writer.definitionId,
      writer
    ])
  );
  const found: LoveFailureContinuationRecovery["writers"] = [];
  let evidenceScope: ScopeEvidence | undefined;
  let recoveredScope: AuthorScope | undefined;
  let preparationCount = 0;
  const definitionIds = new Set<string>();

  for (const attempt of attempts) {
    const preparationCalls = attempt.toolCalls.filter(
      (entry): entry is Record<string, unknown> =>
        isRecord(entry) && entry.name === "prepare_comparison_draft"
    );
    if (!preparationCalls.length) continue;
    const lastPrepare = preparationCalls.at(-1)!;
    const marker = parseMarker(lastPrepare.resultSummary, PREPARE_MARKER);
    if (!marker.found) continue;
    if (
      !marker.valid ||
      lastPrepare.status !== "completed" ||
      lastPrepare.isError !== false
    )
      return undefined;
    const evidence = parseScopeEvidence(marker.value);
    if (!evidence) return undefined;
    preparationCount += 1;
    if (
      evidence.definitionId !== attempt.definitionId ||
      !runtimeEquals(evidence.runtime, attempt.runtime) ||
      evidence.authorTextSha256 !== expectedHash ||
      evidence.authorRequestQuote !== input.expectedQuote ||
      (input.expectedSourceMode &&
        evidence.sourceMode !== input.expectedSourceMode)
    )
      return undefined;

    if (input.baseScope) {
      if (
        !sameScopeFields(evidence, input.baseScope) ||
        evidence.priorAuthorizationId !== input.baseScope.authorizationId ||
        evidence.priorAuthorTextSha256 !== input.baseScope.authorTextSha256 ||
        evidence.authorizationId === input.baseScope.authorizationId
      )
        return undefined;
      const prior = expectedFailures.get(evidence.definitionId);
      if (!prior || !runtimeEquals(prior.runtime, evidence.runtime))
        return undefined;
    } else if (
      evidence.priorAuthorizationId !== undefined ||
      evidence.priorAuthorTextSha256 !== undefined
    ) {
      return undefined;
    }

    if (evidenceScope && !sameAttempt(evidence, evidenceScope))
      return undefined;
    evidenceScope = evidence;
    recoveredScope = input.baseScope ?? {
      authorizationId: evidence.authorizationId,
      authorTextSha256: evidence.authorTextSha256,
      chapter: evidence.chapter,
      chapterCardId: evidence.chapterCardId,
      chapterCardSha256: evidence.chapterCardSha256,
      volumeId: evidence.volumeId,
      volumeSha256: evidence.volumeSha256,
      sourceMode: evidence.sourceMode
    };
    if (definitionIds.has(evidence.definitionId)) return undefined;
    definitionIds.add(evidence.definitionId);

    const deliverCalls = attempt.toolCalls.filter(
      (entry): entry is Record<string, unknown> =>
        isRecord(entry) && entry.name === "deliver_comparison_draft"
    );
    let delivered = false;
    for (const call of deliverCalls) {
      const receipt = parseMarker(call.resultSummary, DELIVERY_MARKER);
      if (
        (call.status === "completed" && call.isError !== false) ||
        (call.status === "error" && call.isError !== true) ||
        (call.status !== "completed" && call.status !== "error")
      )
        return undefined;
      if (receipt.found) {
        if (!receipt.valid) return undefined;
        const delivery = parseDeliveryEvidence(receipt.value);
        if (
          !delivery ||
          delivery.bookId !== "longbook_9a146bbe" ||
          delivery.authorizationId !== evidence.authorizationId ||
          delivery.definitionId !== evidence.definitionId ||
          !runtimeEquals(runtimeRef(delivery.runtime)!, evidence.runtime) ||
          call.status !== "completed" ||
          call.isError !== false
        )
          return undefined;
        delivered = true;
      } else if (call.status === "completed") {
        return undefined;
      }
    }
    if (delivered) continue;
    if (attempt.status === "running") return undefined;
    if (
      attempt.status !== "completed" &&
      attempt.status !== "error" &&
      attempt.status !== "stopped"
    )
      return undefined;
    found.push({
      definitionId: evidence.definitionId,
      runtime: evidence.runtime
    });
  }

  if (!recoveredScope || preparationCount === 0 || found.length === 0)
    return {
      ...(recoveredScope ? { scope: recoveredScope } : {}),
      writers: [],
      complete: false
    };
  return { scope: recoveredScope, writers: found, complete: true };
}

function writingAuthorization(
  text: string
):
  | { quote: string; sourceMode: "independent" | "redraft"; chapter?: number }
  | undefined {
  const redraft = loveRedraftIntent(text);
  const writing = comparisonWritingIntent(text);
  const parallel = parallelWritingRequest(text);
  const intent = redraft ?? writing;
  const quote = intent?.quote ?? parallel;
  if (!quote) return undefined;
  return {
    quote,
    sourceMode: redraft ? "redraft" : "independent",
    ...(intent?.chapter !== undefined ? { chapter: intent.chapter } : {})
  };
}

/** Recover only the exact, still-undelivered writer subset from the latest bound attempt. */
export function recoverLoveFailureContinuation(
  messages: readonly LoveFailureContinuationMessage[],
  continuation: LoveFailureContinuationInput
): LoveFailureContinuationRecovery | undefined {
  const currentIntent =
    continuation && typeof continuation.quote === "string"
      ? loveFailureContinuationIntent(continuation.quote)
      : undefined;
  if (
    !continuation ||
    typeof continuation.quote !== "string" ||
    !continuation.quote.trim() ||
    !currentIntent ||
    (continuation.writerCount !== undefined &&
      (!Number.isInteger(continuation.writerCount) ||
        continuation.writerCount < 1 ||
        continuation.writerCount > 5)) ||
    (continuation.writerCount !== undefined &&
      currentIntent.writerCount !== undefined &&
      continuation.writerCount !== currentIntent.writerCount) ||
    (continuation.chapter !== undefined &&
      (!Number.isInteger(continuation.chapter) ||
        continuation.chapter < 1 ||
        (currentIntent.chapter !== undefined &&
          continuation.chapter !== currentIntent.chapter)))
  )
    return undefined;
  for (let index = 1; index < messages.length; index += 1) {
    if (messages[index]!.position <= messages[index - 1]!.position)
      return undefined;
  }

  let baseScope: AuthorScope | undefined;
  let latest: AttemptResult | undefined;
  for (let index = 0; index < messages.length; index += 1) {
    const user = messages[index]!.value;
    if (user.role !== "user" || typeof user.content !== "string") continue;
    const text = user.content;
    if (loveWritingAuthorizationRevoked(text)) {
      baseScope = undefined;
      latest = undefined;
      continue;
    }

    const assistant = messages[index + 1]?.value;
    const retry = loveFailureContinuationIntent(text);
    if (retry) {
      const previousFailures = latest?.complete ? latest.writers : undefined;
      latest = undefined;
      if (
        !baseScope ||
        !previousFailures?.length ||
        assistant?.role !== "assistant" ||
        (retry.chapter !== undefined && retry.chapter !== baseScope.chapter) ||
        (retry.writerCount !== undefined &&
          retry.writerCount !== previousFailures.length)
      )
        continue;
      latest = analyzeAttempt({
        assistant,
        userText: text,
        expectedQuote: retry.quote,
        expectedSourceMode: baseScope.sourceMode,
        baseScope,
        previousFailures
      });
      continue;
    }

    const authorization = writingAuthorization(text);
    if (authorization) {
      baseScope = undefined;
      latest = undefined;
      if (assistant?.role !== "assistant") continue;
      const attempt = analyzeAttempt({
        assistant,
        userText: text,
        expectedQuote: authorization.quote,
        expectedSourceMode: authorization.sourceMode
      });
      if (!attempt?.scope) continue;
      if (
        authorization.chapter !== undefined &&
        authorization.chapter !== attempt.scope.chapter
      )
        continue;
      baseScope = attempt.scope;
      latest = attempt;
      continue;
    }
  }

  if (!latest || !latest.scope || !latest.complete) return undefined;
  if (
    continuation.chapter !== undefined &&
    continuation.chapter !== latest.scope.chapter
  )
    return undefined;
  if (
    continuation.writerCount !== undefined &&
    continuation.writerCount !== latest.writers.length
  )
    return undefined;
  if (latest.writers.length === 0 || latest.writers.length > 5)
    return undefined;
  return {
    chapter: latest.scope.chapter,
    chapterCardId: latest.scope.chapterCardId,
    chapterCardSha256: latest.scope.chapterCardSha256,
    volumeId: latest.scope.volumeId,
    volumeSha256: latest.scope.volumeSha256,
    sourceMode: latest.scope.sourceMode,
    writers: latest.writers,
    authorizationId: baseScope?.authorizationId ?? latest.scope.authorizationId,
    priorAuthorTextSha256:
      baseScope?.authorTextSha256 ?? latest.scope.authorTextSha256
  };
}
