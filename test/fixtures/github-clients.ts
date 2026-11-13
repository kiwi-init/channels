import type { Api as SizeApi } from "../../scripts/pr-size.ts";
import type { Api as QuarantineApi } from "../../scripts/quarantine.ts";
import type { Api as TrackerApi } from "../../scripts/tracker.ts";
import type { Api as BlastApi } from "../../scripts/blast-radius.ts";

export const GITHUB_CLIENT_BASE = "758ac506a4dbc6648b29545692d1e627a834ebbb";

function record(x: unknown): Record<string, unknown> {
  return x !== null && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x)) : {};
}

function list(x: unknown): unknown[] {
  return Array.isArray(x) ? x : [];
}

export function prSize(repo: string, token: string, dryRun: boolean): SizeApi {
  const root = `${process.env.GITHUB_API_URL ?? "https://api.github.com"}/repos/${repo}`;
  return async (method, route, body) => {
    if (dryRun && method !== "GET") {
      console.log(`would ${method} ${route}${body === undefined ? "" : ` ${JSON.stringify(body)}`}`);
      return null;
    }
    const headers: Record<string, string> = { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" };
    if (token) headers.authorization = `Bearer ${token}`;
    if (body !== undefined) headers["content-type"] = "application/json";
    const res = await fetch(`${root}${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    if (res.status === 404 && (method === "GET" || method === "DELETE")) return null;
    if (!res.ok) throw new Error(`${method} ${route}: ${res.status} ${await res.text()}`);
    return res.status === 204 ? null : res.json();
  };
}

export function quarantine(repo: string, token: string, dryRun: boolean): QuarantineApi {
  const root = process.env.GITHUB_API_URL ?? "https://api.github.com";
  const headers: Record<string, string> = { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const call = async (method: string, url: string, body?: unknown): Promise<unknown> => {
    const res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    if (res.status === 404 && (method === "GET" || method === "DELETE")) return null;
    if (!res.ok) throw new Error(`${method} ${url}: ${res.status} ${await res.text()}`);
    return res.status === 204 ? null : res.json();
  };
  return {
    rest: async (method, path, body) => {
      if (dryRun && method !== "GET") {
        console.log(`would ${method} ${path}${body === undefined ? "" : ` ${JSON.stringify(body)}`}`);
        return null;
      }
      return call(method, `${root}/repos/${repo}${path}`, body);
    },
    graphql: async (query, variables) => {
      if (dryRun) {
        console.log(`would ${/\{\s*(\w+)\(/.exec(query)?.[1] ?? query} ${JSON.stringify(variables)}`);
        return null;
      }
      const out = record(await call("POST", `${root}/graphql`, { query, variables }));
      if (list(out.errors).length > 0) throw new Error(`graphql: ${JSON.stringify(out.errors)}`);
      return out.data;
    },
  };
}

export function tracker(repo: string, read: string, write: string, dryRun: boolean): TrackerApi {
  const root = process.env.GITHUB_API_URL ?? "https://api.github.com";
  const call = async (method: string, url: string, token: string, body?: unknown): Promise<unknown> => {
    const headers: Record<string, string> = { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "content-type": "application/json" };
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!res.ok) throw new Error(`${method} ${url}: ${res.status} ${await res.text()}`);
    return res.status === 204 ? null : res.json();
  };
  return {
    rest: async (method, path, body) => {
      if (method === "GET") return call(method, `${root}/repos/${repo}${path}`, read);
      if (dryRun) {
        console.log(`would ${method} ${path}`);
        return null;
      }
      return call(method, `${root}/repos/${repo}${path}`, write, body);
    },
    graphql: async (query, variables) => {
      const out = record(await call("POST", `${root}/graphql`, read, { query, variables }));
      if (list(out.errors).length > 0) throw new Error(`graphql: ${JSON.stringify(out.errors)}`);
      return out.data;
    },
  };
}

export function blastRadius(repo: string, token: string, dryRun: boolean): BlastApi {
  const root = `${process.env.GITHUB_API_URL ?? "https://api.github.com"}/repos/${repo}`;
  const headers: Record<string, string> = { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  return {
    rest: async (method, path, body) => {
      if (dryRun && method !== "GET") {
        console.log(`would ${method} ${path}`);
        return null;
      }
      const res = await fetch(`${root}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      if (res.status === 404 && (method === "GET" || method === "DELETE")) return null;
      if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
      return res.status === 204 ? null : res.json();
    },
  };
}
