import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import {
  createProject,
  targets,
  key,
  calculateVersion,
  confirmVersion,
} from "../js/core.js";
import { backupText } from "../js/storage/backup.js";
const browser = await chromium.launch({
  headless: true,
  ...(process.env.BROWSER_EXECUTABLE
    ? { executablePath: process.env.BROWSER_EXECUTABLE }
    : {}),
});
const context = await browser.newContext({
    acceptDownloads: true,
    permissions: ["clipboard-read", "clipboard-write"],
  }),
  page = await context.newPage(),
  errors = [];
context.on("page", (p) => p.on("pageerror", (e) => errors.push(e.message)));
page.on("pageerror", (e) => errors.push(e.message));
const base = process.env.BASE_URL || "http://127.0.0.1:8030/";
function fixture(name) {
  const p = createProject(name);
  p.meta.paper = "용지 A";
  p.settings = { channels: ["C"], step: 10, integer: false, precision: 2 };
  for (const t of targets(p.settings))
    p.first[key("C", t)] = { L: 100 - 0.8 * t, a: 0, b: 0 };
  const v = calculateVersion(p);
  for (const r of v.tables.C)
    v.second[key("C", r.target)] = {
      actual: r.production,
      L: 100 - r.target * 0.8,
      a: 0,
      b: 0,
    };
  confirmVersion(p, v);
  return p;
}
async function saved(p = page) {
  await p.waitForFunction(
    () =>
      document.querySelector("#save-status").textContent === "자동 저장 완료",
  );
}
async function go(route, p = page) {
  await p.locator(`nav a[href="#${route}"]`).click();
  await p.locator(`nav a.active[href="#${route}"]`).waitFor();
}
async function load(p) {
  const count = await page.locator("#project-select option").count();
  await page
    .locator("#restore-file")
    .setInputFiles({
      name: "test.json",
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
  await saved();
}
try {
  await page.goto(base);
  await load(fixture("동작 회귀 시험"));
  await go("measure1");
  await page.locator("[data-measure=L]").nth(5).fill("60.000");
  await saved();
  await go("calculator");
  assert.equal(await page.locator("#calc-C").isEnabled(), true);
  await go("projects");
  await page.locator("[name=name]").fill("이름만 변경");
  await page.getByRole("button", { name: "정보 저장", exact: true }).click();
  await go("calculator");
  assert.equal(await page.locator("#calc-C").isEnabled(), true);
  await go("projects");
  await page.locator("[name=paper]").fill("용지 B");
  await page.getByRole("button", { name: "정보 저장", exact: true }).click();
  await go("calculator");
  assert.equal(await page.locator("#calc-C").isEnabled(), false);
  await go("measure1");
  await page.locator("[data-prepare-second]").click();
  await page.locator('nav a.active[href="#guide2"]').waitFor();
  assert.equal(await page.locator("#version-select option").count(), 2);
  const exact = createProject("정확한 제작 수치");
  exact.settings = { channels: ["C"], step: 2.5, integer: false, precision: 0 };
  await load(exact);
  await go("guide1");
  assert.equal(
    await page.locator(".guide-production").nth(1).innerText(),
    "2.5",
  );
  await page.locator("#copy-guide").click();
  assert.ok(
    (await page.evaluate(() => navigator.clipboard.readText()))
      .split("\r\n")[2]
      .includes('"2.5"'),
  );
  const mismatch = fixture("제작값 불일치");
  mismatch.versions[0].confirmedAt = null;
  mismatch.versions[0].second["C:50"].actual = 55.5555;
  await load(mismatch);
  await go("guide2");
  assert.equal(
    await page.locator("tbody tr").nth(5).locator("td").last().innerText(),
    "55.5555",
  );
  await go("final");
  assert.equal(await page.locator("#confirm-version").isDisabled(), true);
  assert.ok(
    (await page.locator("main").innerText()).includes(
      "실제 제작값이 보정 테이블과 다릅니다",
    ),
  );
  await go("measure2");
  await page.locator("[data-measure=actual]").nth(5).fill("50");
  await go("final");
  assert.equal(await page.locator("#confirm-version").isEnabled(), true);
  // A read in a second tab can become stale: it must never overwrite the newer record.
  await go("projects");
  await saved();
  const other = await context.newPage();
  await other.goto(base + "#projects");
  await other.waitForSelector("[name=notes]");
  await saved(other);
  await page.reload();
  await page.waitForSelector("[name=notes]");
  await saved();
  await page.locator("[name=notes]").fill("새로 저장된 메모");
  await saved();
  await other.locator("[name=notes]").fill("오래된 탭의 변경");
  await other.waitForFunction(() =>
    document.querySelector("#save-status").textContent.includes("저장 실패"),
  );
  const [download] = await Promise.all([
    other.waitForEvent("download"),
    other.locator("#backup").click(),
  ]);
  const unsaved = JSON.parse(await readFile(await download.path(), "utf8"));
  assert.equal(unsaved.project.meta.notes, "오래된 탭의 변경");
  const verify = await context.newPage();
  await verify.goto(base + "#projects");
  await verify.waitForSelector("[name=notes]");
  assert.equal(
    await verify.locator("[name=notes]").inputValue(),
    "새로 저장된 메모",
  );
  await verify.close();
  await other.close();
  // Retry after a transient local storage error must restore the saved status.
  await page.reload();
  await page.waitForSelector("[name=notes]");
  await saved();
  await page.evaluate(() => {
    window.savedPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function () {
      throw new DOMException("test quota", "QuotaExceededError");
    };
  });
  await page.locator("[name=notes]").fill("실패 초안");
  await page.waitForFunction(() =>
    document.querySelector("#save-status").textContent.includes("저장 실패"),
  );
  await page.evaluate(() => {
    IDBObjectStore.prototype.put = window.savedPut;
  });
  await page.locator("[name=notes]").fill("복구 후 저장");
  await saved();
  await page.reload();
  await page.waitForSelector("[name=notes]");
  assert.equal(await page.locator("[name=notes]").inputValue(), "복구 후 저장");
  assert.deepEqual(errors, []);
  console.log(
    "behavior: 동일 숫자 재입력, 이름/출력 조건 구분, 자동 새 버전, 정밀한 제작값·복사, 다른 실제값 확정 차단, 다중 탭 갱신 보호·초안 백업, 저장 실패 복구 PASS",
  );
} finally {
  await browser.close();
}
