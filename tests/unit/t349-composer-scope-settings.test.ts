// covers: function:validateScopeSettings, function:scopeSettingsOffList,
// function:ceremonyOffList, function:scopeSettingsOf,
// function:composerProposalErrors, function:matchedCreationFlags,
// function:nearestUncappedStock, function:killSwitchAdvisories,
// subcommand:aidlc-graph:validate-grid, subcommand:aidlc-utility:config-get,
// subcommand:aidlc-utility:scope-change, subcommand:aidlc-utility:intent-create
//
// t349 - the composer's scope settings. A front/report proposal carries the four
// scope-file settings (sensors, learnings, summary_confirmation, review_cap)
// beside its grid; the validator checks each against the words the scope loader
// accepts, echoes the accepted set in key order, and names what it switches off
// in summary.off. A routed final run (--matched <stock> or --custom) requires
// the settings and a Guard Policy. A matched proposal writes no scope file, so
// the settings it changes apply to this piece of work only: --matched keeps the
// stock grid, accepts any ceremony value and reviews at or below the stock cap,
// and echoes the creation flags that apply them, which reach the new workflow
// without writing a scope. A custom scope file declaring the values is honored
// by the resolvers. Mid-workflow, settings requests become next flags the
// conductor applies without a gate; stronger reviews than the running scope
// allows move the work to the nearest uncapped stock scope; a kill switch is
// reported, never searched for.

import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  composerProposalErrors,
  killSwitchAdvisories,
  matchedCreationFlags,
  nearestStockScopes,
  nearestUncappedStock,
  SCOPE_SETTING_KEYS,
  scopeSettingsOf,
  validateScopeSettings,
} from "../../core/tools/aidlc-graph.ts";
import {
  CEREMONY_ENV,
  CEREMONY_KEYS,
  ceremonyOffList,
  ceremonyPolicyValues,
  loadScopeMapping,
  loadScopeMetadataAll,
  resolveCeremony,
  resolveReviewClass,
  scopeSettingsOffList,
} from "../../core/tools/aidlc-lib.ts";
import { assertComposedScopeSettings } from "../harness/composed-scope.ts";
import {
  AIDLC_SRC,
  cleanupTestProject,
  createTestProject,
  FIXTURES_DIR,
  removeWorkspaceRecord,
  runOrchestrateNext,
  seedAidlcMemory,
  seedStateFile,
  seededRecordDir,
  withEnvAndFreshCaches,
} from "../harness/fixtures.ts";

const BUN = process.execPath;
const GRAPH_TOOL = join(AIDLC_SRC, "tools", "aidlc-graph.ts");
const ORCH = join(AIDLC_SRC, "tools", "aidlc-orchestrate.ts");
const UTIL = join(AIDLC_SRC, "tools", "aidlc-utility.ts");
const REPO_ROOT = join(import.meta.dir, "..", "..");
const POLICY_ENV = {
  AIDLC_HARNESS_DIR: ".claude",
  AIDLC_SCOPE_MAPPING: undefined,
  AIDLC_SCOPE_GRID: join(AIDLC_SRC, "tools", "data", "scope-grid.json"),
  AIDLC_STAGE_GRAPH: join(AIDLC_SRC, "tools", "data", "stage-graph.json"),
  AIDLC_SCOPES_DIR: join(REPO_ROOT, "core", "scopes"),
  AIDLC_DISABLE_SENSORS: "0",
  AIDLC_DISABLE_LEARNINGS: "0",
  AIDLC_DISABLE_SUMMARY_CONFIRMATION: "0",
};
const QUICK_FIX = {
  sensors: "off",
  learnings: "off",
  summary_confirmation: "on",
  review_cap: "none",
} as const;
const STOCK_ON = { sensors: "on", learnings: "on", summary_confirmation: "on", review_cap: "adversarial" } as const;
const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) cleanupTestProject(tempDirs.pop()!);
});

function project(): string {
  const proj = createTestProject();
  tempDirs.push(proj);
  seedAidlcMemory(proj);
  return proj;
}

function runValidateGrid(proj: string, proposal: unknown, extra: string[] = []) {
  const proposalPath = join(proj, "proposal.json");
  writeFileSync(proposalPath, JSON.stringify(proposal), "utf-8");
  const result = spawnSync(
    BUN,
    [GRAPH_TOOL, "validate-grid", "--proposal", proposalPath, ...extra, "--project-dir", proj],
    { encoding: "utf-8", env: { ...process.env, CLAUDE_PROJECT_DIR: proj } },
  );
  return { rc: result.status ?? -1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function stockGrid(scope: string): Record<string, "EXECUTE" | "SKIP"> {
  return withEnvAndFreshCaches(POLICY_ENV, () => loadScopeMapping()[scope].stages);
}

describe("t349 (1) validateScopeSettings checks the four settings", () => {
  test("a full valid set passes and is rebuilt in key order", () => {
    const shuffled = { review_cap: "advisory", summary_confirmation: "off", learnings: "on", sensors: "off" };
    const checked = validateScopeSettings(shuffled);
    expect(checked.errors).toEqual([]);
    expect(checked.settings).toEqual({
      sensors: "off",
      learnings: "on",
      summary_confirmation: "off",
      review_cap: "advisory",
    });
    expect(Object.keys(checked.settings ?? {})).toEqual([...SCOPE_SETTING_KEYS]);
    for (const cap of ["adversarial", "advisory", "none"]) {
      expect(validateScopeSettings({ ...QUICK_FIX, review_cap: cap }).errors, cap).toEqual([]);
    }
  });

  test("anything but an object is refused with one error", () => {
    for (const raw of [null, "off", 3, ["sensors"]]) {
      expect(validateScopeSettings(raw), JSON.stringify(raw)).toEqual({
        settings: null,
        errors: ["Scope settings must be an object naming sensors, learnings, summary_confirmation, review_cap."],
      });
    }
  });

  test("unknown keys, missing keys, and words the loader would reject are each named", () => {
    const checked = validateScopeSettings({ sensors: "On", learnings: false, review: "none" });
    expect(checked.settings).toBeNull();
    expect(checked.errors).toEqual([
      'Scope settings name unknown key "review" (expected sensors, learnings, summary_confirmation, review_cap).',
      "Scope settings are missing summary_confirmation, review_cap. Name all four.",
      'Scope setting sensors must be one of: on, off (got "On").',
      "Scope setting learnings must be one of: on, off (got false).",
    ]);
    expect(validateScopeSettings({ ...QUICK_FIX, review_cap: "light" }).errors).toEqual([
      'Scope setting review_cap must be one of: adversarial, advisory, none (got "light").',
    ]);
  });
});

describe("t349 (2) the off list is the same whether it comes from settings or a scope", () => {
  test("labels follow the fixed order, and only a none cap drops reviewers", () => {
    expect(scopeSettingsOffList("none", { sensors: "off", learnings: "off", summary_confirmation: "off" }))
      .toEqual(["reviewers", "sensors", "learnings ritual", "summary confirmation"]);
    expect(scopeSettingsOffList("advisory", { sensors: "on", learnings: "off", summary_confirmation: "on" }))
      .toEqual(["learnings ritual"]);
    expect(scopeSettingsOffList(undefined, { sensors: "on", learnings: "on", summary_confirmation: "on" }))
      .toEqual([]);
  });

  test("ceremonyOffList for every stock scope reads its own review_cap through the shared helper", () => {
    withEnvAndFreshCaches(POLICY_ENV, () => {
      const metadata = loadScopeMetadataAll();
      for (const scope of Object.keys(metadata)) {
        const policy = ceremonyPolicyValues(scope, "");
        expect(ceremonyOffList(scope, policy), scope).toEqual(
          scopeSettingsOffList(metadata[scope].reviewCap, policy),
        );
      }
      expect(ceremonyOffList("express", ceremonyPolicyValues("express", ""))).toEqual([
        "reviewers", "sensors", "learnings ritual", "summary confirmation",
      ]);
    });
  });
});

describe("t349 (3) stock values and the nearest uncapped scope", () => {
  test("scopeSettingsOf reads declared values and fills the resolver defaults", () => {
    withEnvAndFreshCaches(POLICY_ENV, () => {
      expect(scopeSettingsOf("express")).toEqual({
        sensors: "off", learnings: "off", summary_confirmation: "off", review_cap: "none",
      });
      // feature declares no review_cap, so the cap reads as adversarial (no cap).
      expect(scopeSettingsOf("feature")).toEqual(STOCK_ON);
      expect(scopeSettingsOf("bugfix")?.review_cap).toBe("advisory");
      expect(scopeSettingsOf("no-such-scope")).toBeNull();
    });
  });

  test("nearestUncappedStock walks the ranking and skips capped scopes", () => {
    withEnvAndFreshCaches(POLICY_ENV, () => {
      expect(nearestUncappedStock([
        { scope: "bugfix", diff: 0 },
        { scope: "poc", diff: 3 },
        { scope: "refactor", diff: 4 },
      ])).toEqual({ scope: "refactor", diff: 4 });
      expect(nearestUncappedStock([{ scope: "express", diff: 0 }, { scope: "bugfix", diff: 2 }])).toBeNull();
      expect(nearestUncappedStock([])).toBeNull();
    });
  });
});

describe("t349 (4) validate-grid carries the settings with the grid", () => {
  test("accepted settings are echoed and fill summary.off", () => {
    const proj = project();
    const ok = runValidateGrid(proj, { stages: stockGrid("feature"), scopeSettings: QUICK_FIX });
    expect(ok.rc, ok.stderr).toBe(0);
    const result = JSON.parse(ok.stdout);
    expect(result.valid).toBe(true);
    expect(result.scope_settings).toEqual(QUICK_FIX);
    expect(result.summary.off).toEqual(["reviewers", "sensors", "learnings ritual"]);
    expect(result.advisories).toEqual([]);
  });

  test("a proposal without settings validates as before, and every run names the nearest uncapped scope", () => {
    const proj = project();
    const bare = runValidateGrid(proj, { stages: stockGrid("bugfix") });
    expect(bare.rc, bare.stderr).toBe(0);
    const result = JSON.parse(bare.stdout);
    expect(result.scope_settings).toBeUndefined();
    expect(result.summary.off).toEqual([]);
    const expected = withEnvAndFreshCaches(POLICY_ENV, () => nearestUncappedStock(result.nearest_stock));
    expect(result.nearest_uncapped).toEqual(expected);
    expect(withEnvAndFreshCaches(POLICY_ENV, () => scopeSettingsOf(result.nearest_uncapped.scope)?.review_cap)).toBe("adversarial");
  });

  test("rejected settings fail the grid and are not echoed", () => {
    const proj = project();
    const bad = runValidateGrid(proj, {
      stages: stockGrid("feature"),
      scopeSettings: { ...QUICK_FIX, sensors: "disabled" },
    });
    expect(bad.rc).toBe(1);
    const result = JSON.parse(bad.stdout);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Scope setting sensors must be one of: on, off (got "disabled").');
    expect(result.scope_settings).toBeUndefined();
    expect(result.summary.off).toEqual([]);
  });
});

describe("t349 (5) a matched plan applies its changes to this piece of work only", () => {
  const given = { scopeSettings: true, guardPolicy: true };

  test("composerProposalErrors requires the settings and a Guard Policy on either route", () => {
    withEnvAndFreshCaches(POLICY_ENV, () => {
      const nearest = nearestStockScopes(loadScopeMapping().feature.stages);
      expect(composerProposalErrors(null, { scopeSettings: false, guardPolicy: false }, null, null, nearest)).toEqual([
        "A custom proposal must carry scopeSettings (sensors, learnings, summary_confirmation, review_cap).",
        "A custom proposal must carry a Guard Policy (--guard-policy or a guardPolicy member).",
      ]);
      expect(composerProposalErrors(null, given, { ...QUICK_FIX }, "off", nearest)).toEqual([]);
    });
  });

  test("matched keeps the stock grid and Guard Policy, takes any ceremony, and refuses reviews above the cap", () => {
    withEnvAndFreshCaches(POLICY_ENV, () => {
      const featureNearest = nearestStockScopes(loadScopeMapping().feature.stages);
      expect(composerProposalErrors("feature", given, { ...STOCK_ON }, "relaxed", featureNearest)).toEqual([]);
      expect(composerProposalErrors("feature", given, { ...STOCK_ON }, "strict", featureNearest)).toEqual([]);
      // Ceremonies either way and reviews down are per-workflow changes, so they pass.
      expect(composerProposalErrors("feature", given, { ...QUICK_FIX }, "relaxed", featureNearest)).toEqual([]);
      expect(composerProposalErrors("feature", given, { ...STOCK_ON }, "off", featureNearest)).toEqual([
        'Stock scope "feature" defaults Guard Policy to relaxed, but the proposal shows off. Show relaxed (or strict, which creation applies), or propose it as custom.',
      ]);
      const bugfixNearest = nearestStockScopes(loadScopeMapping().bugfix.stages);
      expect(composerProposalErrors("bugfix", given, { ...STOCK_ON }, "relaxed", bugfixNearest)).toEqual([
        'Stock scope "bugfix" caps reviews at advisory, and a setting for one piece of work can only lower that; to run adversarial reviews, propose it as custom.',
      ]);
      const [grid] = composerProposalErrors("express", given, scopeSettingsOf("express"), "off", featureNearest);
      expect(grid).toStartWith('A matched proposal carries stock scope "express"\'s grid verbatim; this grid differs on ');
      expect(composerProposalErrors("nope", given, { ...STOCK_ON }, "relaxed", featureNearest)).toEqual([
        '--matched names "nope", which is not a stock scope.',
      ]);
    });
  });

  test("matchedCreationFlags names exactly the values that differ from the stock scope", () => {
    withEnvAndFreshCaches(POLICY_ENV, () => {
      expect(matchedCreationFlags("feature", { ...STOCK_ON })).toEqual([]);
      expect(matchedCreationFlags("feature", { ...QUICK_FIX })).toEqual(["--sensors off", "--learnings off", "--review none"]);
      // bugfix already caps at advisory, so advisory needs no flag; turning learnings off does.
      expect(matchedCreationFlags("bugfix", { ...STOCK_ON, learnings: "off", review_cap: "advisory" })).toEqual(["--learnings off"]);
      expect(matchedCreationFlags("express", { ...QUICK_FIX, sensors: "on" })).toEqual([
        "--sensors on", "--summary-confirmation on",
      ]);
    });
  });

  test("the CLI echoes the route and creation flags, and refuses reviews above the cap or a double route", () => {
    const proj = project();
    const ok = runValidateGrid(proj, { stages: stockGrid("feature"), scopeSettings: QUICK_FIX, guardPolicy: "relaxed" }, ["--matched", "feature"]);
    expect(ok.rc, ok.stdout + ok.stderr).toBe(0);
    expect(JSON.parse(ok.stdout)).toMatchObject({
      valid: true,
      routing: "matched",
      matched_scope: "feature",
      creation_flags: ["--sensors off", "--learnings off", "--review none"],
    });
    const up = runValidateGrid(proj, { stages: stockGrid("bugfix"), scopeSettings: STOCK_ON, guardPolicy: "relaxed" }, ["--matched", "bugfix"]);
    expect(up.rc).toBe(1);
    const refused = JSON.parse(up.stdout);
    expect(refused.routing).toBeUndefined();
    expect(refused.creation_flags).toBeUndefined();
    expect(refused.errors).toContain(
      'Stock scope "bugfix" caps reviews at advisory, and a setting for one piece of work can only lower that; to run adversarial reviews, propose it as custom.',
    );
    const custom = runValidateGrid(proj, { stages: stockGrid("bugfix"), scopeSettings: STOCK_ON, guardPolicy: "relaxed" }, ["--custom"]);
    expect(custom.rc, custom.stdout + custom.stderr).toBe(0);
    expect(JSON.parse(custom.stdout)).toMatchObject({ valid: true, routing: "custom" });
    expect(JSON.parse(custom.stdout).creation_flags).toBeUndefined();
    const both = runValidateGrid(proj, { stages: stockGrid("feature"), scopeSettings: STOCK_ON }, ["--matched", "feature", "--custom"]);
    expect(both.rc).toBe(1);
    expect(both.stderr).toContain("validate-grid: pass --matched <stock-scope> or --custom, not both.");
    const bare = runValidateGrid(proj, { stages: stockGrid("feature") }, ["--matched"]);
    expect(bare.rc).toBe(1);
    expect(bare.stderr).toContain("validate-grid: --matched requires <stock-scope>.");
  });

  test("the creation flags reach the new workflow, and no scope file is written", () => {
    // An empty workspace, the way t198 makes one: no intent yet, so next creates one.
    const proj = createTestProject();
    tempDirs.push(proj);
    removeWorkspaceRecord(proj);
    // The conductor appends creationFlags after --scope; next carries them into creation.
    const next = runOrchestrateNext(ORCH, proj, ["--scope", "bugfix", "--learnings", "off", "--review", "none", "--", "fix the token bug"], {
      cwd: proj,
      env: process.env,
    });
    const line = next.out.split("\n").find((entry) => entry.trim().startsWith("{"));
    const message = String((JSON.parse(line ?? "{}") as { message?: unknown }).message);
    expect(message).toContain("--learnings off");
    expect(message).toContain("--review none");
    const created = spawnSync(BUN, [UTIL, "intent-create", "--scope", "bugfix", "--learnings", "off", "--review", "none", "--project-dir", proj], {
      encoding: "utf-8",
      env: { ...process.env, CLAUDE_PROJECT_DIR: proj },
    });
    expect(created.status, created.stdout + created.stderr).toBe(0);
    const intents = join(proj, "aidlc", "spaces", "default", "intents");
    const record = readFileSync(join(intents, "active-intent"), "utf-8").trim();
    const state = readFileSync(join(intents, record, "aidlc-state.md"), "utf-8");
    expect(state).toContain("- **Scope**: bugfix");
    expect(state).toContain("- **Learnings**: off (set by you)");
    expect(state).toContain("- **Review Override**: none");
    withEnvAndFreshCaches(POLICY_ENV, () => {
      expect(resolveCeremony("learnings", "bugfix", state).value).toBe("off");
      expect(resolveReviewClass("adversarial", "bugfix", state)).toBe("none");
    });
    // Stock bugfix itself is untouched and no composed scope was written.
    expect(existsSync(join(proj, "aidlc", "scopes")) ? readdirSync(join(proj, "aidlc", "scopes")) : []).toEqual([]);
  });
});

describe("t349 (6) a kill switch wins over an on setting, at the gate and mid-workflow", () => {
  const ALL_ON = { sensors: "on", learnings: "on", summary_confirmation: "on", review_cap: "adversarial" } as const;
  const switches = (on: string[]) =>
    Object.fromEntries(CEREMONY_KEYS.map((key) => [CEREMONY_ENV[key], on.includes(key) ? "1" : "0"]));

  test("killSwitchAdvisories names each on ceremony a switch forces off, and nothing else", () => {
    expect(killSwitchAdvisories({ ...ALL_ON }, switches([]))).toEqual([]);
    expect(killSwitchAdvisories({ ...ALL_ON }, switches(["sensors"]))).toEqual([
      "sensors is on in these settings, but AIDLC_DISABLE_SENSORS forces it off on this machine; " +
        "the scope still stores on, and the ceremony runs once that switch is cleared.",
    ]);
    const all = killSwitchAdvisories({ ...ALL_ON }, switches([...CEREMONY_KEYS]));
    expect(all.map((line) => line.split(" ")[0])).toEqual([...CEREMONY_KEYS]);
    // An off setting is already off: the switch changes nothing the gate shows.
    expect(killSwitchAdvisories({ ...QUICK_FIX }, switches([...CEREMONY_KEYS]))).toEqual([
      "summary_confirmation is on in these settings, but AIDLC_DISABLE_SUMMARY_CONFIRMATION forces it off on this machine; " +
        "the scope still stores on, and the ceremony runs once that switch is cleared.",
    ]);
  });

  test("validate-grid reports the switch beside a routed proposal", () => {
    const proj = project();
    writeFileSync(join(proj, "p.json"), JSON.stringify({ stages: stockGrid("feature"), scopeSettings: ALL_ON, guardPolicy: "relaxed" }));
    const run = spawnSync(BUN, [
      GRAPH_TOOL, "validate-grid", "--proposal", join(proj, "p.json"), "--custom", "--project-dir", proj,
    ], { encoding: "utf-8", env: { ...process.env, CLAUDE_PROJECT_DIR: proj, ...switches(["learnings"]) } });
    expect(run.status, run.stdout + run.stderr).toBe(0);
    const advisories: string[] = JSON.parse(run.stdout).advisories;
    expect(advisories.filter((line) => line.includes("forces it off on this machine"))).toEqual([
      "learnings is on in these settings, but AIDLC_DISABLE_LEARNINGS forces it off on this machine; " +
        "the scope still stores on, and the ceremony runs once that switch is cleared.",
    ]);
  });

  test("mid-workflow, an on switch is recorded but the kill switch keeps each ceremony off", () => {
    const flags: Record<string, string> = {
      sensors: "sensors",
      learnings: "learnings",
      summary_confirmation: "summary-confirmation",
    };
    for (const key of CEREMONY_KEYS) {
      const proj = project();
      seedStateFile(proj, join(FIXTURES_DIR, "state-mid-ideation.md"));
      const env = { ...process.env, CLAUDE_PROJECT_DIR: proj, ...switches([key]) };
      const set = spawnSync(BUN, [UTIL, "config-change", `--${flags[key]}`, "on", "--project-dir", proj], { encoding: "utf-8", env });
      expect(set.status, key + set.stdout + set.stderr).toBe(0);
      const got = spawnSync(BUN, [UTIL, "config-get", flags[key], "--project-dir", proj], { encoding: "utf-8", env });
      expect(got.status, key + got.stdout + got.stderr).toBe(0);
      // This is the reading the composer and conductor take before reporting a kill switch.
      expect(got.stdout.trim(), key).toBe(`off (from env ${CEREMONY_ENV[key]})`);
    }
  });
});

describe("t349 (7) a custom scope written with the approved settings runs with them", () => {
  test("the resolvers read each value from the scope file and agree with the gate's off list", () => {
    const proj = createTestProject();
    tempDirs.push(proj);
    const scopes = join(proj, "scopes");
    mkdirSync(scopes);
    writeFileSync(join(scopes, "aidlc-quick-fix.md"), [
      "---",
      "name: quick-fix",
      "depth: Minimal",
      "keywords: []",
      "guard_policy: relaxed",
      ...SCOPE_SETTING_KEYS.map((key) => `${key}: ${QUICK_FIX[key]}`),
      "---",
      "",
      "Composed for a one-off fix: sensors, learnings, and stage reviewers are off.",
      "",
    ].join("\n"));
    withEnvAndFreshCaches({ ...POLICY_ENV, AIDLC_SCOPES_DIR: scopes }, () => {
      const meta = loadScopeMetadataAll()["quick-fix"];
      expect(meta.ceremony).toEqual({ sensors: "off", learnings: "off", summary_confirmation: "on" });
      expect(meta.reviewCap).toBe("none");
      expect(resolveCeremony("sensors", "quick-fix", "")).toMatchObject({ value: "off", source: "scope quick-fix" });
      expect(resolveCeremony("summary_confirmation", "quick-fix", "")).toMatchObject({
        value: "on",
        source: "scope quick-fix",
      });
      expect(resolveReviewClass("adversarial", "quick-fix")).toBe("none");
      const checked = validateScopeSettings(QUICK_FIX);
      expect(checked.settings).not.toBeNull();
      expect(ceremonyOffList("quick-fix", ceremonyPolicyValues("quick-fix", ""))).toEqual(
        scopeSettingsOffList(QUICK_FIX.review_cap, QUICK_FIX),
      );
    });
    // The live compose journey (t192) holds the composer's written file to the same shape.
    expect(() => assertComposedScopeSettings(join(scopes, "aidlc-quick-fix.md"))).not.toThrow();
    const partial = join(scopes, "aidlc-partial.md");
    writeFileSync(partial, "---\nname: partial\ndepth: Minimal\nsensors: off\nlearnings: on\nsummary_confirmation: on\n---\n");
    expect(() => assertComposedScopeSettings(partial)).toThrow(
      `Composed scope ${partial} must declare review_cap: adversarial | advisory | none (found "")`,
    );
  });
});

describe("t349 (8) every composer surface names the settings contract", () => {
  const harnesses = ["claude", "codex", "copilot", "cursor", "kiro", "kiro-ide", "opencode"];
  const skills = harnesses.map((harness) => `harness/${harness}/skills/aidlc/SKILL.md`);
  const surfaces = [
    "core/agents/aidlc-composer-agent.md",
    "core/knowledge/aidlc-composer-agent/composing.md",
    "core/tools/aidlc-orchestrate.ts",
    ...skills,
  ];
  const read = (surface: string) => readFileSync(join(REPO_ROOT, surface), "utf-8");

  test("the agent, its knowledge, the dispatch, and each SKILL.md name every key", () => {
    for (const surface of surfaces) {
      const text = read(surface);
      expect(text, surface).toContain("scopeSettings");
      for (const key of SCOPE_SETTING_KEYS) expect(text, `${surface} ${key}`).toContain(key);
    }
  });

  test("settings requests are applied, not handed back as commands to type", () => {
    for (const surface of surfaces) {
      const text = read(surface);
      // Mid-workflow requests come back as next flags the conductor applies.
      expect(text, surface).toContain("settingsFlags");
      // A kill switch is reported in one line and never searched for.
      expect(text, surface).toContain("AIDLC_DISABLE_<NAME>");
      expect(text, surface).toMatch(/never look for/i);
      expect(text, surface).not.toContain("--review adversarial|advisory|none");
      expect(text, surface).not.toMatch(/until nothing is listed|lifts both limits|the shell or the harness settings/);
    }
    // A matched plan's changes ride its creation flags.
    for (const surface of ["core/agents/aidlc-composer-agent.md", "core/tools/aidlc-orchestrate.ts", ...skills]) {
      expect(read(surface), surface).toContain("creationFlags");
    }
  });

  test("the gate's edit option covers the whole plan, and the composer names its route", () => {
    for (const surface of skills) {
      const text = read(surface);
      expect(text, surface).toContain("Approve / Edit the plan / Reject");
      expect(text, surface).not.toContain("Edit the grid");
    }
    for (const surface of ["core/agents/aidlc-composer-agent.md", "core/knowledge/aidlc-composer-agent/composing.md"]) {
      const text = read(surface);
      expect(text, surface).toContain("--matched");
      expect(text, surface).toContain("--custom");
    }
  });
});

describe("t349 (9) mid-workflow, reviews above the cap need a scope change", () => {
  test("an adversarial override never lifts a none or advisory cap; a lower override still lowers", () => {
    withEnvAndFreshCaches(POLICY_ENV, () => {
      const raise = "- **Review Override**: adversarial\n";
      expect(resolveReviewClass("adversarial", "express", raise)).toBe("none");
      expect(resolveReviewClass("adversarial", "bugfix", raise)).toBe("advisory");
      expect(resolveReviewClass("adversarial", "feature", raise)).toBe("adversarial");
      expect(resolveReviewClass("adversarial", "feature", "- **Review Override**: none\n")).toBe("none");
    });
  });

  test("a scope change keeps a stored lowering; the returned flags clear it", () => {
    const proj = project();
    seedStateFile(proj, join(FIXTURES_DIR, "state-mid-ideation.md"));
    const effective = (args: string[]) => {
      const res = spawnSync(BUN, [UTIL, ...args, "--project-dir", proj], {
        encoding: "utf-8",
        env: { ...process.env, CLAUDE_PROJECT_DIR: proj },
      });
      expect(res.status, `${args.join(" ")}: ${res.stdout}${res.stderr}`).toBe(0);
      const state = readFileSync(join(seededRecordDir(proj), "aidlc-state.md"), "utf-8");
      const scope = /^- \*\*Scope\*\*: (.+)$/m.exec(state)?.[1] ?? "";
      return withEnvAndFreshCaches(POLICY_ENV, () => ({ scope, review: resolveReviewClass("adversarial", scope, state) }));
    };
    // An advisory-capped scope with reviews switched off for this run.
    expect(effective(["scope-change", "--scope", "bugfix", "--review", "none"])).toEqual({ scope: "bugfix", review: "none" });
    // Moving to an uncapped scope alone leaves the stored lowering in force.
    expect(effective(["scope-change", "--scope", "feature"])).toEqual({ scope: "feature", review: "none" });
    // The flags the composer returns for stronger reviews lift both at once.
    expect(effective(["scope-change", "--scope", "feature", "--review", "adversarial"])).toEqual({
      scope: "feature",
      review: "adversarial",
    });
  });
});

// The in-flight message the conductor receives for `next compose`, read the way t198 does.
function composeMessage(proj: string, args: string[]): string {
  const res = runOrchestrateNext(ORCH, proj, ["compose", ...args], { cwd: proj, env: process.env });
  const line = res.out.split("\n").find((entry) => entry.trim().startsWith("{"));
  if (line === undefined) throw new Error(`no directive in: ${res.out}`);
  const directive = JSON.parse(line) as { kind?: unknown; message?: unknown };
  expect(directive.kind).toBe("print");
  return String(directive.message);
}

describe("t349 (10) the compose dispatch carries the settings contract", () => {
  test("front: the gate renders a Scope settings row and appends a matched plan's creation flags", () => {
    const proj = project();
    const message = composeMessage(proj, ["fix the token bug"]);
    expect(message).toContain("scopeSettingsRationale");
    expect(message).toContain('"Scope settings: sensors <sensors>, learnings <learnings>, summary confirmation <summary_confirmation>, reviews <review_cap> - <scopeSettingsRationale>"');
    expect(message).toContain("through the creationFlags you append to the creation command after --scope <scopeName>");
    expect(message).not.toContain("write no marker");
  });

  test("in-flight: settings are applied without a gate, and a settings-only request runs no recompose", () => {
    const proj = project();
    seedStateFile(proj, join(FIXTURES_DIR, "state-mid-ideation.md"));
    const message = composeMessage(proj, ["turn sensors off"]);
    expect(message).toContain("mode in-flight");
    expect(message).toContain("the composer returns it as settingsFlags, and you apply them with no approval gate");
    expect(message).toContain(
      "When the composer returns empty changes.skip and changes.add (a settings-only request, or nothing earns a flip), write no marker, present no approval gate, and run no recompose: apply any settingsFlags and relay the result.",
    );
    expect(message).not.toContain("Scope settings: sensors <sensors>");
  });
});
