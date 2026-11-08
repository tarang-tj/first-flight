// Dev capture: node web/world/capture.mjs [shotName ...]   -> artifacts/world-<shot>.png (gitignored)
// Serves the repo, opens web/world/dev-preview.html in Chromium (software GL), waits for terrain and
// imagery, screenshots, and reports console problems plus a frame-rate sample.
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createStaticServer, repoRoot } from "../../scripts/static-server.mjs";

const SHOTS = {
  "hero-noon": "view=hero&t=2026-11-08T21:20:00Z",
  "hero-night": "view=hero&t=2026-11-09T04:30:00Z",
  region: "view=region&t=2026-11-08T21:00:00Z",
  "state-trails": "view=state&t=2026-11-08T20:00:00Z&trails=600&tw=2.6",
  chase: "view=hero&t=2026-11-08T22:10:00Z&chase=1",
  offline: "",
  "sun-api": "view=hero&t=2026-11-08T21:20:00Z",
  perf: "view=state&t=2026-11-08T20:00:00Z&trails=1500&animate=1",
  "hero-clear": "view=hero&weather=off&cc=0&t=2026-11-08T21:20:00Z",
  plant: "cam=350,20,-2500,330,16,1500&weather=off&cc=10&t=2026-11-08T21:20:00Z",
  "hero-summer": "view=hero&t=2026-07-15T02:30:00Z",
};
const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SHOTS);
const outDir = fileURLToPath(new URL("../../artifacts/", import.meta.url));
await mkdir(outDir, { recursive: true });

const server = createStaticServer(repoRoot);
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const gpu = process.env.GPU === "1"; // real GPU via Metal for frame-rate samples
const browser = await chromium.launch({ args: gpu ? ["--use-angle=metal", "--ignore-gpu-blocklist", "--enable-gpu"] : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
try {
  for (const name of names) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    const problems = [];
    page.on("console", (m) => { if (m.type() === "error" || (m.type() === "warning" && !/GPU stall/.test(m.text()))) problems.push(`${m.type()}: ${m.text()}`); });
    page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
    const offline = name === "offline";
    if (offline) { // boot-probe contract: every third party answers 200 with an empty body
      await page.route((u) => !u.href.startsWith(base) && !u.href.startsWith("data:"), (r) => r.fulfill({ status: 200, body: "" }));
    }
    await page.goto(`${base}/web/world/dev-preview.html?${SHOTS[offline ? "hero-noon" : name]}`);
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
    await page.evaluate(() => Promise.race([window.__world.imageryReady, new Promise((r) => setTimeout(r, 90000))]));
    await page.waitForTimeout(name === "perf" ? 8000 : 3500);
    console.log('  weather', JSON.stringify(await page.evaluate(() => { const s = window.__world.state; return [s.cloudCover, s.visibilityM, s.precip]; })));
    if (name === "sun-api") { // public API check: setSun must change the picture
      const mean = async () => {
        await page.waitForTimeout(1500);
        const b64 = (await page.screenshot()).toString("base64");
        return page.evaluate(async (d) => {
          const img = new Image(); img.src = "data:image/png;base64," + d; await img.decode();
          const c = document.createElement("canvas"); c.width = 160; c.height = 100;
          const x = c.getContext("2d"); x.drawImage(img, 0, 0, 160, 100);
          const p = x.getImageData(0, 0, 160, 100).data; let s = 0;
          for (let i = 0; i < p.length; i += 4) s += p[i] + p[i + 1] + p[i + 2];
          return s / (p.length / 4) / 3;
        }, b64);
      };
      await page.evaluate(() => window.__world.setSun(new Date("2026-06-21T20:00:00Z")));
      const noon = await mean();
      await page.evaluate(() => window.__world.setSun(new Date("2026-06-22T08:00:00Z")));
      const night = await mean();
      console.log(`sun-api: mean luminance noon=${noon.toFixed(1)} night=${night.toFixed(1)}`);
    }
    console.log('  tiles', JSON.stringify(await page.evaluate(() => window.__tileStats)));
    const lit = await page.evaluate(() => window.__world.litFraction());
    await page.screenshot({ path: `${outDir}world-${name}.png` });
    console.log(`${name}: lit=${lit.toFixed(2)} fps=${await page.evaluate(() => window.__fps)} problems=${problems.length}`);
    problems.slice(0, 6).forEach((p) => console.log("   ", p));
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
