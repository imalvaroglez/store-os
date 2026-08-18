import { useEffect, useState } from "react";
import { matchRoute, redirectLegacyAdmin } from "../lib/router";
import type { RouteMatch } from "../lib/router";

// useRoute: subscribes to popstate + our synthetic navigate() events.
// ponytail: ~60 lines, no dependency. Returns the current route match.
export function useRoute(): RouteMatch {
  const [route, setRoute] = useState<RouteMatch>(() =>
    matchRoute(window.location.pathname)
  );

  useEffect(() => {
    // Fresh pageload on a legacy /catalogo-admin URL: the initial state above
    // didn't redirect (dispatching during render is unsafe). Fix it on mount.
    redirectLegacyAdmin(window.location.pathname);
    const onChange = () => {
      // Legacy /catalogo-admin/* → /productos/*: redirect fires its own popstate,
      // which re-enters onChange with the final path.
      if (redirectLegacyAdmin(window.location.pathname)) return;
      setRoute(matchRoute(window.location.pathname));
    };
    window.addEventListener("popstate", onChange);
    return () => window.removeEventListener("popstate", onChange);
  }, []);

  return route;
}
