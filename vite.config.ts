import fs from "node:fs";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import type { ServerResponse } from "node:http";

function sendFile(file: string, res: ServerResponse, contentType: string): boolean {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return false;
  res.setHeader("Content-Type", contentType);
  fs.createReadStream(file).pipe(res);
  return true;
}

function storyDataPlugin(): Plugin {
  return {
    name: "story-data",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = decodeURIComponent((req.url ?? "").split("?")[0] ?? "");
        const normalized = url.replace(/^\/truyen(?=\/|$)/, "") || "/";
        if (normalized === "/toc.json") {
          if (sendFile(path.resolve("toc.json"), res, "application/json; charset=utf-8")) return;
        }
        const chapterMatch = /^\/chapters\/(\d+)\.txt$/.exec(normalized);
        if (chapterMatch) {
          const file = path.resolve("chapters", `${chapterMatch[1]}.txt`);
          if (sendFile(file, res, "text/html; charset=utf-8")) return;
        }
        const imageMatch = /^\/hinhanh\/([^/]+\.(webp|png|jpe?g|svg|gif))$/i.exec(normalized);
        if (imageMatch) {
          const file = path.resolve("hinhanh", imageMatch[1]);
          const ext = imageMatch[2].toLowerCase();
          const type =
            ext === "svg"
              ? "image/svg+xml"
              : ext === "jpg" || ext === "jpeg"
                ? "image/jpeg"
                : `image/${ext}`;
          if (sendFile(file, res, type)) return;
        }
        next();
      });
    },
    closeBundle() {
      const dist = path.resolve("dist");
      fs.mkdirSync(dist, { recursive: true });
      fs.copyFileSync(path.resolve("toc.json"), path.join(dist, "toc.json"));
      fs.cpSync(path.resolve("chapters"), path.join(dist, "chapters"), { recursive: true });
      fs.cpSync(path.resolve("hinhanh"), path.join(dist, "hinhanh"), { recursive: true });
    },
  };
}

export default defineConfig({
  // GitHub Pages project site: https://thaiv23.github.io/truyen/
  base: "/truyen/",
  plugins: [storyDataPlugin()],
  server: {
    port: 5173,
    strictPort: true,
  },
});
