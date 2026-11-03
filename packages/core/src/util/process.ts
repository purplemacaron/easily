import { spawn, type ChildProcess } from "node:child_process";

/** Kill a child and everything it started (taskkill /T on Windows, process group elsewhere). */
export function killTree(child: ChildProcess): void {
  const pid = child.pid;
  if (!pid) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  } else {
    try {
      process.kill(-pid, "SIGKILL"); // only valid when the child was spawned detached
    } catch {
      child.kill("SIGKILL");
    }
  }
}
