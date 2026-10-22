import assert from "node:assert/strict";
import { chromium } from "playwright";
const browser = await chromium.launch({
  ...(process.env.BROWSER_EXECUTABLE
    ? { executablePath: process.env.BROWSER_EXECUTABLE }
    : {}),
  headless: true,
});
const page = await browser.newPage(),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const base = process.env.BASE_URL || "http://127.0.0.1:8000";
async function go(route) {
  await page.locator(`nav a[href="#${route}"]`).click();
  await page.locator(`nav a.active[href="#${route}"]`).waitFor();
}
try {
  await page.goto(base);
  await page.getByRole("button", { name: "+ 새 프로젝트" }).click();
  await page.locator("#project-form").waitFor();
  await go("settings");
  await page.locator("#step-preset").selectOption("1");
  await page.getByRole("button", { name: "측정 설정 저장" }).click();
  await go("guide1");
  assert.equal(await page.locator("tbody tr").count(), 101);
  assert.equal(await page.locator("[data-channel]").count(), 4);
  await go("measure1");
  assert.equal(await page.locator("[data-measure]").count(), 303);
  assert.equal(await page.locator(".cell-error:visible").count(), 0);
  await page.locator("[data-measure=L]").first().fill("101");
  assert.equal(await page.locator(".cell-error:visible").count(), 1);
  await page.locator("[data-measure=L]").first().fill("100");
  await page.locator("[data-measure=a]").first().fill("-3");
  await page.locator("[data-measure=b]").first().fill("2");
  await page.locator("[data-channel=M]:not(input)").click();
  assert.equal(await page.locator("[data-measure=L]").first().inputValue(), "");
  await page.locator("[data-channel=C]:not(input)").click();
  assert.equal(
    await page.locator("[data-measure=L]").first().inputValue(),
    "100",
  );
  // The test modifies only its isolated browser context, not application source.
  await page.evaluate(() => {
    window.originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function () {
      throw new DOMException("시험 저장 용량 초과", "QuotaExceededError");
    };
  });
  await page.locator("[data-measure=L]").first().fill("99");
  await page.waitForFunction(() =>
    document.querySelector("#save-status").textContent.includes("저장 실패"),
  );
  assert.equal(
    await page.locator("[data-measure=L]").first().inputValue(),
    "99",
  );
  const [backup] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#backup").click(),
  ]);
  const { readFile } = await import("node:fs/promises");
  const data = JSON.parse(await readFile(await backup.path(), "utf8"));
  assert.equal(data.project.first["C:0"].L, "99");
  await page.evaluate(() => {
    IDBObjectStore.prototype.put = window.originalPut;
  });
  const count = await page.locator("#project-select option").count();
  await page.locator("#restore-file").setInputFiles({
    name: "bad.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"format":"invalid"}'),
  });
  await page.waitForFunction(() =>
    document.querySelector("#toast").textContent.includes("복원 실패"),
  );
  assert.equal(await page.locator("#project-select option").count(), count);
  assert.deepEqual(errors, []);
  console.log(
    "resilience: 4채널 1% 렌더링, 채널별 독립 입력, 오류 안내 표시, 저장 실패 시 초안 보존·JSON 구조, 손상 복원 거부 PASS",
  );
} finally {
  await browser.close();
}
