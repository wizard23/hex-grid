import { useEffect, useState } from "preact/hooks";

/** client-side routes; the server's SPA fallback serves index.html for all of them */
export type Route = "todos" | "hex-grid";

export const ROUTE_PATHS: Record<Route, string> = { todos: "/", "hex-grid": "/hex-grid" };

export function parseRoute(pathname: string): Route {
  const normalized = pathname.replace(/\/+$/, "") || "/";
  return normalized === ROUTE_PATHS["hex-grid"] ? "hex-grid" : "todos";
}

export function useRoute(): [Route, (route: Route) => void] {
  const [route, setRoute] = useState<Route>(() => parseRoute(location.pathname));

  useEffect(() => {
    const onPopState = () => setRoute(parseRoute(location.pathname));
    addEventListener("popstate", onPopState);
    return () => removeEventListener("popstate", onPopState);
  }, []);

  function navigate(next: Route) {
    if (next === route) return;
    history.pushState(null, "", ROUTE_PATHS[next]);
    setRoute(next);
  }

  return [route, navigate];
}
