// Live jev on three fixture items with known answers. Run with: just test jev-live
import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { loadRootEnv } from "../../dna-sdk/src/node/env.ts";
import { JevClient, JevLedger, loadCommand, rankHfs, runCommand } from "../src/index.ts";

loadRootEnv();
const DIR = join(import.meta.dirname, "../../../../dna-server-api/prompt_engineering/jev");
const live = process.env.JEV_LIVE === "1";

const BASE = {
  findings: "",
  section_keywords: {
    hype: ["AGI", "10x", "game changer"],
    facts: ["changelog", "release notes"],
    signal: ["breaking change", "migration"],
  },
  taste_examples: [],
};
const ITEMS = [
  {
    expect: "hype",
    title: "This new AI agent will replace every engineer by next month, insiders say",
    source: "viral thread",
    excerpt:
      "Insiders claim the secret model is 100x smarter than anything public. No benchmarks or release date, but investors are calling it the biggest game changer in history. AGI is basically here.",
  },
  {
    expect: "facts",
    title: "Release notes for libfoo 3.4.1",
    source: "github.com/libfoo/releases",
    excerpt:
      "3.4.1 fixes a rounding bug in the date parser (#4512) and updates the license year. The full changelog and commit list are linked. Measured parse time is unchanged at 1.2 ms per call.",
  },
  {
    expect: "signal",
    title: "Breaking change: the Agents API removes v1 tool schemas on November 1",
    source: "docs.example.dev/changelog",
    excerpt:
      "On November 1, requests using v1 tool schemas will fail with HTTP 400. Migrate now by renaming input_schema to parameters and setting strict: true. A codemod is available: npx agents-migrate. Teams that do not migrate will see every tool call fail.",
  },
];

test(
  "live hfs ranks the three fixtures as expected",
  { skip: !live && "set JEV_LIVE=1" },
  async () => {
    // JEV_BACKEND=typesafe runs it on TYPESAFE_API_KEY (direct), else OpenRouter.
    const client = new JevClient({
      provider: process.env.JEV_BACKEND === "typesafe" ? "typesafe" : "openrouter",
    });
    const ledger = new JevLedger();
    const cmd = loadCommand("hfs", DIR);
    for (const item of ITEMS) {
      const { result } = await runCommand(cmd, { ...BASE, ...item }, (s, q, o) =>
        client.systemOne(s, q, o),
      );
      ledger.record(result, { command: cmd.name, version: cmd.version });
      const ranked = rankHfs(result.answers, cmd.policy);
      console.log(
        `${item.expect.padEnd(6)} -> ${ranked.ranked.map((r) => `${r.category} ${r.score}`).join(", ")} | ${result.meta.elapsedMs} ms | $${result.meta.cost.amount} (${result.meta.cost.source}) | ${result.meta.resolvedModel}`,
      );
      assert.equal(ranked.primary, item.expect, item.title);
    }
    console.log(ledger.summary());
  },
);
