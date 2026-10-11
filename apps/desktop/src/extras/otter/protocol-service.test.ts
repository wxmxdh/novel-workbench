import { createHash } from "node:crypto";
import {
  copyFile,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import { readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { OtterProjectAdapter } from "./project-adapter";
import { createOtterProtocolService } from "./protocol-service";
import type { OtterWorkflowInput } from "@deepwrite/contracts";

const roots: string[] = [];
const hash = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
function validatingV1(projectRoot: string) {
  return {
    loadProject: () => ({ root: projectRoot }),
    checkPack: (
      _project: unknown,
      pack: Record<string, unknown>,
      receipt: Record<string, unknown>
    ) => {
      const sourceChanged = (
        pack.sources as Array<{ path: string; hash: string }>
      ).some((source) => {
        try {
          return (
            hash(readFileSync(join(projectRoot, source.path), "utf8")) !==
            source.hash
          );
        } catch {
          return true;
        }
      });
      const receiptMismatch = receipt.baseline_hash !== pack.baseline_hash;
      return {
        status: sourceChanged || receiptMismatch ? "FAIL" : "PASS",
        context_id: pack.context_id,
        checks: []
      };
    }
  };
}
async function fixture() {
  const workspaceRoot = await mkdtemp(
    join(tmpdir(), "otter-protocol-service-")
  );
  roots.push(workspaceRoot);
  const userDataPath = join(workspaceRoot, "user-data");
  const projectRoot = join(workspaceRoot, "novel");
  await mkdir(join(projectRoot, ".novel", "context"), { recursive: true });
  await mkdir(join(projectRoot, ".novel", "receipts"), { recursive: true });
  await mkdir(join(projectRoot, ".novel", "state", "runs"), {
    recursive: true
  });
  await mkdir(join(projectRoot, ".novel", "state", "preflight"), {
    recursive: true
  });
  const canon = "canon source\n";
  const canonHash = hash(canon);
  await writeFile(join(projectRoot, "canon.md"), canon);
  await writeFile(join(projectRoot, "active.md"), `canon.md\n${canonHash}\n`);
  await writeFile(
    join(projectRoot, ".novel", "derived-registry.json"),
    JSON.stringify({ schema_version: 1, records: [] })
  );
  await writeFile(
    join(projectRoot, ".novel", "project.json"),
    JSON.stringify({
      schema_version: 1,
      project: "Fixture Novel",
      active_source: "active.md",
      canon: { source: "canon.md", hash: canonHash, version: "test" },
      entry_sources: ["AGENTS.md"],
      derived_registry: ".novel/derived-registry.json"
    })
  );
  await writeFile(join(projectRoot, "AGENTS.md"), "fixture entry\n");
  const contextPath = ".novel/context/CTX-TEST-1.json";
  const receiptPath = ".novel/receipts/RCPT-TEST-1.json";
  const pack = {
    context_id: "CTX-TEST-1",
    task_id: "TASK-TEST-1",
    project: "Fixture Novel",
    project_root: "novel",
    task: "draft",
    scope: "fragment",
    target: "fixture fragment",
    pov: "Fixture POV",
    baseline_hash: "integrity-hash",
    comparison_baseline_hash: "comparison-hash",
    chapter: 2,
    volume: "第一卷",
    sources: [
      {
        path: "canon.md",
        hash: canonHash,
        role: "canon",
        authority: "canon",
        line_start: 1,
        line_end: 1,
        content: canon.trim(),
        content_hash: hash(canon.trim())
      }
    ],
    relevant_characters: [],
    relevant_relationships: [],
    knowledge_boundary: [],
    intentional_unknowns: [],
    recent_context: [],
    author_instructions: [],
    skills_allowed: [],
    reference_scope: [],
    warnings: [],
    forbidden_future_info: ["later plot fact"]
  };
  const receipt = {
    receipt_id: "RCPT-TEST-1",
    context_id: pack.context_id,
    baseline_hash: pack.baseline_hash,
    project: pack.project
  };
  await writeFile(join(projectRoot, contextPath), JSON.stringify(pack));
  await writeFile(join(projectRoot, receiptPath), JSON.stringify(receipt));
  await writeFile(
    join(projectRoot, ".novel", "state", "preflight", "preflight-1.json"),
    JSON.stringify({ context_id: pack.context_id, status: "PASS" })
  );
  await writeFile(
    join(projectRoot, ".novel", "state", "runs", `${pack.task_id}.json`),
    JSON.stringify({
      phase: "ready",
      context: contextPath,
      receipt: receiptPath,
      baseline_hash: pack.baseline_hash,
      preflight: ".novel/state/preflight/preflight-1.json"
    })
  );
  const adapter = new OtterProjectAdapter(workspaceRoot, userDataPath);
  const [listed] = await adapter.listProjects();
  return {
    workspaceRoot,
    projectRoot,
    userDataPath,
    adapter,
    projectId: listed!.id,
    contextPath,
    receiptPath,
    pack
  };
}
afterEach(async () =>
  Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  )
);

describe("Otter V1 protocol service", () => {
  it("renders API and agent Context from the same validated snapshots and exposes navigation hashes", async () => {
    const f = await fixture();
    const service = createOtterProtocolService(f.workspaceRoot, f.adapter, {
      loadV1: async () => validatingV1(f.projectRoot)
    });
    const result = await service.context({
      projectId: f.projectId,
      contextPath: f.contextPath
    });
    expect(result).toMatchObject({
      contextId: "CTX-TEST-1",
      baselineHash: "integrity-hash",
      comparisonBaselineHash: "comparison-hash"
    });
    const api = JSON.parse(result.apiText);
    expect(api.contextId).toBe(result.contextId);
    expect(api.sources[0].content).toBe("canon source");
    expect(result.agentText).not.toContain("canon source");
    expect(result.agentText).toContain(
      `canon.md [${hash("canon source\n")}] role=canon L1-1 must_read_fully=false`
    );
    expect(api.navigation.must_read).toEqual([
      {
        path: "canon.md",
        hash: hash("canon source\n"),
        role: "canon",
        lineStart: 1,
        lineEnd: 1,
        mustReadFully: false,
        purpose: "读取Context中绑定的来源快照"
      }
    ]);
    expect(api.navigation.must_not_read_information).toEqual([
      "later plot fact"
    ]);
    expect(api.navigation.note).toMatch(/does not assert.*operating system/i);
    expect(result.apiText).toContain("referenceScope");
  });

  it("fails closed for missing/mismatched/failed preflight and changed underlying sources", async () => {
    const f = await fixture();
    await writeFile(
      join(f.projectRoot, ".novel", "state", "preflight", "preflight-1.json"),
      JSON.stringify({ context_id: "CTX-OTHER", status: "PASS" })
    );
    const mismatched = createOtterProtocolService(f.workspaceRoot, f.adapter, {
      loadV1: async () => validatingV1(f.projectRoot)
    });
    await expect(
      mismatched.context({ projectId: f.projectId, contextPath: f.contextPath })
    ).rejects.toThrow(/does not match/i);
    const changed = await readFile(join(f.projectRoot, "canon.md"), "utf8");
    await writeFile(join(f.projectRoot, "canon.md"), `${changed}modified\n`);
    await expect(
      mismatched.context({ projectId: f.projectId, contextPath: f.contextPath })
    ).rejects.toThrow();
  });

  it("routes through a fixed V1 argument vector and rejects arbitrary commands", async () => {
    const f = await fixture();
    let args: string[] = [];
    const service = createOtterProtocolService(f.workspaceRoot, f.adapter, {
      runCli: async (received) => {
        args = received;
        return { stdout: '{"status":"NEEDS_INPUT","writes":0}', stderr: "" };
      }
    });
    await expect(
      service.route({
        projectId: f.projectId,
        task: "review",
        chapter: 2,
        volume: "第一卷"
      })
    ).resolves.toMatchObject({ status: "NEEDS_INPUT" });
    expect(args.slice(0, 3)).toEqual(["route", "--workspace", f.workspaceRoot]);
    expect(args).toContain("novel");
    await expect(
      service.workflow({
        projectId: f.projectId,
        action: "../../arbitrary" as OtterWorkflowInput["action"],
        input: {}
      })
    ).rejects.toThrow(/Unsupported/);
  });

  it("rejects a V1 import closure that reaches outside its explicit trusted code root", async () => {
    const f = await fixture();
    const trustedRoot = join(f.workspaceRoot, "trusted-v1");
    await mkdir(trustedRoot, { recursive: true });
    const cliPath = join(trustedRoot, "novel-cli.mjs");
    await writeFile(
      cliPath,
      "import '../outside.mjs';\\nexport const SCHEMA = 1;\\n"
    );
    const service = createOtterProtocolService(f.workspaceRoot, f.adapter, {
      v1CliPath: cliPath,
      trustedCliRoot: trustedRoot
    });
    await expect(
      service.workflow({ projectId: f.projectId, action: "derived", input: {} })
    ).rejects.toThrow(/escapes its trusted source root/i);
  });

  it("requires explicit author intent for mutating V1 actions", async () => {
    const f = await fixture();
    const service = createOtterProtocolService(f.workspaceRoot, f.adapter, {
      loadV1: async () => ({ main: () => {} })
    });
    await expect(
      service.workflow({ projectId: f.projectId, action: "accept", input: {} })
    ).rejects.toThrow(/author-intent/i);
  });

  it("runs a complete draft-to-canon loop through the facade in an isolated fixture", async () => {
    const sourceWorkspace = resolve(process.cwd(), "..", "..");
    const cliPath = join(
      sourceWorkspace,
      "06_脚本工具",
      "写作协议V1",
      "novel-cli.mjs"
    );
    if (!existsSync(cliPath)) return;
    const workspaceRoot = await mkdtemp(join(tmpdir(), "otter-v1-e2e-"));
    roots.push(workspaceRoot);
    const userDataPath = join(workspaceRoot, "user-data");
    const projectRoot = join(workspaceRoot, "works", "fixture-novel");
    await mkdir(join(projectRoot, ".novel"), { recursive: true });
    await mkdir(join(projectRoot, "canon"), { recursive: true });
    await mkdir(join(projectRoot, "characters"), { recursive: true });
    await mkdir(join(projectRoot, "004_写作中"), { recursive: true });
    await mkdir(join(workspaceRoot, ".novel", "protocol"), { recursive: true });
    await mkdir(join(workspaceRoot, ".agents", "skills", "otter-novel"), {
      recursive: true
    });
    for (const protocol of [
      "authority",
      "task-routing",
      "chapter-workflow",
      "context-policy",
      "review-policy",
      "canon-policy",
      "third-party-policy",
      "skill-permissions"
    ]) {
      await copyFile(
        join(sourceWorkspace, ".novel", "protocol", `${protocol}.md`),
        join(workspaceRoot, ".novel", "protocol", `${protocol}.md`)
      );
    }
    await copyFile(
      join(sourceWorkspace, "AGENTS.md"),
      join(workspaceRoot, "AGENTS.md")
    );
    await copyFile(
      join(sourceWorkspace, ".agents", "skills", "otter-novel", "SKILL.md"),
      join(workspaceRoot, ".agents", "skills", "otter-novel", "SKILL.md")
    );

    const canon =
      "# Fixture canon\n人物甲是测试人物；关系甲已明确；场景是教室；时间是周一；人物甲只知道名字；人物心理保持未知。\n";
    const canonHash = hash(canon);
    const author =
      [
        "确认本测试章属于第一卷。",
        "授权正文片段。",
        "作者接受本测试稿。",
        "确认候选事实：Fixture fact: the paper crane is blue.",
        "授权登记测试候选队列。"
      ].join("\n") + "\n";
    const authorHash = hash(author);
    const card = "人物甲派生卡，partial。\n";
    const cardHash = hash(card);
    const facts = "";
    const decisions = "";
    await writeFile(join(projectRoot, "canon", "main.md"), canon);
    await writeFile(
      join(projectRoot, "canon", "active-source.md"),
      `main.md\n${canonHash}\n`
    );
    await writeFile(join(projectRoot, "characters", "card.md"), card);
    await writeFile(join(projectRoot, "author.md"), author);
    await writeFile(join(projectRoot, "canon", "facts.jsonl"), facts);
    await writeFile(join(projectRoot, "canon", "decisions.jsonl"), decisions);
    await writeFile(join(projectRoot, "AGENTS.md"), "Fixture project entry.\n");
    const factsHash = hash(facts);
    const decisionsHash = hash(decisions);
    const registry = {
      schema_version: 1,
      project: "Fixture Novel",
      records: [
        {
          path: "characters/card.md",
          hash: cardHash,
          authority: "derived",
          source_canon: "canon/main.md",
          source_hash: canonHash,
          source_version: "test",
          coverage: "partial",
          status: "current",
          verified_at: null,
          source_sections: [
            { path: "canon/main.md", section: "Fixture canon" }
          ],
          dependencies: []
        }
      ]
    };
    const registryText = `${JSON.stringify(registry, null, 2)}\n`;
    await writeFile(
      join(projectRoot, ".novel", "derived-registry.json"),
      registryText
    );
    const manifest = {
      schema_version: 1,
      project: "Fixture Novel",
      active_source: "canon/active-source.md",
      canon: { source: "canon/main.md", version: "fixture-1", hash: canonHash },
      entry_sources: ["AGENTS.md", "canon/active-source.md"],
      confirmed_sources: [
        { path: "canon/facts.jsonl", hash: factsHash },
        { path: "canon/decisions.jsonl", hash: decisionsHash }
      ],
      support_sources: [
        {
          path: "author.md",
          hash: authorHash,
          authority: "evidence",
          scope: "fixture-only"
        }
      ],
      protected_sources: ["canon/main.md"],
      derived_registry: ".novel/derived-registry.json",
      canonical_records: {
        format: "what-is-love-jsonl-v1",
        facts: "canon/facts.jsonl",
        decisions: "canon/decisions.jsonl",
        record_format: "canon/record-format.md"
      },
      reference_sources: []
    };
    const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
    await writeFile(join(projectRoot, ".novel", "project.json"), manifestText);

    const adapter = new OtterProjectAdapter(workspaceRoot, userDataPath);
    const [project] = await adapter.listProjects();
    expect(project).toBeDefined();
    const service = createOtterProtocolService(workspaceRoot, adapter, {
      v1CliPath: cliPath,
      trustedCliRoot: dirname(cliPath),
      userDataPath
    });
    const quote = (text: string) => ({
      path: "author.md",
      hash: authorHash,
      quote: text
    });
    const task = {
      schema_version: 1,
      task_id: "TASK-OTTER-E2E-01",
      context_id: "CTX-OTTER-E2E-01",
      project: "Fixture Novel",
      task: "draft",
      scope: "fragment",
      chapter: 1,
      volume: "第一卷",
      volume_confirmation: {
        actor: "user",
        scope: { project: "Fixture Novel", chapter: 1, volume: "第一卷" },
        ...quote("确认本测试章属于第一卷")
      },
      target: "requested-fragment.md",
      pov: "人物甲",
      relevant_characters: ["人物甲"],
      relevant_relationships: ["关系甲"],
      knowledge_boundary: ["只知道名字"],
      intentional_unknowns: ["人物心理保持未知"],
      recent_context: [],
      author_instructions: ["仅写测试片段，不新增真实作品事实。"],
      skills_allowed: ["otter-novel"],
      reference_scope: [],
      forbidden_future_info: ["未来章节事实"],
      authorization: {
        action: "draft",
        scope: "requested-fragment.md",
        evidence: quote("授权正文片段")
      },
      sources: [
        {
          path: "canon/main.md",
          role: "character",
          entities: ["人物甲"],
          section: "人物甲"
        },
        {
          path: "canon/main.md",
          role: "relationship",
          entities: ["关系甲"],
          section: "关系甲"
        },
        ...["scene", "timeline", "knowledge", "unknown"].map((role) => ({
          path: "canon/main.md",
          role,
          section: role
        }))
      ]
    };
    const prepared = await service.workflow({
      projectId: project!.id,
      action: "prepare",
      input: task
    });
    expect(prepared.status).toBe("PASS");
    if (
      typeof prepared.pack !== "string" ||
      typeof prepared.receipt !== "string"
    )
      throw new Error("V1 prepare did not return pack and receipt paths.");
    const contextPath = relative(projectRoot, prepared.pack)
      .split(sep)
      .join("/");
    const receiptPath = relative(projectRoot, prepared.receipt)
      .split(sep)
      .join("/");
    const preflight = await service.workflow({
      projectId: project!.id,
      action: "preflight",
      input: {},
      contextPath,
      receiptPath
    });
    expect(preflight.status).toBe("PASS");
    const expanded = await service.context({
      projectId: project!.id,
      contextPath,
      receiptPath
    });
    expect(expanded.contextId).toBe("CTX-OTTER-E2E-01");
    expect(expanded.apiText).toContain("人物心理保持未知");

    const draftBody = "Fixture fact: the paper crane is blue.";
    const sessionId = `otter:${project!.id}:${task.context_id}:run-provider-1`;
    const sessionFile = join(
      userDataPath,
      "otter",
      "runtime-evidence",
      "run-provider-1.jsonl"
    );
    await mkdir(join(userDataPath, "otter", "runtime-evidence"), {
      recursive: true
    });
    await writeFile(
      sessionFile,
      `${JSON.stringify({
        schema_version: 1,
        type: "deepwrite_response",
        workspaceRoot,
        projectId: project!.id,
        contextId: task.context_id,
        sessionId,
        runId: "run-provider-1",
        runtime: {
          provider: "fixture-provider",
          model: "gemini-3.8-flash-high",
          mode: "provider"
        },
        contentHash: hash(draftBody),
        completedAt: "2026-10-01T12:00:00.000Z"
      })}\n`
    );
    const delivered = await service.stageDraft({
      projectId: project!.id,
      contextPath,
      receiptPath,
      body: draftBody,
      title: "隔离测试片段",
      authorIntent: "仅在隔离 fixture 验证 V1 正文交付门禁。",
      sessionFile,
      sessionId
    });
    expect(delivered.phase).toBe("awaiting_author_review");
    expect(delivered.model).toBe("gemini-3.8-flash");
    expect(delivered.identity).toMatchObject({
      generator: "deepwrite",
      model_raw: "gemini-3.8-flash-high",
      physical_upstream_verified: false,
      model_evidence: {
        kind: "deepwrite-runtime-model",
        session_id: sessionId,
        context_id: task.context_id
      }
    });
    const artifact = String(delivered.artifact);
    const artifactHash = hash(
      await readFile(join(projectRoot, artifact), "utf8")
    );
    const acceptance = { scope: artifact, evidence: quote("作者接受本测试稿") };
    const accepted = await service.workflow({
      projectId: project!.id,
      action: "accept",
      authorIntent: "接受隔离 fixture 稿件以测试候选门禁。",
      input: {
        task_id: task.task_id,
        source_file: artifact,
        source_hash: artifactHash,
        acceptance
      }
    });
    expect(accepted.phase).toBe("accepted");

    const candidateInput = {
      schema_version: 1,
      queue_id: "CAND-OTTER-E2E-01",
      project: "Fixture Novel",
      chapter: 1,
      source_file: artifact,
      source_hash: artifactHash,
      acceptance,
      items: [
        {
          id: "001",
          candidate: draftBody,
          evidence: draftBody,
          category: "character",
          existing_canon: "new",
          information_state: "draft_only",
          affectedDerivedFiles: ["characters/card.md"]
        }
      ]
    };
    const candidateResult = await service.workflow({
      projectId: project!.id,
      action: "candidates",
      authorIntent: "仅在隔离 fixture 建立候选队列。",
      input: candidateInput
    });
    expect(candidateResult.file).toContain("CAND-OTTER-E2E-01.json");
    const decision = await service.workflow({
      projectId: project!.id,
      action: "decision",
      authorIntent: "作者确认隔离测试候选用于验证事务。",
      input: {
        project: "Fixture Novel",
        queue_id: "CAND-OTTER-E2E-01",
        items: [
          {
            id: "001",
            choice: "canon",
            scope: draftBody,
            evidence: quote(
              "确认候选事实：Fixture fact: the paper crane is blue."
            ),
            fact: {
              id: "F-OTTER-E2E-01",
              statement: draftBody,
              entities: ["Fixture Novel"],
              layer: "objective",
              story_time: null,
              supersedes: []
            }
          }
        ]
      }
    });
    expect(decision.statuses).toEqual([{ id: "001", status: "confirmed" }]);
    const expectedHashes = {
      facts: hash(await readFile(join(projectRoot, "canon", "facts.jsonl"))),
      decisions: hash(
        await readFile(join(projectRoot, "canon", "decisions.jsonl"))
      ),
      registry: hash(
        await readFile(join(projectRoot, ".novel", "derived-registry.json"))
      ),
      config: hash(await readFile(join(projectRoot, ".novel", "project.json")))
    };
    const committed = await service.workflow({
      projectId: project!.id,
      action: "commit",
      authorIntent: "在隔离 fixture 验证显式正典提交事务。",
      input: {
        action: "canon",
        scope: "CAND-OTTER-E2E-01",
        evidence: quote("授权登记测试候选队列。"),
        expected_hashes: expectedHashes
      }
    });
    expect(committed.phase).toBe("committed");
    expect(
      await readFile(join(projectRoot, "canon", "facts.jsonl"), "utf8")
    ).toContain(draftBody);
    expect(
      JSON.parse(
        await readFile(
          join(projectRoot, ".novel", "derived-registry.json"),
          "utf8"
        )
      ).records[0].status
    ).toBe("stale");
    expect(await readFile(join(projectRoot, "canon", "main.md"), "utf8")).toBe(
      canon
    );
    expect(
      await readFile(join(projectRoot, "characters", "card.md"), "utf8")
    ).toBe(card);
  }, 60_000);
});
