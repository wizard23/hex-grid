import type { StoredStamp } from "./stamp";

/**
 * The stamp library lives in IndexedDB (not localStorage — stamps can be
 * many). The store interface is tiny so tests use the in-memory twin.
 */
export interface StampStore {
  all(): Promise<StoredStamp[]>;
  put(stamp: StoredStamp): Promise<void>;
  remove(id: string): Promise<void>;
}

export function memoryStampStore(initial: readonly StoredStamp[] = []): StampStore {
  const stamps = new Map(initial.map((s) => [s.id, s]));
  return {
    all: () => Promise.resolve([...stamps.values()]),
    put: (stamp) => {
      stamps.set(stamp.id, stamp);
      return Promise.resolve();
    },
    remove: (id) => {
      stamps.delete(id);
      return Promise.resolve();
    },
  };
}

const DB_NAME = "hex-grid-stamps";
const STORE = "stamps";

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error instanceof Error ? req.error : new Error("IndexedDB error"));
  });
}

export async function openStampStore(): Promise<StampStore> {
  if (typeof indexedDB === "undefined") return memoryStampStore();
  const open = indexedDB.open(DB_NAME, 1);
  open.onupgradeneeded = () => {
    if (!open.result.objectStoreNames.contains(STORE)) open.result.createObjectStore(STORE, { keyPath: "id" });
  };
  const db = await request(open as IDBRequest<IDBDatabase>);
  const store = (mode: IDBTransactionMode) => db.transaction(STORE, mode).objectStore(STORE);
  return {
    all: () => request(store("readonly").getAll() as IDBRequest<StoredStamp[]>),
    put: async (stamp) => {
      await request(store("readwrite").put(stamp));
    },
    remove: async (id) => {
      await request(store("readwrite").delete(id));
    },
  };
}
