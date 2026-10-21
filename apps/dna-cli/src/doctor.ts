// dna doctor: Node 24, keys present (names only), the API, the scope matrix, the crontab line, search mode and credits.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DnaClient } from "@dna/sdk";
import { repoRoot } from "@dna/sdk/node";
import { managedLine, readCrontab } from "../../dna-server-cron/src/crontab.ts";
import { probe, type Check } from "./net/probe.ts";
import { searchEngines } from "./print.ts";

// DNA_PROVIDER=anthropic calls Anthropic directly; jev then needs TYPESAFE_API_KEY (or JEV_BACKEND=mock).
const PROVIDER_KEY =
  process.env.DNA_PROVIDER === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENROUTER_API_KEY";
const KEYS = [
  PROVIDER_KEY,
  ...(PROVIDER_KEY === "ANTHROPIC_API_KEY" ? ["TYPESAFE_API_KEY"] : []),
  "OPENAI_API_KEY",
  "FIRECRAWL_API_KEY",
  "DNA_CLIENT_TOKEN",
  "DNA_CRON_TOKEN",
];
const OPTIONAL: Record<string, string> = {
  OPENAI_API_KEY: "missing, cards without a source image show none",
  FIRECRAWL_API_KEY: "missing, search and page reads use the free engines",
};

export async function doctor(
  client: DnaClient,
  tokens: { client?: string; cron?: string },
): Promise<Check[]> {
  const checks: Check[] = [];
  const major = Number(process.versions.node.split(".")[0]);
  checks.push({ name: "Node 24", ok: major >= 24, detail: process.versions.node });
  const envFile = join(repoRoot(), ".env");
  const env = existsSync(envFile) ? readFileSync(envFile, "utf8") : "";
  for (const key of KEYS) {
    const present = new RegExp(`^${key}=.+`, "m").test(env) || !!process.env[key];
    checks.push({
      name: `${key} is set`,
      ok: present || key in OPTIONAL,
      detail: present ? "present" : (OPTIONAL[key] ?? "missing"),
    });
  }
  checks.push(...(await probe(client.baseUrl, tokens)));
  let cronLine: string | undefined;
  try {
    cronLine = managedLine(readCrontab());
  } catch {}
  checks.push({
    name: "crontab line on this machine",
    ok: true,
    detail: cronLine ?? "none: this Mac sweeps on `just cron tick` (always on: just combos local)",
  });
  try {
    const info = await client.info();
    checks.push({ name: "search mode", ok: true, detail: info.searchMode });
    const engines = info.search?.engines ?? [];
    if (engines.length) {
      const resting = (name: string) => {
        const until = engines.find((e) => e.name === name)?.coolingUntil;
        return !!until && Date.parse(until) > Date.now();
      };
      checks.push({
        name: "search engines",
        // News search works while one news engine is not resting (Firecrawl counts in firecrawl mode).
        ok:
          !resting("bing-news") ||
          !resting("google-news") ||
          (info.searchMode === "firecrawl" && !resting("firecrawl")),
        detail: searchEngines(engines),
      });
    }
    if (info.searchMode === "firecrawl")
      checks.push({
        name: "Firecrawl credits",
        ok: (info.firecrawl?.creditsLeft ?? 1) > 0,
        detail: `${info.firecrawl?.creditsLeft ?? "unknown"} left, ${info.firecrawl?.creditsToday ?? 0} of ${info.firecrawl?.dailyCap} used today`,
      });
  } catch (error) {
    checks.push({ name: "API info", ok: false, detail: String((error as Error).message) });
  }
  return checks;
}
