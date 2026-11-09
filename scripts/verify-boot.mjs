// Boot probe (the gate's browser step). Serves the repo, opens it in headless
// Chromium (SwiftShader), answers every third party with an empty 200 except
// the pinned jsDelivr modules, and asserts the site boots on its recorded data
// alone: no page or console errors, a full-viewport painted canvas on a dark
// page, the ledger loaded, every mode renders its panel, and the phone layout
// has no horizontal scroll. Screenshots go to artifacts/boot-*.png.
import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { once } from "node:events";
import { join } from "node:path";
import { chromium } from "playwright";
import { createStaticServer, repoRoot } from "./static-server.mjs";

const server = createStaticServer();
server.listen(0, "127.0.0.1");
await once(server, "listening");
const base = `http://127.0.0.1:${server.address().port}`;
const outDir = join(repoRoot, "artifacts");
mkdirSync(outDir, { recursive: true });

const MODES = [
  ["explore", /(Boeing jets? in the air|Explore)/i],
  ["live", /(Latest new Boeing|recorded)/i],
  ["year", /(Year in Light|737)/i],
  ["ledger", /(production rate|deliveries)/i],
];

async function probe(browser, viewport, tag) {
  const errors = [];
  const context = await browser.newContext({ viewport, ...(viewport.width < 500 ? { isMobile: true, hasTouch: true } : {}) });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.stack || e.message}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });
  await page.route("**/*", (route) => {
    const u = route.request().url();
    if (u.startsWith("https://cdn.jsdelivr.net/")) return route.continue();
    if (u.startsWith(base)) {
      const rel = decodeURIComponent(new URL(u).pathname).replace(/^\/+/, "");
      if (rel === "" || existsSync(join(repoRoot, rel))) return route.continue();
    }
    return route.fulfill({ status: 200, contentType: "text/plain", body: "" });
  });
  await page.goto(`${base}/`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__ff?.ready === true, null, { timeout: 60000 });
  assert.equal(await page.evaluate(() => window.__ff.mode), "explore", "default mode must be explore");
  assert.equal(await page.evaluate(() => window.__ff.ledgerLoaded), true, "ledger.json did not load");
  await page.waitForFunction(() => (window.__ff.sky?.activeCount?.() || 0) > 0, null, { timeout: 30000 })
    .catch(() => assert.fail(`${tag}: explore shows no jets in the air`));
  await page.waitForTimeout(3000);
  const lit = await page.evaluate(() => window.__ff.litFraction());
  assert.ok(lit > 0.02, `${tag}: canvas looks unpainted (lit fraction ${lit})`);
  const layout = await page.evaluate(() => {
    const c = document.getElementById("scene");
    return { w: c.clientWidth, h: c.clientHeight, vw: innerWidth, vh: innerHeight,
      bg: getComputedStyle(document.body).backgroundColor, sw: document.documentElement.scrollWidth };
  });
  assert.ok(layout.w >= layout.vw * 0.95 && layout.h >= layout.vh * 0.95, `${tag}: canvas does not fill the viewport ${JSON.stringify(layout)}`);
  assert.notEqual(layout.bg, "rgb(255, 255, 255)", `${tag}: page background is white`);
  assert.ok(layout.sw <= layout.vw + 1, `${tag}: horizontal scroll (${layout.sw} > ${layout.vw})`);
  // Picking. Make the scene deterministic whatever the clock did while loading: pause, jump to the busiest
  // moment, "Find a jet" (chases one, so it sits mid-screen), clear the selection by clicking empty sky,
  // then click the jet and expect the selection chip back. This is the path that broke when the listeners
  // sat on #ui-root, where canvas clicks never arrive.
  const phone = viewport.width < 500;
  const press = (x, y) => (phone ? page.touchscreen.tap(x, y) : page.mouse.click(x, y));
  const chip = ".ex-sel:not([hidden])";
  await page.locator('.td-rate[data-rate="1"]').click();
  if ((await page.locator(".td-play").textContent()) === "Pause") await page.locator(".td-play").click();
  await page.getByRole("button", { name: "Busiest" }).click();
  await page.locator(".td-jump").first().click();
  await page.waitForFunction(() => (window.__ff.sky.activeCount() || 0) > 3, null, { timeout: 30000 }).catch(() => assert.fail(`${tag}: no jets after jumping to the busiest moment`));
  await page.getByRole("button", { name: "Find a jet" }).click();
  await page.waitForSelector(chip, { timeout: 5000 }).catch(() => assert.fail(`${tag}: Find a jet did not select a jet`));
  await page.waitForTimeout(800);
  const jets = await page.evaluate(() => window.__ff.sky.screenJets());
  const mid = { x: viewport.width / 2, y: viewport.height / 2 };
  const target = jets.sort((p, q) => Math.hypot(p.x - mid.x, p.y - mid.y) - Math.hypot(q.x - mid.x, q.y - mid.y))[0];
  assert.ok(target, `${tag}: followed jet is not on screen`);
  const empty = [[0.5, 0.25], [0.2, 0.3], [0.8, 0.35], [0.5, 0.2]].map(([fx, fy]) => ({ x: viewport.width * fx, y: viewport.height * fy }))
    .find((c) => jets.every((j) => Math.hypot(j.x - c.x, j.y - c.y) > 80));
  assert.ok(empty, `${tag}: no empty sky to click`);
  await press(empty.x, empty.y);
  await page.waitForSelector(chip, { state: "detached", timeout: 4000 }).catch(() => assert.fail(`${tag}: clicking empty sky did not clear the selection`));
  await page.waitForTimeout(600);
  const again = await page.evaluate(() => window.__ff.sky.screenJets());
  const t2 = again.find((j) => j.id === target.id) || again[0];
  assert.ok(t2, `${tag}: jet vanished after deselecting`);
  await press(t2.x, t2.y);
  await page.waitForSelector(chip, { timeout: 4000 }).catch(() => assert.fail(`${tag}: clicking a jet at ${Math.round(t2.x)},${Math.round(t2.y)} did not select it`));
  for (const [mode, pattern] of MODES) {
    await page.evaluate((m) => window.__ff.setMode(m), mode);
    await page.waitForTimeout(mode === "year" ? 4000 : 1500);
    assert.equal(await page.evaluate(() => window.__ff.mode), mode);
    const text = await page.evaluate(() => document.getElementById("ui-root").innerText);
    assert.match(text, pattern, `${tag}: ${mode} panel text missing`);
    await page.screenshot({ path: join(outDir, `boot-${tag}-${mode}.png`) });
  }
  await context.close();
  return errors;
}

const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
try {
  const errors = [
    ...(await probe(browser, { width: 1280, height: 800 }, "desktop")),
    ...(await probe(browser, { width: 390, height: 844 }, "phone")),
  ];
  assert.deepEqual(errors, [], `errors during boot:\n${errors.join("\n")}`);
  console.log("verify-boot: OK (desktop + phone, explore/live/year/ledger, no errors)");
} finally {
  await browser.close();
  server.close();
}
