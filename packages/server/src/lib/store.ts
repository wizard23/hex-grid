import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface Store<T> {
  get(id: string): T | undefined;
  values(): T[];
  set(id: string, value: T): Promise<void>;
  delete(id: string): Promise<boolean>;
}

/**
 * Minimal JSON-file persistence: everything in memory, the whole collection
 * written to <dataDir>/<name>.json on each mutation via tmp-file + rename
 * (atomic on POSIX). Single-process by design.
 */
export async function createStore<T>(dataDir: string, name: string): Promise<Store<T>> {
  const file = join(dataDir, `${name}.json`);
  await mkdir(dataDir, { recursive: true });

  const entries = new Map<string, T>();
  try {
    const raw = await readFile(file, "utf8");
    for (const [id, value] of Object.entries(JSON.parse(raw) as Record<string, T>)) {
      entries.set(id, value);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }

  let writeSeq = 0;
  async function save(): Promise<void> {
    const tmp = `${file}.${writeSeq++}.tmp`;
    await writeFile(tmp, JSON.stringify(Object.fromEntries(entries), null, 2));
    await rename(tmp, file);
  }

  return {
    get: (id) => entries.get(id),
    values: () => [...entries.values()],
    set: async (id, value) => {
      entries.set(id, value);
      await save();
    },
    delete: async (id) => {
      const had = entries.delete(id);
      if (had) await save();
      return had;
    },
  };
}
