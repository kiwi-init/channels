import type { Server } from "bun";

function headerEnd(out: Uint8Array): number {
  for (let i = 0; i < out.length - 3; i++) if (out[i] === 13 && out[i + 1] === 10 && out[i + 2] === 13 && out[i + 3] === 10) return i;
  return -1;
}

export function serveGit(root: string, port: number): Server<undefined> {
  return Bun.serve({
    port,
    hostname: "127.0.0.1",
    async fetch(req: Request): Promise<Response> {
      const url = new URL(req.url);
      const proc = Bun.spawn(["git", "http-backend"], {
        env: { ...process.env, GIT_PROJECT_ROOT: root, GIT_HTTP_EXPORT_ALL: "1", PATH_INFO: url.pathname, QUERY_STRING: url.search.slice(1), REQUEST_METHOD: req.method, CONTENT_TYPE: req.headers.get("content-type") ?? "", REMOTE_USER: "lab", REMOTE_ADDR: "127.0.0.1" },
        stdin: req.body === null ? "ignore" : new Uint8Array(await req.arrayBuffer()),
        stdout: "pipe",
        stderr: "ignore",
      });
      const out = new Uint8Array(await new Response(proc.stdout).arrayBuffer());
      const end = headerEnd(out);
      if (end < 0) return new Response("git http-backend gave no headers", { status: 502 });
      const headers = new Headers();
      let status = 200;
      for (const line of new TextDecoder().decode(out.subarray(0, end)).split("\r\n")) {
        const at = line.indexOf(":");
        if (at < 0) continue;
        const k = line.slice(0, at).trim();
        const v = line.slice(at + 1).trim();
        if (k.toLowerCase() === "status") status = Number(v.split(" ")[0]);
        else headers.set(k, v);
      }
      return new Response(out.subarray(end + 4), { status, headers });
    },
  });
}
