import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import {
  createProject,
  targets,
  key,
  calculateVersion,
  confirmVersion,
  convert,
} from "../js/core.js";
import { backupText } from "../js/storage/backup.js";
function fixture(name, integer = true, step = 10) {
  const p = createProject(name);
  p.meta.printer = "가상 장비";
  p.meta.paper = "시험 용지";
  p.settings = { channels: ["C", "K"], step, integer, precision: 2 };
  for (const c of p.settings.channels)
    for (const t of targets(p.settings))
      p.first[key(c, t)] = { L: 100 - (0.8 * t * t) / 100, a: 0, b: 0 };
  const v = calculateVersion(p);
  for (const c of v.channels)
    for (const r of v.tables[c])
      v.second[key(c, r.target)] = {
        actual: r.production,
        L: 100 - 0.8 * r.target,
        a: 0,
        b: 0,
      };
  confirmVersion(p, v);
  return p;
}
const browser = await chromium.launch({
    headless: true,
    ...(process.env.BROWSER_EXECUTABLE
      ? { executablePath: process.env.BROWSER_EXECUTABLE }
      : {}),
  }),
  page = await browser.newPage({
    acceptDownloads: true,
    viewport: { width: 1440, height: 1000 },
  }),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
async function go(route) {
  await page.locator(`nav a[href="#${route}"]`).click();
  await page.locator(`nav a.active[href="#${route}"]`).waitFor();
}
async function load(p) {
  await page.locator("#restore-file").setInputFiles({
    name: "reference.json",
    mimeType: "application/json",
    buffer: Buffer.from(backupText(p)),
  });
  await page.waitForFunction(
    (n) =>
      document
        .querySelector("#project-select")
        .selectedOptions[0].textContent.includes(n),
    p.meta.name,
  );
  await go("correction");
}
try {
  await page.goto(process.env.BASE_URL || "http://127.0.0.1:8050/");
  const p = fixture("조견표 가상 시험");
  await load(p);
  assert.equal(await page.locator(".reference-screen tbody tr").count(), 21);
  assert.equal(await page.locator(".reference-screen thead th").count(), 5);
  assert.equal(await page.locator(".reference-heading p").count(), 0);
  assert.equal(await page.locator(".reference-conditions").count(), 0);
  assert.ok(
    !(await page.locator(".lookup-sheet").textContent()).includes(
      "각 채널을 독립 변환",
    ),
  );
  assert.ok(
    !(await page.locator(".lookup-sheet").textContent()).includes(
      "생성 당시 출력 조건 사본이 없는 과거 버전입니다.",
    ),
  );
  assert.ok(
    (await page.locator(".reference-screen").innerText()).includes(
      "미보정 · 원본 통과",
    ),
  );
  await page.locator("#reference-step").selectOption("1");
  await page.waitForFunction(
    () =>
      document.querySelectorAll(".reference-screen tbody tr").length === 101,
  );
  assert.equal(await page.locator(".reference-print-page").count(), 1);
  for (const t of [0, 23, 50, 100]) {
    const output = convert(p, p.versions[0], { C: t, M: t, Y: t, K: t });
    assert.deepEqual(
      (
        await page
          .locator(".reference-screen tbody tr")
          .nth(t)
          .locator("td")
          .allTextContents()
      ).map(Number),
      output.map((x) => x.output),
    );
  }
  await page.locator("#reference-step").selectOption("custom");
  await page.locator("#reference-custom").fill("7");
  await page.locator("#reference-settings button[type=submit]").click();
  await page.waitForFunction(
    () => document.querySelectorAll(".reference-screen tbody tr").length === 16,
  );
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#export-reference").click(),
  ]);
  const csv = await readFile(await download.path(), "utf8");
  assert.equal(csv.split("\r\n").length, 17);
  assert.ok(csv.includes("미보정·원본 통과"));
  await page.waitForFunction(
    () =>
      document.querySelector("#save-status").textContent === "자동 저장 완료",
  );
  await page.reload();
  await page.waitForSelector(".reference-screen");
  assert.equal(await page.locator("#reference-custom").inputValue(), "7");
  assert.equal(await page.locator(".reference-screen tbody tr").count(), 16);
  const [backup] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#backup").click(),
  ]);
  const saved = JSON.parse(await readFile(await backup.path(), "utf8")).project;
  assert.deepEqual(saved.settings, p.settings);
  assert.deepEqual(saved.first, p.first);
  assert.deepEqual(saved.versions, p.versions);
  await page.locator("#reference-step").selectOption("1");
  await page.waitForFunction(
    () =>
      document.querySelectorAll(".reference-screen tbody tr").length === 101,
  );
  await mkdir("test-results", { recursive: true });
  await page.screenshot({
    path: "test-results/reference-sheet-screen.png",
    fullPage: true,
  });
  await page.evaluate(() => (window.print = () => {}));
  await page.locator("#print-reference").click();
  await page.emulateMedia({ media: "print" });
  assert.equal(
    await page.evaluate(
      () => getComputedStyle(document.documentElement).backgroundColor,
    ),
    "rgb(255, 255, 255)",
  );
  assert.equal(await page.locator(".reference-screen").isVisible(), false);
  assert.equal(await page.locator(".reference-print").isVisible(), true);
  assert.equal(await page.locator("aside").isVisible(), false);
  assert.equal(await page.locator(".correction-advanced").isVisible(), false);
  assert.equal(await page.locator(".reference-print tbody tr").count(), 101);
  assert.ok(
    (await page.locator(".reference-print thead").first().innerText()).includes(
      "미보정",
    ),
  );
  await page.pdf({
    path: "test-results/reference-sheet-print.pdf",
    preferCSSPageSize: true,
    printBackground: true,
  });
  await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
  await page.emulateMedia({ media: "screen" });
  await page.emulateMedia({ media: "print" });
  assert.equal(await page.locator("#content > .page-head").isVisible(), false);
  await page.emulateMedia({ media: "screen" });
  const draft = fixture("미확정 참고표");
  draft.versions[0].confirmedAt = null;
  await load(draft);
  assert.ok(
    (
      await page.locator(".reference-screen .reference-status").innerText()
    ).includes("현재 적용 불가"),
  );
  const legacy = fixture("과거 조건 미기록");
  delete legacy.versions[0].conditions;
  await load(legacy);
  assert.equal(await page.locator(".reference-conditions").count(), 0);
  assert.ok(
    !(await page.locator(".lookup-sheet").textContent()).includes(
      "생성 당시 출력 조건 사본이 없는 과거 버전입니다.",
    ),
  );
  await load(fixture("소수 조견표", false));
  await page.locator("#reference-step").selectOption("custom");
  await page.locator("#reference-custom").fill("2.5");
  await page.locator("#reference-settings button[type=submit]").click();
  await page.waitForFunction(
    () => document.querySelectorAll(".reference-screen tbody tr").length === 41,
  );
  assert.equal(
    await page
      .locator(".reference-screen tbody tr")
      .nth(1)
      .locator("th")
      .innerText(),
    "2.50",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const step of [1, 10]) {
    const guide = fixture(`제작 인쇄 ${step}`, false, step);
    await load(guide);
    for (const second of [false, true]) {
      await go(second ? "guide2" : "guide1");
      assert.equal(await page.locator(".guide-print").isVisible(), false);
      await page.emulateMedia({ media: "print" });
      assert.equal(await page.locator(".guide-print").isVisible(), true);
      assert.equal(await page.locator(".guide-screen").isVisible(), false);
      assert.equal(
        await page.locator("#content > .page-head").isVisible(),
        false,
      );
      assert.deepEqual(
        await page
          .locator(".guide-print-table")
          .first()
          .locator('[role="columnheader"]')
          .allTextContents(),
        ["목표값 (%)", "C 제작값 (%)"],
      );
      const cells = (
        await page.locator('.guide-print-table [role="cell"]').allTextContents()
      ).map(Number);
      assert.deepEqual(
        cells,
        guide.versions[0].tables.C.flatMap((r) => [
          r.target,
          second ? r.production : r.target,
        ]),
      );
      assert.equal(
        await page.locator(".guide-print .reference-print-page").count(),
        1,
      );
      await page.pdf({
        path: `test-results/guide-${second ? 2 : 1}-${step}-print.pdf`,
        preferCSSPageSize: true,
        printBackground: true,
      });
      await page.emulateMedia({ media: "screen" });
    }
  }
  assert.deepEqual(errors, []);
  console.log(
    "reference: CMYK 동시 표시, 계산기 일치, 분해능·사용자 간격·설정 복원, 측정/버전 보존, CSV, 101행 인쇄·화면 분리, 미확정 표시, 소수/모바일 PASS",
  );
} finally {
  await browser.close();
}
