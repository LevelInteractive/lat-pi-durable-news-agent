import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadConfig } from "../src/config.ts";
import { openApp } from "../src/runtime.ts";
import { fauxApp } from "./helpers.ts";

test("DNA_PROVIDER picks openrouter by default, anthropic or faux when named", () => {
  assert.equal(loadConfig([], {}).provider, "openrouter");
  assert.equal(loadConfig([], { DNA_PROVIDER: "anthropic" }).provider, "anthropic");
  assert.equal(loadConfig([], { DNA_PROVIDER: "faux" }).provider, "faux");
  assert.equal(loadConfig([], { DNA_PROVIDER: "other" }).provider, "openrouter");
});

test("an anthropic app reports the catalog id of its main model, with no turn taken", async () => {
  const { app, cleanup } = await fauxApp({
    DNA_PROVIDER: "anthropic",
    DNA_MODEL: "anthropic/claude-sonnet-5.5",
  });
  try {
    assert.equal(app.catalog.provider, "anthropic");
    assert.deepEqual(await app.mainModel(), {
      id: "anthropic/claude-sonnet-5.5",
      window: 1_000_000,
    });
  } finally {
    await cleanup();
  }
});

test("reopening a faux data dir on anthropic moves the main agent onto the anthropic catalog", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dna-switch-"));
  process.env.DNA_LOG_DIR = join(dir, "logs");
  const open = (provider: string) =>
    openApp(
      loadConfig([], {
        ...process.env,
        DNA_PROVIDER: provider,
        DNA_MODEL: "anthropic/claude-haiku-5.5",
        DNA_SEARCH_MODE: "fixture",
        DNA_DATA_DIR: dir,
      }),
    );
  try {
    const faux = await open("faux");
    await faux.close();
    const anthropic = await open("anthropic");
    try {
      const agent = await anthropic.main.agent(anthropic.ctx);
      assert.deepEqual(agent.model, { provider: "anthropic", modelId: "claude-haiku-5-5" });
      assert.equal((await anthropic.mainModel()).id, "anthropic/claude-haiku-5.5");
    } finally {
      await anthropic.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
