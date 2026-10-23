import defaults from "./page-content-defaults.json";
import { apiOrigin } from "@/core/content/blog";

type TechKey = "cpp" | "cloud" | "algorithms" | "cmake" | "notes";
export type PageContent = typeof defaults & {
  tech: Array<(typeof defaults.tech)[number] & { key: TechKey }>;
  relaxation: Array<(typeof defaults.relaxation)[number] & { key: "cyberpunk-2077" | "the-finals" | "kovaaks" | "aimlabs" }>;
  projects: Array<(typeof defaults.projects)[number] & { id: "cpp-notes" | "cloud-lab" | "algorithm-notes" | "build-notes" | "campus-notes" | "blog-lab"; line: TechKey }>;
};

export async function getPageContent(): Promise<PageContent> {
  try {
    const response = await fetch(`${apiOrigin()}/api/page-content`, { cache: "no-store", signal: AbortSignal.timeout(5000) });
    if (response.ok) return await response.json();
  } catch { /* Keep the initial profile readable if the content service is unavailable. */ }
  return structuredClone(defaults) as PageContent;
}
