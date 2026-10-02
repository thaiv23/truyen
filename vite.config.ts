import fs from "node:fs";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";

function sendFile(file: string, res: ServerResponse, contentType: string): boolean {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return false;
  res.setHeader("Content-Type", contentType);
  fs.createReadStream(file).pipe(res);
  return true;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function chapterTitles(): string[] {
  const data: unknown = JSON.parse(fs.readFileSync(path.resolve("toc.json"), "utf8"));
  if (Array.isArray(data)) {
    return data.map((entry: { title?: string }) => String(entry?.title ?? ""));
  }
  if (data && typeof data === "object" && Array.isArray((data as { parts?: unknown }).parts)) {
    return (data as { parts: Array<{ titles: string[] }> }).parts.flatMap((part) => part.titles);
  }
  throw new Error("toc.json không đúng định dạng");
}

function injectChapterHtml(html: string, ch: number, titles: string[]): string {
  const title = titles[ch - 1];
  if (!title) return html;
  const file = path.resolve("chapters", `${ch}.txt`);
  if (!fs.existsSync(file)) return html;
  const body = fs.readFileSync(file, "utf8");
  const safeTitle = escapeHtml(title);
  return html
    .replace("<title>Truyện Phàm Nhân Tu Tiên</title>", `<title>${safeTitle}</title>`)
    .replace(/\s*<section id="home"[\s\S]*?<\/section>/, "")
    .replace('<article id="reader">', `<article id="reader" data-prerendered-ch="${ch}">`)
    .replace('<h1 id="chapter-title"></h1>', `<h1 id="chapter-title">${safeTitle}</h1>`)
    .replace('<span class="picker-value"></span>', `<span class="picker-value">${safeTitle}</span>`)
    .replace('<div id="chapter-content"></div>', `<div id="chapter-content">${body}</div>`);
}

function chapterFromRequest(req: IncomingMessage): number {
  const raw = decodeURIComponent((req.url ?? "").split("?")[0] ?? "");
  const normalized = raw.replace(/^\/truyen(?=\/|$)/, "") || "/";
  const match = /^\/(\d+)\.html$/.exec(normalized);
  return match ? Number(match[1]) : 0;
}

function storyDataPlugin(): Plugin {
  let titles: string[] = [];
  return {
    name: "story-data",
    buildStart() {
      titles = chapterTitles();
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const ch = chapterFromRequest(req);
        if (ch > 0) {
          req.url = `/truyen/index.html?safari-ch=${ch}`;
        }
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
    transformIndexHtml(html, ctx) {
      const url = ctx.originalUrl ?? ctx.path;
      const parsed = new URL(url, "http://localhost");
      const fromQuery = parseInt(parsed.searchParams.get("safari-ch") ?? "", 10);
      const fromPath = /\/(\d+)\.html$/.exec(parsed.pathname);
      const ch = fromQuery || (fromPath ? Number(fromPath[1]) : 0);
      if (!ch) return html;
      if (!titles.length) titles = chapterTitles();
      return injectChapterHtml(html, ch, titles);
    },
    closeBundle() {
      const dist = path.resolve("dist");
      fs.mkdirSync(dist, { recursive: true });
      fs.copyFileSync(path.resolve("toc.json"), path.join(dist, "toc.json"));
      fs.cpSync(path.resolve("chapters"), path.join(dist, "chapters"), { recursive: true });
      fs.cpSync(path.resolve("hinhanh"), path.join(dist, "hinhanh"), { recursive: true });
      if (!titles.length) titles = chapterTitles();
      const indexHtml = fs.readFileSync(path.join(dist, "index.html"), "utf8");
      for (let ch = 1; ch <= titles.length; ch++) {
        if (!fs.existsSync(path.resolve("chapters", `${ch}.txt`))) continue;
        fs.writeFileSync(path.join(dist, `${ch}.html`), injectChapterHtml(indexHtml, ch, titles));
      }
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
    watch: {
      ignored: ["**/hinhanh/**", "**/chapters/**", "**/file_truyen_chinese/**"],
    },
  },
});
