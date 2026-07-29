import { spawn } from "node:child_process";
import { constants } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const launcherDir = dirname(fileURLToPath(import.meta.url));
const resourcesDir = resolve(launcherDir, "..");
const contentsDir = resolve(resourcesDir, "..");
const serverDir = join(resourcesDir, "server");
const nodePath = join(resourcesDir, "runtime", "node");
const nativePath = join(contentsDir, "MacOS", "q4-native");
const port = 3219;
const frontendUrl = `http://127.0.0.1:${port}`;

let server;
let native;
let closing = false;

function stop(child) {
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill("SIGTERM");
  }
}

async function healthIsReady() {
  try {
    const response = await fetch(`${frontendUrl}/api/health`, {
      signal: AbortSignal.timeout(1_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForServer() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (server.exitCode !== null) {
      throw new Error(`The q4 server exited with code ${server.exitCode}.`);
    }
    if (await healthIsReady()) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error("The q4 server did not become ready.");
}

async function showError(error) {
  const message = error instanceof Error ? error.message : String(error);
  const escaped = message.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  const alert = spawn("/usr/bin/osascript", [
    "-e",
    `display alert "q4 could not start" message "${escaped}"`,
  ]);
  await new Promise((resolveAlert) => alert.once("exit", resolveAlert));
}

async function close(code = 0) {
  if (closing) return;
  closing = true;
  stop(native);
  stop(server);

  if (server && server.exitCode === null) {
    await Promise.race([
      new Promise((resolveExit) => server.once("exit", resolveExit)),
      new Promise((resolveDelay) => setTimeout(resolveDelay, 2_000)),
    ]);
    if (server.exitCode === null) server.kill("SIGKILL");
  }

  process.exit(code);
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => void close(0));
}

try {
  server = spawn(nodePath, [join(serverDir, "server.js")], {
    cwd: serverDir,
    env: {
      ...process.env,
      HOSTNAME: "127.0.0.1",
      MODEL_CACHE_DIR: join(resourcesDir, "models"),
      NODE_ENV: "production",
      PORT: String(port),
    },
    stdio: "ignore",
  });

  await waitForServer();

  native = spawn(nativePath, process.argv.slice(2), {
    env: {
      ...process.env,
      NATIVE_SDK_FRONTEND_URL: `${frontendUrl}/`,
    },
    stdio: "ignore",
  });

  const exitCode = await new Promise((resolveExit) => {
    native.once("exit", (code, signal) => {
      resolveExit(code ?? (signal ? 128 + (constants.signals[signal] ?? 0) : 1));
    });
  });
  await close(exitCode);
} catch (error) {
  await showError(error);
  await close(1);
}
