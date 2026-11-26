export type NavTab =
  | "dashboard"
  | "tracks"
  | "repos"
  | "tree"
  | "projects"
  | "sprint"
  | "forge";

export interface AppRoute {
  tab: NavTab;
  techSlug: string | null;
  moduleId: string | null;
  sprintMinutes?: number;
}

export function parseLocation(pathname: string, search = ""): AppRoute {
  const clean = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname || "/";
  const parts = clean.split("/").filter(Boolean);

  if (parts.length === 0) {
    return { tab: "dashboard", techSlug: null, moduleId: null };
  }

  const head = parts[0].toLowerCase();

  if (head === "tracks") {
    const slug = parts[1] ? decodeURIComponent(parts[1]) : null;
    return { tab: "tracks", techSlug: slug, moduleId: null };
  }

  if (head === "modules" && parts[1]) {
    return {
      tab: "tracks",
      techSlug: null,
      moduleId: decodeURIComponent(parts.slice(1).join("/")),
    };
  }

  if (head === "repos") {
    return { tab: "repos", techSlug: null, moduleId: null };
  }

  if (head === "tree") {
    return { tab: "tree", techSlug: null, moduleId: null };
  }

  if (head === "projects") {
    return { tab: "projects", techSlug: null, moduleId: null };
  }

  if (head === "sprint") {
    let sprintMinutes: number | undefined;
    if (search) {
      const params = new URLSearchParams(search);
      const raw = Number(params.get("m"));
      if (raw === 2 || raw === 5 || raw === 10) {
        sprintMinutes = raw;
      }
    }
    return { tab: "sprint", techSlug: null, moduleId: null, sprintMinutes };
  }

  if (head === "forge") {
    return { tab: "forge", techSlug: null, moduleId: null };
  }

  return { tab: "dashboard", techSlug: null, moduleId: null };
}

export function routeToPath(route: AppRoute): string {
  if (route.moduleId) {
    return `/modules/${encodeURIComponent(route.moduleId)}`;
  }
  switch (route.tab) {
    case "dashboard":
      return "/";
    case "tracks":
      return route.techSlug ? `/tracks/${encodeURIComponent(route.techSlug)}` : "/tracks";
    case "repos":
      return "/repos";
    case "tree":
      return "/tree";
    case "projects":
      return "/projects";
    case "sprint":
      return route.sprintMinutes ? `/sprint?m=${route.sprintMinutes}` : "/sprint";
    case "forge":
      return "/forge";
    default:
      return "/";
  }
}

export function pushRoute(route: AppRoute, replace = false): string {
  const nextUrl = routeToPath(route);
  if (typeof window !== "undefined") {
    const current = window.location.pathname + window.location.search;
    if (current !== nextUrl) {
      try {
        if (replace) {
          window.history.replaceState(route, "", nextUrl);
        } else {
          window.history.pushState(route, "", nextUrl);
        }
      } catch {
        // Ignore History API errors in restricted environments
      }
    }
  }
  return nextUrl;
}

export function getCurrentRoute(): AppRoute {
  if (typeof window === "undefined") {
    return { tab: "dashboard", techSlug: null, moduleId: null };
  }
  return parseLocation(window.location.pathname, window.location.search);
}

export function subscribePopState(handler: (route: AppRoute) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const listener = () => {
    handler(getCurrentRoute());
  };
  window.addEventListener("popstate", listener);
  return () => window.removeEventListener("popstate", listener);
}
