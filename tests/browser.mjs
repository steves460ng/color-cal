import assert from "node:assert/strict";
import { chromium, firefox } from "playwright";
import { readFile, mkdir } from "node:fs/promises";
const kind = process.env.BROWSER || "chromium";
const browser = await (kind === "firefox" ? firefox : chromium).launch({
  headless: true,
  ...(kind === "msedge" ? { channel: "msedge" } : {}),
  ...(process.env.BROWSER_EXECUTABLE
    ? { executablePath: process.env.BROWSER_EXECUTABLE }
    : {}),
});
const context = await browser.newContext({ acceptDownloads: true });
const page = await context.newPage(),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const base = process.env.BASE_URL || "http://127.0.0.1:8000";
async function go(route) {
  await page.locator(`nav a[href="#${route}"]`).click();
  await page.locator(`nav a.active[href="#${route}"]`).waitFor();
}
async function saved() {
  await page.waitForFunction(
    () =>
      document.querySelector("#save-status").textContent === "자동 저장 완료",
  );
}
try {
  await page.goto(base);
  await page.getByRole("button", { name: "+ 새 프로젝트" }).click();
  await page.locator("[name=name]").fill("통합 시험 <CMYK>");
  await page.locator("[name=printer]").fill("시험 장비");
  await page.getByRole("button", { name: "정보 저장", exact: true }).click();
  await go("settings");
  for (const c of ["M", "Y", "K"])
    await page.locator(`[name=channels][value=${c}]`).uncheck();
  await page.locator("#step-preset").selectOption("10");
  await page.getByRole("button", { name: "측정 설정 저장" }).click();
  await go("guide1");
  assert.equal(await page.locator("tbody tr").count(), 11);
  assert.ok((await page.locator("tbody tr").nth(5).innerText()).includes("50"));
  await go("measure1");
  assert.equal(await page.locator("[data-prepare-second]").isDisabled(), true);
  for (let i = 0; i <= 10; i++) {
    const tr = page.locator("tbody tr").nth(i);
    await tr.locator("[data-measure=L]").fill(String(100 - 80 * (i / 10) ** 2));
    await tr.locator("[data-measure=a]").fill("0");
    await tr.locator("[data-measure=b]").fill("0");
  }
  assert.ok(
    (await page.locator("#completion").innerText()).includes("11 / 11"),
  );
  await page.locator("[data-measure=L]").first().fill("101");
  assert.equal(
    await page.locator("[data-measure=L]").first().getAttribute("aria-invalid"),
    "true",
  );
  assert.ok(
    (await page.locator("#completion").innerText()).includes("10 / 11"),
  );
  await page.locator("[data-measure=L]").first().fill("100");
  await saved();
  await page.reload();
  await page.waitForSelector("[data-measure=L]");
  assert.equal(
    await page.locator("[data-measure=L]").first().inputValue(),
    "100",
  );
  assert.ok(
    (await page.locator("#completion").innerText()).includes("11 / 11"),
  );
  await go("results1");
  assert.equal(await page.locator("canvas").count(), 3);
  await go("measure1");
  assert.equal(await page.locator("[data-prepare-second]").isEnabled(), true);
  await page.locator("[data-prepare-second]").click();
  await page.locator('nav a.active[href="#guide2"]').waitFor();
  await page.waitForSelector("#version-select");
  assert.equal(await page.locator("tbody tr").count(), 11);
  assert.ok((await page.locator("tbody").innerText()).includes("미기록"));
  await go("measure2");
  for (let i = 0; i <= 10; i++) {
    const tr = page.locator("tbody tr").nth(i);
    const actual = Number(await tr.locator("td").nth(2).innerText());
    await tr.locator("[data-measure=actual]").fill(String(actual));
    await tr
      .locator("[data-measure=L]")
      .fill(String(100 - 80 * (actual / 100) ** 2));
    await tr.locator("[data-measure=a]").fill("0");
    await tr.locator("[data-measure=b]").fill("0");
  }
  assert.ok(
    (await page.locator("#completion").innerText()).includes("11 / 11"),
  );
  await saved();
  await go("final");
  assert.equal(await page.locator("canvas").count(), 4);
  assert.equal(await page.locator("#confirm-version").isEnabled(), true);
  page.once("dialog", (d) => d.accept());
  await page.locator("#confirm-version").click();
  await page.waitForFunction(
    () => document.querySelector("#confirm-version").disabled,
  );
  await go("calculator");
  await page.locator("#calc-C").fill("50");
  await page.locator("#calc-M").fill("30");
  assert.equal(await page.locator("#output-C").innerText(), "71%");
  assert.equal(await page.locator("#output-M").innerText(), "30%");
  await page.locator("#calc-C").fill("50.5");
  assert.equal(await page.locator("#copy-calculator").isEnabled(), false);
  await page.locator("#calc-integer").uncheck();
  assert.equal(await page.locator("#copy-calculator").isEnabled(), true);
  assert.equal(await page.locator("#calc-error").innerText(), "");
  await page.locator("#calc-integer").check();
  await page.locator("#calc-C").fill("50");
  if (kind !== "firefox") {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.locator("#copy-calculator-csv").click();
    assert.equal(
      await page.evaluate(() => navigator.clipboard.readText()),
      "71,30,0,0",
    );
  }
  await go("measure2");
  assert.equal(
    await page.locator("[data-measure=actual]").first().isDisabled(),
    true,
  );
  await go("measure1");
  await page.locator("[data-prepare-second]").click();
  await page.locator('nav a.active[href="#guide2"]').waitFor();
  assert.equal(await page.locator("#version-select option").count(), 1);
  await go("measure2");
  assert.equal(
    await page.locator("[data-measure=actual]").nth(5).inputValue(),
    "71",
  );
  assert.equal(
    await page.locator("[data-measure=actual]").nth(5).isDisabled(),
    true,
  );
  await go("final");
  const before = await page.locator("tbody").innerText();
  const [csvDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#export-final").click(),
  ]);
  const csvText = await readFile(await csvDownload.path(), "utf8");
  assert.ok(csvText.includes("실제 제작값"));
  assert.ok(csvText.includes('"71"'));
  const [backup] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#backup").click(),
  ]);
  const backupPath = await backup.path();
  const backupData = JSON.parse(await readFile(backupPath, "utf8"));
  assert.equal(backupData.project.versions[0].second["C:50"].actual, "71");
  await go("settings");
  await page.locator("[name=integer]").uncheck();
  await page.getByRole("button", { name: "측정 설정 저장" }).click();
  await go("final");
  assert.equal(await page.locator("tbody").innerText(), before);
  await go("calculator");
  assert.equal(await page.locator("#calc-C").isDisabled(), true);
  assert.ok((await page.locator("main").innerText()).includes("새 보정 버전"));
  await page.locator("#restore-file").setInputFiles(backupPath);
  await page.waitForFunction(() =>
    document
      .querySelector("#project-select")
      .selectedOptions[0].textContent.includes("복원"),
  );
  assert.equal(await page.locator("#project-select option").count(), 2);
  await go("calculator");
  await page.locator("#calc-C").fill("50");
  assert.equal(await page.locator("#output-C").innerText(), "71%");
  await saved();
  await page.reload();
  await page.waitForSelector("#calc-C");
  assert.equal(await page.locator("#calc-C").isEnabled(), true);
  await go("projects");
  await page.locator("#duplicate-project").click();
  await page.waitForFunction(
    () => document.querySelectorAll("#project-select option").length === 3,
  );
  page.once("dialog", (d) => d.accept());
  await page.locator("#delete-project").click();
  await page.waitForFunction(
    () => document.querySelectorAll("#project-select option").length === 2,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await go("guide1");
  assert.equal(await page.locator("tbody tr").count(), 11);
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.emulateMedia({ media: "print" });
  assert.equal(await page.locator("aside").isVisible(), false);
  await page.emulateMedia({ media: "screen" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await go("projects");
  await mkdir("test-results", { recursive: true });
  await page.screenshot({
    path: `test-results/${kind}-projects.png`,
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    `${kind}: 프로젝트 CRUD, 가이드, Lab 검증·자동 저장·재접속, 1/2차 측정, 버전 확정, 계산기·복사, CSV, JSON 복원, 설정 변경 보호, 모바일·인쇄 PASS`,
  );
} finally {
  await browser.close();
}
