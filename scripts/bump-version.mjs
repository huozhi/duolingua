import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const requestedVersion = process.argv[2]?.replace(/^v/, "");

if (!requestedVersion || !/^\d+\.\d+\.\d+$/.test(requestedVersion)) {
  console.error("Usage: pnpm version:bump <major.minor.patch>");
  process.exit(1);
}

const projectDir = resolve(import.meta.dirname, "..");

await updateJson("package.json");
await updateJson("native-shell/frontend/package.json");
await replaceOnce(
  "native-shell/app.zon",
  /\.version = "\d+\.\d+\.\d+"/,
  `.version = "${requestedVersion}"`,
);
await replaceOnce(
  "native-shell/build.zig.zon",
  /\.version = "\d+\.\d+\.\d+"/,
  `.version = "${requestedVersion}"`,
);
await replaceOnce(
  "native-shell/build.zig",
  /zig-out\/package\/\{s\}-\d+\.\d+\.\d+-\{s\}-\{s\}\{s\}/,
  `zig-out/package/{s}-${requestedVersion}-{s}-{s}{s}`,
);

console.log(`Synchronized Duolingua version ${requestedVersion}.`);

async function updateJson(relativePath) {
  const path = resolve(projectDir, relativePath);
  const data = JSON.parse(await readFile(path, "utf8"));
  data.version = requestedVersion;
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`);
}

async function replaceOnce(relativePath, pattern, replacement) {
  const path = resolve(projectDir, relativePath);
  const source = await readFile(path, "utf8");
  const matches = source.match(new RegExp(pattern.source, "g"));

  if (matches?.length !== 1) {
    throw new Error(`Expected one version marker in ${relativePath}, found ${matches?.length ?? 0}.`);
  }

  await writeFile(path, source.replace(pattern, replacement));
}
