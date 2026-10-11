import { cp, mkdir, access } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

export async function packagePages(stable, development, output) {
  const target = resolve(output);
  // A fresh artifact prevents stale files and avoids any destructive cleanup.
  try {
    await access(target);
    throw new Error("Pages output must be a new directory");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await mkdir(target, { recursive: true });
  await cp(resolve(stable), target, { recursive: true });
  await cp(resolve(development), join(target, "dev"), { recursive: true });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [stable, development, output] = process.argv.slice(2);
  if (!stable || !development || !output) throw new Error("Usage: package-pages stable/public dev/public output");
  await packagePages(stable, development, output);
}
