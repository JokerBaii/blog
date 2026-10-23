import defaults from "./page-content-defaults.json";
import { apiOrigin } from "@/core/content/blog";
import type { profileTech, animeFavorites, xpFavorites, favoriteGames } from "./profile";
import type { projectEntries } from "./projects";

export type PageContent = typeof defaults & {
  tech: Array<(typeof defaults.tech)[number] & { key: (typeof profileTech)[number]["key"] }>;
  anime: Array<(typeof defaults.anime)[number] & { key: (typeof animeFavorites)[number]["key"] }>;
  favorites: Array<(typeof defaults.favorites)[number] & { key: (typeof xpFavorites)[number]["key"] }>;
  relaxation: Array<(typeof defaults.relaxation)[number] & { key: (typeof favoriteGames)[number]["key"] }>;
  projects: Array<(typeof defaults.projects)[number] & { id: (typeof projectEntries)[number]["id"]; line: (typeof profileTech)[number]["key"] }>;
};

export async function getPageContent(): Promise<PageContent> {
  try {
    const response = await fetch(`${apiOrigin()}/api/page-content`, { cache: "no-store", signal: AbortSignal.timeout(5000) });
    if (response.ok) return await response.json();
  } catch { /* Keep the initial profile readable if the content service is unavailable. */ }
  return structuredClone(defaults) as PageContent;
}
