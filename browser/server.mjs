// Servidor local + lanzador de Chrome para la variante (a).
// Uso: node browser/server.mjs [--headless] [--hw=prefer-hardware|prefer-software] [--out=a.mp4] [--delay=ms] [--keep]
// Sirve el repositorio y, en /media/, los vídeos de entrada (MEDIA_DIR o ./media; ver tools/make-sample-media.sh).
// La página manda el MP4 a POST /out/<nombre> y sus métricas a POST /done; entonces se cierra todo.
import { createServer } from "node:http";
import { createReadStream, createWriteStream, statSync, mkdirSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolve, sep, extname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(import.meta.url), "../..");
const MEDIA = resolve(process.env.MEDIA_DIR ?? resolve(ROOT, "media"));
const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const TYPES = { ".html": "text/html", ".mjs": "text/javascript", ".js": "text/javascript", ".wgsl": "text/plain", ".mp4": "video/mp4" };

export function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header ?? "");
  if (!m || (m[1] === "" && m[2] === "")) return null;
  let start, end;
  if (m[1] === "") {
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  return start <= end && start < size ? { start, end } : null;
}

export function resolvePath(urlPath) {
  let p = decodeURIComponent(urlPath.split("?")[0]);
  if (p === "/") p = "/browser/index.html";
  const [base, rel] = p.startsWith("/media/") ? [MEDIA, p.slice(7)] : [ROOT, p.slice(1)];
  const full = resolve(base, rel);
  return full.startsWith(base + sep) ? full : null;
}

function serveFile(req, res, file) {
  let size;
  try {
    size = statSync(file).size;
  } catch {
    res.writeHead(404).end();
    return;
  }
  const headers = { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream", "Accept-Ranges": "bytes" };
  const range = parseRange(req.headers.range, size);
  if (req.headers.range && !range) {
    res.writeHead(416, { "Content-Range": `bytes */${size}` }).end();
    return;
  }
  if (range) {
    res.writeHead(206, { ...headers, "Content-Range": `bytes ${range.start}-${range.end}/${size}`, "Content-Length": range.end - range.start + 1 });
    createReadStream(file, range).pipe(res);
  } else {
    res.writeHead(200, { ...headers, "Content-Length": size });
    createReadStream(file).pipe(res);
  }
}

function run() {
  const flag = (name, dflt) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1] ?? dflt;
  const headless = process.argv.includes("--headless");
  const query = new URLSearchParams({ hw: flag("hw", "prefer-hardware"), out: flag("out", "a.mp4"), delay: flag("delay", "0") });
  mkdirSync(resolve(ROOT, "out"), { recursive: true });
  let chrome;

  const server = createServer((req, res) => {
    if (req.method === "POST" && req.url.startsWith("/out/")) {
      const name = req.url.slice(5).replace(/[^\w.-]/g, "");
      req.pipe(createWriteStream(resolve(ROOT, "out", name))).on("finish", () => res.end("ok"));
    } else if (req.method === "POST" && (req.url === "/log" || req.url === "/done")) {
      let body = "";
      req.on("data", (d) => (body += d));
      req.on("end", () => {
        res.end("ok");
        if (req.url === "/log") return console.log(`[página] ${body}`);
        const stats = JSON.parse(body);
        writeFileSync(resolve(ROOT, "out", `${query.get("out")}.stats.json`), JSON.stringify(stats, null, 2));
        console.log(JSON.stringify(stats, null, 2));
        if (process.argv.includes("--keep")) return;
        chrome.kill();
        server.close();
        process.exit(stats.error ? 1 : 0);
      });
    } else if (req.method === "GET") {
      const file = resolvePath(req.url);
      file ? serveFile(req, res, file) : res.writeHead(403).end();
    } else {
      res.writeHead(405).end();
    }
  });

  server.listen(8765, "127.0.0.1", () => {
    const url = `http://127.0.0.1:8765/?${query}`;
    chrome = spawn(CHROME, [
      `--user-data-dir=${resolve(ROOT, ".chrome-profile")}`,
      "--force_high_performance_gpu", // Optimus: que el proceso GPU de Chrome use la RTX
      "--no-first-run", "--no-default-browser-check", "--remote-debugging-port=9333",
      "--disable-background-timer-throttling", "--disable-renderer-backgrounding",
      "--disable-backgrounding-occluded-windows",
      ...(headless ? ["--headless=new"] : ["--window-size=900,700"]),
      url,
    ]);
    console.log(`Chrome -> ${url}`);
  });
  setTimeout(() => {
    console.error("Tiempo agotado (15 min)");
    chrome?.kill();
    process.exit(1);
  }, 15 * 60 * 1000).unref();
}

if (process.argv[1]?.endsWith("server.mjs")) run();
