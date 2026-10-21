import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import {
  ANTHROPIC_CATALOG,
  anthropicModelId,
  CATALOG,
  createModelCatalog,
  DEFAULT_MODEL,
  say,
} from "../src/index.ts";
import { ask, fauxHarness, tempDir } from "./helpers.ts";

test("the catalog defaults to Haiku 5.5 and every id resolves in pi-ai 1.1.0 OpenRouter", () => {
  assert.equal(DEFAULT_MODEL, "anthropic/claude-haiku-5.5");
  assert.equal(CATALOG.length, 30);
  const catalog = createModelCatalog({ provider: "openrouter" });
  assert.deepEqual(catalog.defaultModel, {
    provider: "openrouter",
    modelId: "anthropic/claude-haiku-5.5",
  });
  const list = catalog.list();
  assert.equal(list.length, 30);
  assert.equal(list[0].contextWindow, 1_000_000);
  assert.throws(() => catalog.ref("made/up-model"), /Unknown model/);
});

test("the anthropic catalog keeps the catalog ids and refs the Anthropic API ids in pi-ai 1.1.0", () => {
  assert.equal(anthropicModelId("anthropic/claude-haiku-5.5"), "claude-haiku-5-5");
  assert.equal(anthropicModelId("anthropic/claude-opus-5"), "claude-opus-5");
  const catalog = createModelCatalog({ provider: "anthropic" });
  assert.equal(catalog.provider, "anthropic");
  assert.deepEqual(catalog.defaultModel, { provider: "anthropic", modelId: "claude-haiku-5-5" });
  const list = catalog.list();
  assert.equal(list.length, ANTHROPIC_CATALOG.length);
  assert.ok(list.every((m) => m.id.startsWith("anthropic/") && m.provider === "anthropic"));
  assert.equal(catalog.info("claude-haiku-5-5"), undefined, "info takes catalog ids only");
  assert.equal(catalog.info("anthropic/claude-sonnet-5.5")?.contextWindow, 1_000_000);
  assert.ok(catalog.models.getModel("anthropic", catalog.ref("anthropic/claude-opus-5.5").modelId));
  assert.throws(() => catalog.ref("openai/gpt-6-astra"), /Unknown model/);
  assert.deepEqual(
    createModelCatalog({ provider: "anthropic", defaultModel: "anthropic/claude-sonnet-5.5" })
      .defaultModel,
    { provider: "anthropic", modelId: "claude-sonnet-5-5" },
  );
});

test("the harness stores in WAL, answers on the faux model, and offers no bash or file tools", async () => {
  const t = tempDir();
  try {
    const { ctx, root, close } = await fauxHarness(
      t.dir,
      [(turn) => say(`hello ${turn.lastUser}`)],
      [],
    );
    const settled = await ask(root, ctx, "world");
    assert.equal(settled.status, "done");
    const agent = await root.agent(ctx);
    assert.deepEqual(
      agent.tools.map((x) => x.name),
      [],
    );
    const db = new DatabaseSync(join(t.dir, "agent.sqlite"));
    assert.equal((db.prepare("PRAGMA journal_mode").get() as any).journal_mode, "wal");
    db.close();
    await close();
  } finally {
    t.cleanup();
  }
});

test("a second process cannot open the same agent database", async () => {
  const t = tempDir();
  try {
    const first = await fauxHarness(t.dir, [], []);
    const other = spawnSync(
      process.execPath,
      ["--import", "tsx", join(import.meta.dirname, "fixtures/host.ts"), t.dir, "resume"],
      { encoding: "utf8", env: { ...process.env, NODE_NO_WARNINGS: "1" } },
    );
    assert.notEqual(other.status, 0);
    assert.match(other.stderr, /already owned by process/);
    await first.close();
  } finally {
    t.cleanup();
  }
});
