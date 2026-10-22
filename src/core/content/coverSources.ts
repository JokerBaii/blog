import manifest from "./responsive-covers.json" with { type: "json" };

type CoverSizes = {
  width: number;
  opaque?: boolean;
  variants: { src: string; width: number }[];
};

export function hasTransparentCover(source: string | null | undefined) {
  return source ? (manifest as Record<string, CoverSizes>)[source]?.opaque !== true : false;
}

export function getCoverSources(source: string | null | undefined, sizes: string) {
  const cover = source ? (manifest as Record<string, CoverSizes>)[source] : undefined;
  if (!cover?.variants.length) return {};
  return {
    srcset: [...cover.variants.map(variant => `${variant.src} ${variant.width}w`), `${source} ${cover.width}w`].join(", "),
    sizes
  };
}
