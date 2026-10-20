import type { APIRoute } from "astro";
import { SITE_URL } from "../lib/site-metadata";

export const prerender = true;

export const GET: APIRoute = ({ site }) => {
  const origin = new URL(site ?? SITE_URL).origin;
  const body = [
    "User-agent: *",
    "Allow: /",
    `Sitemap: ${origin}/sitemap.xml`,
    "",
  ].join("\n");

  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};
