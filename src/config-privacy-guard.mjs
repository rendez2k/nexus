import { existsSync, watch } from "node:fs";
import path from "node:path";

import {
  PROTECTION_EXPOSED,
  privateFileProtection,
  protectPrivateFile,
} from "./file-security.mjs";

// Codex rewrites its own config.toml whenever a setting changes -- picking a
// model in the desktop app is enough -- and the file it writes back gets the
// directory's ordinary inherited permissions. That file carries the managed
// router URL, which is a local caller capability, so every such rewrite left
// it readable by every account on the machine, including the one Codex runs
// the agent's commands under, until someone ran doctor --fix by hand. On a
// live install that was the doctor FAIL that came back every few days.
//
// This guard watches the file and puts the lock back. Permissions only, never
// content: the config manager owns its marked blocks and nothing here reads or
// writes a byte of the document (see "Codex safety boundaries" in AGENTS.md).
// The check is the same tri-state doctor uses, so a shell that fails to start
// is "unknown" and leaves the file alone rather than relocking on a guess.
//
// Runs in the service root (start.mjs), not in the request-serving router
// child: on Windows the check spawns PowerShell synchronously, and the root
// process has no requests to stall.
const DEFAULT_DEBOUNCE_MS = 1_500;
const DEFAULT_POLL_MS = 5 * 60_000;
export const GUARD_DISABLE_ENV = "MODEL_ROUTER_CONFIG_PRIVACY_GUARD";

export function configPrivacyGuardDisabled(environment = process.env) {
  return environment[GUARD_DISABLE_ENV] === "0";
}

export function startConfigPrivacyGuard({
  target,
  log = () => {},
  debounceMs = DEFAULT_DEBOUNCE_MS,
  pollMs = DEFAULT_POLL_MS,
  watchImpl = watch,
  protection = privateFileProtection,
  protect = protectPrivateFile,
} = {}) {
  if (!target) throw new Error("A config privacy guard needs a file to watch.");
  const name = path.basename(target);
  let stopped = false;
  let timer;
  let relocks = 0;

  // A missing file is not an exposed one: protection() reports absence as
  // exposed for doctor's purposes, and relocking would have to create the
  // file first. Nothing here creates anything.
  function check() {
    if (stopped || !existsSync(target)) return;
    if (protection(target) !== PROTECTION_EXPOSED) return;
    try {
      protect(target);
      relocks += 1;
      log(`${name} had lost its owner-only permissions; relocked it.`);
    } catch (error) {
      log(`could not relock ${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Editors and Codex alike write a temporary file and rename it over the
  // target, which the directory watcher sees as a burst of events. One check
  // after the burst settles is enough, and it also rides out the moment when
  // the temporary file exists and the target briefly does not.
  function schedule() {
    if (stopped) return;
    clearTimeout(timer);
    timer = setTimeout(check, debounceMs);
    timer.unref?.();
  }

  let watcher;
  try {
    // Watch the directory, not the file: a rename-over replaces the inode the
    // file watcher was attached to, after which it never fires again.
    watcher = watchImpl(path.dirname(target), { persistent: false }, (_event, filename) => {
      if (!filename || String(filename) === name) schedule();
    });
    watcher.on?.("error", () => {
      // Polling below still covers the file; a dead watcher only means the
      // relock is late rather than absent.
    });
  } catch {
    watcher = undefined;
  }
  // Belt and braces for platforms where directory watching is unreliable, and
  // the only mechanism when it is unavailable.
  const poll = setInterval(check, pollMs);
  poll.unref?.();
  schedule();

  return {
    check,
    get relocks() {
      return relocks;
    },
    watching: Boolean(watcher),
    stop() {
      stopped = true;
      clearTimeout(timer);
      clearInterval(poll);
      watcher?.close?.();
    },
  };
}
