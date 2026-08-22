export interface Todo {
  id: string;
  ownerId: string;
  title: string;
  done: boolean;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  /** optimistic concurrency: writes must send the version they saw; stale -> 409 */
  version: number;
}

export interface TodoFilter {
  tag?: string;
  done?: boolean;
}

/** trim every tag, drop empties, dedupe keeping first-seen order */
export function normalizeTags(tags: string[]): string[] {
  return [...new Set(tags.map((tag) => tag.trim()).filter((tag) => tag !== ""))];
}

/** parse comma-separated user input: "a, b ,a" -> ["a", "b"] */
export function parseTags(raw: string): string[] {
  return normalizeTags(raw.split(","));
}

export function matchesTodoFilter(todo: Todo, filter: TodoFilter): boolean {
  if (filter.tag !== undefined && !todo.tags.includes(filter.tag)) return false;
  if (filter.done !== undefined && todo.done !== filter.done) return false;
  return true;
}
