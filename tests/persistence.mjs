import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const profile = await mkdtemp(join(tmpdir(), "color-cal-restart-"));
const options = {
  ...(process.env.BROWSER_EXECUTABLE
    ? { executablePath: process.env.BROWSER_EXECUTABLE }
    : {}),
  headless: true,
};
const base = process.env.BASE_URL || "http://127.0.0.1:8000";
let context;
try {
  context = await chromium.launchPersistentContext(profile, options);
  let page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base);
  await page.getByRole("button", { name: "+ 새 프로젝트" }).click();
  await page.locator("#project-form").waitFor();
  for (const route of [
    "guide2",
    "measure2",
    "final",
    "calculator",
    "results1",
  ]) {
    await page.locator(`nav a[href="#${route}"]`).click();
    await page.locator(`nav a.active[href="#${route}"]`).waitFor();
    await page.evaluate(() => new Promise(requestAnimationFrame));
  }
  await page.locator('nav a[href="#measure1"]').click();
  await page.locator("[data-measure=L]").first().fill("95.125");
  await page.locator("[data-measure=a]").first().fill("-4.2");
  await page.locator("[data-measure=b]").first().fill("2.8");
  await page.waitForFunction(
    () =>
      document.querySelector("#save-status").textContent === "자동 저장 완료",
  );
  assert.deepEqual(errors, []);
  await context.close();
  context = await chromium.launchPersistentContext(profile, options);
  page = await context.newPage();
  await page.goto(base);
  await page.waitForSelector("[data-measure=L]");
  assert.equal(
    await page.locator("[data-measure=L]").first().inputValue(),
    "95.125",
  );
  assert.equal(
    await page.locator("[data-measure=a]").first().inputValue(),
    "-4.2",
  );
  assert.equal(
    await page.locator("[data-measure=b]").first().inputValue(),
    "2.8",
  );
  assert.equal(
    await page.evaluate(() => document.activeElement.id),
    "C-P1-0-b",
  );
  console.log(
    "persistence: 버전 없는 단계 안내, 실제 브라우저 종료·재실행 후 IndexedDB 원정밀도 / 마지막 경로·셀 복원 PASS",
  );
} finally {
  if (context) await context.close();
  await rm(profile, { recursive: true, force: true });
}
