import type { ModuleSummary } from "./types";

export function extractRepoFromModule(
  mod: Pick<ModuleSummary, "id" | "title" | "content">
): string {
  const prefix = "Interview Prep:";
  if (mod.title.startsWith(prefix)) {
    return mod.title.slice(prefix.length).trim();
  }
  const ghResource = mod.content?.external_resources?.find((r) =>
    r.url.includes("github.com/")
  );
  if (ghResource) {
    const m = ghResource.url.match(/github\.com\/([^/\s]+\/[^/\s#?]+)/i);
    if (m?.[1]) return m[1].replace(/\.git$/i, "");
  }
  return mod.id.replace(/^repo-interview-/, "");
}
