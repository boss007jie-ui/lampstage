import { readFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { LOCAL_ROOT, LOCAL_CONTROL_PORT } from "./local-profile";

async function main() {
  const command = process.argv[2];
  if (command !== "status" && command !== "stop") throw new Error("Use status or stop.");
  const state = JSON.parse(await readFile(path.join(LOCAL_ROOT, "state.json"), "utf8"));
  if (state.stage === "stopped" || state.stage === "failed") { console.log("Local application is stopped."); return; }
  const response = await fetch(`http://127.0.0.1:${LOCAL_CONTROL_PORT}/${command === "stop" ? "stop" : "health"}`, {
    method: command === "stop" ? "POST" : "GET", headers: { "x-local-token": state.controlToken }, signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(response.status === 409 ? "There are active tasks. Wait for them to finish before stopping." : "Local controller is unavailable.");
  if (command === "stop") {
    console.log("Stopping this local application; saved data will remain.");
    const deadline = Date.now() + 40000;
    while (Date.now() < deadline) {
      const current = JSON.parse(await readFile(path.join(LOCAL_ROOT, "state.json"), "utf8"));
      if (current.pid === state.pid && (current.stage === "stopped" || current.stage === "failed")) {
        console.log("Local application has stopped. It is ready to restart.");
        return;
      }
      await delay(500);
    }
    throw new Error("Local shutdown is still in progress. Wait before restarting.");
  }
  else console.log(JSON.stringify(await response.json(), null, 2));
}
void main().catch(error => { console.error(error instanceof Error && /^(There are|Use |Local controller|Local shutdown)/.test(error.message) ? error.message : "Local application is not running. Use the local launcher."); process.exitCode = 1; });
