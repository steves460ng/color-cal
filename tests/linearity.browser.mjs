import assert from "node:assert/strict";
import { chromium } from "playwright";
import { readFile, mkdir } from "node:fs/promises";
import { createProject, targets, key } from "../js/core.js";
import { backupText } from "../js/storage/backup.js";
const browser = await chromium.launch({
  headless: true,
  ...(process.env.BROWSER_EXECUTABLE
    ? { executablePath: process.env.BROWSER_EXECUTABLE }
    : {}),
});
const context = await browser.newContext({
    acceptDownloads: true,
    viewport: { width: 1440, height: 1000 },
  }),
  page = await context.newPage(),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const base = process.env.BASE_URL || "http://127.0.0.1:8030/";
async function go(route) {
  await page.locator(`nav a[href="#${route}"]`).click();
  await page.locator(`nav a.active[href="#${route}"]`).waitFor();
}
async function load(p) {
  await page
    .locator("#restore-file")
    .setInputFiles({
      name: "report-test.json",
      mimeType: "application/json",
      buffer: Buffer.from(backupText(p)),
    });
  await page.waitForFunction(
    (name) =>
      document
        .querySelector("#project-select")
        .selectedOptions[0].textContent.includes(name),
    p.meta.name,
  );
}
async function backup() {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#backup").click(),
  ]);
  return JSON.parse(await readFile(await download.path(), "utf8")).project;
}
function fixture(name, step = 10, fn = (t) => t) {
  const p = createProject(name);
  p.settings = { channels: ["C"], step, integer: true, precision: 2 };
  for (const t of targets(p.settings))
    p.first[key("C", t)] = { L: 100 - fn(t) * 0.8, a: 0, b: 0 };
  return p;
}
try {
  await page.goto(base);
  const p = fixture("원본 구간 진단");
  p.first["C:30"].L = 52;
  p.first["C:40"].L = 84;
  p.first["C:50"].L = 84;
  await load(p);
  await go("measure1");
  await page.locator("[data-prepare-second]").click();
  await page.locator('nav a.active[href="#results1"]').waitFor();
  assert.equal(await page.locator("#report-max").innerText(), "30.00");
  assert.ok((await page.locator("main").innerText()).includes("계조 역전"));
  assert.ok((await page.locator("main").innerText()).includes("평탄 구간"));
  assert.ok((await page.locator("main").innerText()).includes("급격한 변화"));
  assert.equal(await page.locator("canvas").count(), 5);
  const [csvFile] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#export-report").click(),
  ]);
  const csv = await readFile(await csvFile.path(), "utf8");
  assert.equal(csv.split("\r\n").length, 12);
  assert.ok(csv.includes("계조 역전"));
  assert.ok(csv.includes("보정 후 개선 판정 미포함"));
  let snapshot = await backup();
  assert.equal(snapshot.versions.length, 1);
  assert.deepEqual(snapshot.first, p.first);
  await page.locator('[data-review-target="40"]').first().click();
  await page.locator('nav a.active[href="#measure1"]').waitFor();
  await page.waitForFunction(() => document.activeElement.id === 'C-P1-40-L');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'C-P1-40-L');
  assert.equal(await page.locator("#C-P1-40-L").inputValue(), "84");
  await page.locator("[data-prepare-second]").click();
  await page.locator('nav a.active[href="#results1"]').waitFor();
  snapshot = await backup();
  assert.equal(snapshot.versions.length, 1);
  assert.deepEqual(snapshot.first, p.first);
  await page.locator("#report-lab-details").evaluate((el) => (el.open = true));
  await page
    .locator("#report-lab-details")
    .evaluate(() => new Promise(requestAnimationFrame));
  await page.emulateMedia({ media: "print" });
  assert.equal(await page.locator("#report-mean").isVisible(), true);
  assert.equal(
    await page.locator("[data-destination=guide2]").isVisible(),
    false,
  );
  await page.emulateMedia({ media: "screen" });
  await mkdir("test-results", { recursive: true });
  await page.screenshot({
    path: "test-results/linearity-report.png",
    fullPage: true,
  });
  await page.locator('[data-destination="guide2"]').click();
  await page.locator('nav a.active[href="#guide2"]').waitFor();
  assert.equal(await page.locator("#version-select option").count(), 1);
  await load(fixture("반올림 중복", 1, (t) => 100 * Math.sqrt(t / 100)));
  await go("measure1");
  await page.locator("[data-prepare-second]").click();
  await page.locator('nav a.active[href="#results1"]').waitFor();
  assert.ok(Number(await page.locator("#report-duplicates").innerText()) > 0);
  const flat = fixture("끝점 불량");
  flat.first["C:100"] = { ...flat.first["C:0"] };
  await load(flat);
  await go("measure1");
  await page.locator("[data-prepare-second]").click();
  await page.locator('nav a.active[href="#results1"]').waitFor();
  assert.equal(
    await page.locator("[data-destination=guide2]").isDisabled(),
    true,
  );
  assert.ok(
    (await page.locator("main").innerText()).includes("차이가 너무 작거나"),
  );
  assert.equal((await backup()).versions.length, 0);
  const partial = fixture("채널 미완료");
  partial.settings.channels = ["C", "M"];
  await load(partial);
  await go("results1");
  assert.equal(
    await page.locator("[data-destination=guide2]").isDisabled(),
    true,
  );
  assert.ok((await page.locator("main").innerText()).includes("M"));
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  assert.deepEqual(errors, []);
  console.log(
    "linearity: 자동 리포트·보정 저장, 원본 오차·이상 구간, 셀 복귀, 제작값 중복, CSV·인쇄, 버전 재사용·원본 보호, 끝점 불량·채널 미완료 차단, 모바일 PASS",
  );
} finally {
  await browser.close();
}
