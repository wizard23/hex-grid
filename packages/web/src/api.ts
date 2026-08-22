import type { Envelope, ProblemBody, Todo, User } from "@asimov/shared";

// sessionStorage is per-tab, so each tab can hold its own logged-in user
const TOKEN_KEY = "token";

export function getToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token === null) sessionStorage.removeItem(TOKEN_KEY);
  else sessionStorage.setItem(TOKEN_KEY, token);
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token !== null) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(path, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (res.status === 204) return undefined as T;
  const json: unknown = await res.json();
  if (!res.ok) {
    const problem = json as ProblemBody;
    throw new ApiError(res.status, problem.detail ?? problem.title ?? res.statusText);
  }
  return (json as Envelope<T>).data;
}

export interface Credentials {
  username: string;
  password: string;
  email?: string;
}

export function signup(body: Credentials): Promise<{ user: User; token: string }> {
  return call("POST", "/v1/auth/signup", body);
}

export function login(body: Credentials): Promise<{ user: User; token: string }> {
  return call("POST", "/v1/auth/login", body);
}

export function me(): Promise<{ user: User }> {
  return call("GET", "/v1/me");
}

export function updateMe(body: {
  email?: string;
  password?: string;
  version: number;
}): Promise<{ user: User }> {
  return call("PATCH", "/v1/me", body);
}

export function deleteMe(version: number): Promise<void> {
  return call("DELETE", `/v1/me?version=${version}`);
}

export function listTodos(): Promise<{ todos: Todo[] }> {
  return call("GET", "/v1/todos");
}

export function createTodo(body: { title: string; tags?: string[] }): Promise<{ todo: Todo }> {
  return call("POST", "/v1/todos", body);
}

export function updateTodo(
  id: string,
  body: { title?: string; done?: boolean; tags?: string[]; version: number },
): Promise<{ todo: Todo }> {
  return call("PATCH", `/v1/todos/${id}`, body);
}

export function deleteTodo(id: string, version: number): Promise<void> {
  return call("DELETE", `/v1/todos/${id}?version=${version}`);
}
