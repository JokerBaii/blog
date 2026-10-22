import { defineMiddleware } from "astro:middleware";

export const onRequest = defineMiddleware(async (context, next) => {
  const response = await next();
  if (!context.isPrerendered) response.headers.set("Cache-Control", "no-store");
  return response;
});
