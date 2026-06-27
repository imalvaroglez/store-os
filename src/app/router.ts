import { useEffect, useState } from "react";
import { matchRoute } from "../lib/router";
import type { RouteMatch } from "../lib/router";

// useRoute: subscribes to popstate + our synthetic navigate() events.
// ponytail: ~60 lines, no dependency. Returns the current route match.
export function useRoute(): RouteMatch {
  const [route, setRoute] = useState<RouteMatch>(() =>
    matchRoute(window.location.pathname)
  );

  useEffect(() => {
    const onChange = () => setRoute(matchRoute(window.location.pathname));
    window.addEventListener("popstate", onChange);
    return () => window.removeEventListener("popstate", onChange);
  }, []);

  return route;
}
