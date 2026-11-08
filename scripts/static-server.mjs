// Minimal static file server rooted at the repo, shared by `npm run serve`
// and the boot probe. Refuses paths that escape the root.
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = fileURLToPath(new URL("../", import.meta.url));

const MIME = {
  ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".mjs": "text/javascript",
  ".json": "application/json", ".glb": "model/gltf-binary", ".png": "image/png", ".jpg": "image/jpeg",
  ".webp": "image/webp", ".bin": "application/octet-stream",
};

/** Create (not start) a server that serves files under `root`. */
export function createStaticServer(root = repoRoot) {
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://127.0.0.1");
      const rel = url.pathname === "/" ? "/index.html" : url.pathname;
      const path = normalize(join(root, decodeURIComponent(rel)));
      if (!path.startsWith(root)) throw new Error("path escapes root");
      const body = await readFile(path);
      res.writeHead(200, { "content-type": MIME[extname(path)] || "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end("not found");
    }
  });
}
