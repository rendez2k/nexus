import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { COMMANDS } from "../src/desktop-commands.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// The Start-with-Windows toggle lives only in the Rust tray, which no Node
// test can exercise -- and the sync to upstream 9b2b88a replaced main.rs
// wholesale and took the toggle with it, unnoticed, because nothing asserted
// on it. This reads the source so the next sync fails here instead of on a
// user's machine. See docs/RENAME.md, "What the same sync dropped".
test("the Windows tray keeps its Start with Windows toggle", () => {
  const source = readFileSync(
    path.join(root, "apps", "desktop", "src-tauri", "src", "main.rs"),
    "utf8",
  );
  // The registry value name is the identity of the entry: an earlier build
  // wrote it, so a rename here would strand that entry rather than replace it.
  assert.match(source, /const RUN_VALUE: &str = "Nexus";/);
  assert.match(source, /CheckMenuItem::with_id\(\s*app,\s*"start-with-windows",/);
  assert.match(source, /"start-with-windows" => \{/);
  // Windows-only, by design: macOS has its own tray control and Linux startup
  // belongs to the desktop environment. Each piece must carry the guard.
  const windowsOnly = /#\[cfg\(target_os = "windows"\)\]\s*\n\s*(const RUN_KEY|const RUN_VALUE|fn apply_start_with_windows|fn start_with_windows_registered|let menu = \{|"start-with-windows" =>)/g;
  assert.equal(source.match(windowsOnly)?.length, 6, "every autostart piece is cfg-gated to Windows");
});

test("desktop local-model commands use the shared model argument", () => {
  assert.deepEqual(COMMANDS.install_local_model({ model: "gemma4:12b" }), {
    args: ["local-models", "install", "gemma4:12b", "--yes"],
  });
  assert.deepEqual(COMMANDS.install_local_model({ model: "gemma4:12b", force: true }), {
    args: ["local-models", "install", "gemma4:12b", "--yes", "--force"],
  });
  assert.deepEqual(COMMANDS.uninstall_local_model({ model: "gemma4:12b" }), {
    args: ["local-models", "uninstall", "gemma4:12b", "--yes", "--async"],
  });
  assert.deepEqual(COMMANDS.cancel_local_model({ model: "gemma4:12b" }), {
    args: ["local-models", "cancel", "gemma4:12b"],
  });
  assert.deepEqual(COMMANDS.set_local_model_enabled({ model: "gemma4:12b", enabled: true }), {
    args: ["local-models", "set", "gemma4:12b", "on"],
  });
  // LM Studio ids carry slashes ("qwen/qwen3-4b"), which requireTag permits.
  assert.deepEqual(
    COMMANDS.set_lmstudio_model_enabled({ model: "qwen/qwen3-4b", enabled: true }),
    { args: ["local-models", "lmstudio-set", "qwen/qwen3-4b", "on"] },
  );
  assert.deepEqual(
    COMMANDS.set_lmstudio_model_enabled({ id: "qwen/qwen3-4b", enabled: false }),
    { args: ["local-models", "lmstudio-set", "qwen/qwen3-4b", "off"] },
  );
  assert.deepEqual(COMMANDS.local_model_speed({ model: "gemma4:12b" }), {
    args: ["local-models", "benchmark", "gemma4:12b"],
  });
  assert.deepEqual(COMMANDS.benchmark_vision_model({ model: "qwen2.5vl:3b" }), {
    args: ["vision-bridge", "benchmark", "qwen2.5vl:3b"],
  });
  assert.deepEqual(COMMANDS.use_local_vision_model({ model: "qwen2.5vl:3b" }), {
    args: ["vision-bridge", "local", "qwen2.5vl:3b"],
  });
});

test("desktop settings commands preserve the Windows and macOS tray contract", () => {
  assert.deepEqual(COMMANDS.set_provider_enabled({ provider: "deepseek", enabled: true }), {
    args: ["set-apply", "deepseek", "on", "--targets", "codex", "--activate"],
    timeoutMs: 330_000,
    then: ["--json"],
  });
  assert.deepEqual(COMMANDS.set_signed_routing({ enabled: true }), {
    args: ["signed-routing", "on"],
    then: ["--json"],
  });
  assert.deepEqual(COMMANDS.set_presence_mode({ mode: "follow-codex" }), {
    args: ["presence", "set", "follow-codex"],
  });
  assert.deepEqual(COMMANDS.service_start(), { args: ["service", "start"] });
  assert.deepEqual(COMMANDS.service_stop(), { args: ["service", "stop"] });
  assert.deepEqual(COMMANDS.set_tool_result_aging({ enabled: true }), {
    args: ["tool-result-aging", "on"],
  });
  assert.deepEqual(COMMANDS.set_vision_engine({ engine: "gpt-5.6-luna", effort: "low" }), {
    args: ["vision-bridge", "engine", "gpt-5.6-luna", "low"],
  });
  assert.deepEqual(COMMANDS.doctor_fix(), {
    args: ["doctor", "--fix", "--json"],
  });
});

test("desktop credential commands rely on the control plane's atomic publication", () => {
  assert.deepEqual(COMMANDS.save_api_key({ provider: "deepseek", apiKey: "test-key" }), {
    args: ["credential", "deepseek"],
    stdin: "test-key",
    timeoutMs: 330_000,
    then: ["providers", "--json"],
  });
  assert.deepEqual(COMMANDS.remove_api_key({ provider: "deepseek" }), {
    args: ["credential", "deepseek", "--remove"],
    timeoutMs: 330_000,
    then: ["providers", "--json"],
  });
});

test("desktop local-model commands retain the legacy tag argument and validation", () => {
  assert.deepEqual(COMMANDS.install_local_model({ tag: "gemma4:12b" }), {
    args: ["local-models", "install", "gemma4:12b", "--yes"],
  });
  assert.deepEqual(COMMANDS.cancel_local_model({ tag: "gemma4:12b" }), {
    args: ["local-models", "cancel", "gemma4:12b"],
  });
  assert.throws(
    () => COMMANDS.install_local_model({ model: "not a model" }),
    /Unknown model tag: not a model/,
  );
});
