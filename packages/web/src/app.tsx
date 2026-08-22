import { useEffect, useState } from "preact/hooks";
import {
  matchesTodoFilter,
  parseTags,
  PASSWORD_MIN_LENGTH,
  validatePassword,
  validateUsername,
  type Todo,
  type User,
} from "@asimov/shared";
import * as api from "./api";
import { applyTheme, currentTheme, THEMES, type Theme } from "./theme";

type View = "main" | "settings";
type AuthMode = "login" | "signup";

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<View>("main");
  const [authMode, setAuthMode] = useState<AuthMode>("login");

  useEffect(() => {
    if (api.getToken() === null) {
      setReady(true);
      return;
    }
    api
      .me()
      .then(({ user: u }) => setUser(u))
      .catch(() => api.setToken(null))
      .finally(() => setReady(true));
  }, []);

  function logout() {
    api.setToken(null);
    setUser(null);
    setView("main");
  }

  function onAuthed(u: User) {
    setUser(u);
    setView("main");
  }

  function startAuth(mode: AuthMode) {
    setAuthMode(mode);
    setView("main");
  }

  if (!ready) return null;
  return (
    <main class="app">
      <MenuBar
        user={user}
        view={view}
        onNav={setView}
        onLogout={logout}
        onStartAuth={startAuth}
      />
      {view === "settings" ? (
        <SettingsScreen user={user} onUpdated={setUser} onDeleted={logout} />
      ) : user === null ? (
        <AuthScreen mode={authMode} onAuthed={onAuthed} />
      ) : (
        <TodoScreen onLogout={logout} />
      )}
    </main>
  );
}

function MenuBar({
  user,
  view,
  onNav,
  onLogout,
  onStartAuth,
}: {
  user: User | null;
  view: View;
  onNav: (v: View) => void;
  onLogout: () => void;
  onStartAuth: (mode: AuthMode) => void;
}) {
  return (
    <nav class="menubar">
      <span class="brand">todos</span>
      <div class="menu-items">
        {user !== null ? (
          <>
            <button
              type="button"
              class={view === "main" ? "active" : ""}
              onClick={() => onNav("main")}
            >
              Todos
            </button>
            <button
              type="button"
              class={view === "settings" ? "active" : ""}
              onClick={() => onNav("settings")}
            >
              <span aria-hidden="true">⚙</span> Settings
            </button>
            <span class="who">{user.username}</span>
            <button type="button" onClick={onLogout}>
              Log out
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={() => onStartAuth("login")}>
              Log in
            </button>
            <button type="button" onClick={() => onStartAuth("signup")}>
              Sign up
            </button>
            <button
              type="button"
              class={view === "settings" ? "active" : ""}
              onClick={() => onNav("settings")}
              aria-label="Settings"
            >
              <span aria-hidden="true">⚙</span>
            </button>
          </>
        )}
      </div>
    </nav>
  );
}

function AuthScreen({
  mode,
  onAuthed,
}: {
  mode: AuthMode;
  onAuthed: (user: User) => void;
}) {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const signup = mode === "signup";
  // mode is driven by the menu bar; clear transient form state when it flips
  useEffect(() => {
    setError(null);
    setConfirm("");
  }, [mode]);

  const mismatch = signup && confirm !== "" && password !== confirm;
  const incomplete = username === "" || password === "" || (signup && confirm === "");
  // the same shared rules the server enforces, checked before the round-trip
  const usernameError = signup && username !== "" ? validateUsername(username) : null;
  const passwordError = signup && password !== "" ? validatePassword(password) : null;
  const invalid = usernameError !== null || passwordError !== null;

  async function submit(event: Event) {
    event.preventDefault();
    if (busy || mismatch || incomplete || invalid) return;
    setBusy(true);
    setError(null);
    try {
      const credentials: api.Credentials = { username, password };
      if (signup && email !== "") credentials.email = email;
      const { user, token } = signup ? await api.signup(credentials) : await api.login(credentials);
      api.setToken(token);
      onAuthed(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section class="card auth">
      <h1>{signup ? "sign up" : "log in"}</h1>
      <form onSubmit={(e) => void submit(e)}>
        <label>
          Username
          <input
            value={username}
            onInput={(e) => setUsername(e.currentTarget.value)}
            autocomplete="username"
            placeholder="a-z, 0-9, - and _"
          />
        </label>
        {signup && (
          <label>
            Email <span class="hint">(optional)</span>
            <input
              type="email"
              value={email}
              onInput={(e) => setEmail(e.currentTarget.value)}
              autocomplete="email"
            />
          </label>
        )}
        <label>
          Password
          <input
            type="password"
            value={password}
            onInput={(e) => setPassword(e.currentTarget.value)}
            autocomplete={signup ? "new-password" : "current-password"}
            placeholder={`at least ${PASSWORD_MIN_LENGTH} characters`}
          />
        </label>
        {signup && (
          <label>
            Repeat password
            <input
              type="password"
              value={confirm}
              onInput={(e) => setConfirm(e.currentTarget.value)}
              autocomplete="new-password"
            />
          </label>
        )}
        {usernameError !== null && <p class="error">Username: {usernameError}</p>}
        {passwordError !== null && <p class="error">Password: {passwordError}</p>}
        {mismatch && <p class="error">Passwords don't match.</p>}
        {error !== null && <p class="error">{error}</p>}
        <button type="submit" disabled={busy || mismatch || incomplete || invalid}>
          {signup ? "Create account" : "Log in"}
        </button>
      </form>
    </section>
  );
}

function SettingsScreen({
  user,
  onUpdated,
  onDeleted,
}: {
  user: User | null;
  onUpdated: (user: User) => void;
  onDeleted: () => void;
}) {
  return (
    <section class="card settings">
      <h1>settings</h1>
      <div class="section">
        <h2>Appearance</h2>
        <label>
          Theme
          <ThemePicker />
        </label>
      </div>
      {user !== null && (
        <EditProfile user={user} onUpdated={onUpdated} onDeleted={onDeleted} />
      )}
    </section>
  );
}

function ThemePicker() {
  const [theme, setTheme] = useState<Theme>(currentTheme());
  return (
    <select
      class="theme-picker"
      aria-label="Theme"
      value={theme}
      onChange={(e) => {
        const next = e.currentTarget.value as Theme;
        applyTheme(next);
        setTheme(next);
      }}
    >
      {THEMES.map((t) => (
        <option key={t.id} value={t.id}>
          {t.label}
        </option>
      ))}
    </select>
  );
}

function EditProfile({
  user,
  onUpdated,
  onDeleted,
}: {
  user: User;
  onUpdated: (user: User) => void;
  onDeleted: () => void;
}) {
  const [email, setEmail] = useState(user.email ?? "");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const emailChanged = email !== (user.email ?? "");
  const mismatch = password !== "" && confirm !== password;
  const passwordError = password !== "" ? validatePassword(password) : null;
  const nothingToSave = !emailChanged && password === "";
  const blocked = busy || mismatch || passwordError !== null || nothingToSave;

  function fail(err: unknown) {
    if (err instanceof api.ApiError && err.status === 401) return onDeleted();
    if (err instanceof api.ApiError && err.status === 409) {
      setError("Profile changed elsewhere — reloading, please retry.");
      api.me().then(({ user: u }) => onUpdated(u)).catch(() => undefined);
      return;
    }
    setError(err instanceof Error ? err.message : String(err));
  }

  async function save(event: Event) {
    event.preventDefault();
    if (blocked) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const patch: { email?: string; password?: string; version: number } = { version: user.version };
      if (emailChanged) patch.email = email;
      if (password !== "") patch.password = password;
      const { user: updated } = await api.updateMe(patch);
      onUpdated(updated);
      setPassword("");
      setConfirm("");
      setSaved(true);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await api.deleteMe(user.version);
      onDeleted();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="section">
      <h2>Profile</h2>
      <form onSubmit={(e) => void save(e)}>
        <label>
          Username
          <input value={user.username} disabled aria-label="Username (read-only)" />
        </label>
        <label>
          Email <span class="hint">(blank to clear)</span>
          <input
            type="email"
            value={email}
            onInput={(e) => {
              setEmail(e.currentTarget.value);
              setSaved(false);
            }}
            autocomplete="email"
          />
        </label>
        <label>
          New password <span class="hint">(leave blank to keep)</span>
          <input
            type="password"
            value={password}
            onInput={(e) => {
              setPassword(e.currentTarget.value);
              setSaved(false);
            }}
            autocomplete="new-password"
            placeholder={`at least ${PASSWORD_MIN_LENGTH} characters`}
          />
        </label>
        {password !== "" && (
          <label>
            Repeat new password
            <input
              type="password"
              value={confirm}
              onInput={(e) => setConfirm(e.currentTarget.value)}
              autocomplete="new-password"
            />
          </label>
        )}
        {passwordError !== null && <p class="error">Password: {passwordError}</p>}
        {mismatch && <p class="error">Passwords don't match.</p>}
        {error !== null && <p class="error">{error}</p>}
        {saved && <p class="ok">Saved.</p>}
        <button type="submit" disabled={blocked}>
          Save changes
        </button>
      </form>
      <div class="danger">
        {confirmingDelete ? (
          <>
            <span>Permanently delete your account and all todos?</span>
            <button type="button" class="delete-account" onClick={() => void remove()} disabled={busy}>
              Delete
            </button>
            <button type="button" onClick={() => setConfirmingDelete(false)} disabled={busy}>
              Cancel
            </button>
          </>
        ) : (
          <button type="button" class="delete-account" onClick={() => setConfirmingDelete(true)}>
            Delete account
          </button>
        )}
      </div>
    </div>
  );
}

function TodoScreen({ onLogout }: { onLogout: () => void }) {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [title, setTitle] = useState("");
  const [tags, setTags] = useState("");
  const [filter, setFilter] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const { todos: list } = await api.listTodos();
    setTodos(list);
  }

  function handle(err: unknown) {
    if (err instanceof api.ApiError && err.status === 401) {
      onLogout();
      return;
    }
    if (err instanceof api.ApiError && err.status === 409) {
      // optimistic concurrency: someone else (another tab?) changed it first
      setError("This todo changed in another tab — list reloaded, please retry.");
      refresh().catch(() => undefined);
      return;
    }
    setError(err instanceof Error ? err.message : String(err));
  }

  useEffect(() => {
    refresh().catch(handle);
  }, []);

  async function add(event: Event) {
    event.preventDefault();
    const trimmed = title.trim();
    if (trimmed === "") return;
    const tagList = parseTags(tags);
    try {
      const { todo } = await api.createTodo(
        tagList.length > 0 ? { title: trimmed, tags: tagList } : { title: trimmed },
      );
      setTodos((current) => [...current, todo]);
      setTitle("");
      setTags("");
      setError(null);
    } catch (err) {
      handle(err);
    }
  }

  async function toggle(todo: Todo) {
    try {
      const { todo: updated } = await api.updateTodo(todo.id, {
        done: !todo.done,
        version: todo.version,
      });
      setTodos((current) => current.map((t) => (t.id === updated.id ? updated : t)));
    } catch (err) {
      handle(err);
    }
  }

  async function remove(todo: Todo) {
    try {
      await api.deleteTodo(todo.id, todo.version);
      setTodos((current) => current.filter((t) => t.id !== todo.id));
    } catch (err) {
      handle(err);
    }
  }

  const visible = todos.filter((t) => matchesTodoFilter(t, filter === null ? {} : { tag: filter }));

  return (
    <section class="card todos">
      <form onSubmit={(e) => void add(e)}>
        <input
          class="grow"
          value={title}
          onInput={(e) => setTitle(e.currentTarget.value)}
          placeholder="What needs doing?"
          aria-label="Title"
        />
        <input
          value={tags}
          onInput={(e) => setTags(e.currentTarget.value)}
          placeholder="tags, comma, separated"
          aria-label="Tags"
        />
        <button type="submit" disabled={title.trim() === ""}>
          Add
        </button>
      </form>
      {error !== null && <p class="error">{error}</p>}
      {filter !== null && (
        <p class="filter">
          Showing <strong>#{filter}</strong>{" "}
          <button type="button" onClick={() => setFilter(null)}>
            clear
          </button>
        </p>
      )}
      <ul>
        {visible.map((todo) => (
          <li key={todo.id} class={todo.done ? "done" : ""}>
            <input
              type="checkbox"
              checked={todo.done}
              onChange={() => void toggle(todo)}
              aria-label={`Done: ${todo.title}`}
            />
            <span class="title">{todo.title}</span>
            {todo.tags.map((tag) => (
              <button
                key={tag}
                type="button"
                class={`tag ${tag === filter ? "active" : ""}`}
                onClick={() => setFilter(tag === filter ? null : tag)}
              >
                #{tag}
              </button>
            ))}
            <button
              type="button"
              class="delete"
              onClick={() => void remove(todo)}
              aria-label={`Delete: ${todo.title}`}
            >
              ✕
            </button>
          </li>
        ))}
        {visible.length === 0 && <li class="empty">Nothing here.</li>}
      </ul>
    </section>
  );
}
