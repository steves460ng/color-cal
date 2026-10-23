import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { inkjetExperiment } from "./helpers/inkjet-experiment.js";
import { convert } from "../js/core.js";
const fixture = JSON.parse(
  await readFile("examples/inkjet-integer.json", "utf8"),
).project;
const expected = inkjetExperiment();
assert.deepEqual(fixture.first, expected.project.first);
const browser = await chromium.launch({
  headless: true,
  ...(process.env.BROWSER_EXECUTABLE
    ? { executablePath: process.env.BROWSER_EXECUTABLE }
    : {}),
});
const context = await browser.newContext({
  acceptDownloads: true,
  permissions: ["clipboard-read", "clipboard-write"],
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage(),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
async function go(route) {
  await page.locator(`nav a[href="#${route}"]`).click();
  await page.locator(`nav a.active[href="#${route}"]`).waitFor();
}
async function channel(c) {
  await page.locator(`button[data-channel="${c}"][aria-pressed]`).click();
  await page
    .locator(`button[data-channel="${c}"][aria-pressed=true]`)
    .waitFor();
}
async function saved() {
  await page.waitForFunction(
    () =>
      document.querySelector("#save-status").textContent === "자동 저장 완료",
  );
}
try {
  await mkdir("test-results/inkjet", { recursive: true });
  await page.goto(process.env.BASE_URL || "http://127.0.0.1:8050/");
  await page.locator("#new-project").click();
  await page
    .locator("[name=name]")
    .fill("[가상 실험] 잉크젯 톤 증가 브라우저 시험");
  await page.getByRole("button", { name: "정보 저장", exact: true }).click();
  await go("measure1");
  for (const c of fixture.settings.channels) {
    await channel(c);
    const labs = Object.entries(fixture.first).filter(([k]) =>
      k.startsWith(c + ":"),
    );
    for (let i = 0; i < labs.length; i++)
      for (const f of ["L", "a", "b"])
        await page
          .locator("tbody tr")
          .nth(i)
          .locator(`[data-measure=${f}]`)
          .fill(String(labs[i][1][f]));
    assert.ok(
      (await page.locator("#completion").innerText()).includes("21 / 21"),
    );
  }
  await saved();
  await page.locator("[data-prepare-second]").click();
  await page.locator('nav a.active[href="#results1"]').waitFor();
  for (const c of fixture.settings.channels) {
    await channel(c);
    assert.equal(
      Number(await page.locator("#report-mean").innerText()),
      Number(
        expected.summary.find((s) => s.channel === c).beforeMAE.toFixed(2),
      ),
    );
  }
  await page.screenshot({
    path: "test-results/inkjet/first-report.png",
    fullPage: true,
  });
  await page.locator('[data-destination="guide2"]').click();
  await page.locator('nav a.active[href="#guide2"]').waitFor();
  await go("measure2");
  for (const c of fixture.settings.channels) {
    await channel(c);
    const rows = fixture.versions[0].tables[c];
    for (let i = 0; i < rows.length; i++) {
      const m = fixture.versions[0].second[`${c}:${rows[i].target}`];
      for (const f of ["actual", "L", "a", "b"])
        await page
          .locator("tbody tr")
          .nth(i)
          .locator(`[data-measure=${f}]`)
          .fill(String(m[f]));
    }
    assert.ok(
      (await page.locator("#completion").innerText()).includes("21 / 21"),
    );
  }
  await saved();
  await go("final");
  for (const c of fixture.settings.channels) {
    await channel(c);
    const metrics = await page.locator(".metric strong").allTextContents(),
      s = expected.summary.find((s) => s.channel === c);
    assert.equal(Number(metrics[1]), Number(s.beforeMAE.toFixed(2)));
    assert.equal(Number(metrics[2]), Number(s.afterMAE.toFixed(2)));
  }
  await page.screenshot({
    path: "test-results/inkjet/final-report.png",
    fullPage: true,
  });
  page.once("dialog", (d) => d.accept());
  await page.locator("#confirm-version").click();
  await page.waitForFunction(
    () => document.querySelector("#confirm-version").disabled,
  );
  await go("calculator");
  for (const c of fixture.settings.channels)
    await page.locator(`#calc-${c}`).fill("50");
  for (const s of expected.summary)
    assert.equal(
      Number(
        (await page.locator(`#output-${s.channel}`).innerText()).replace(
          "%",
          "",
        ),
      ),
      s.midpointProduction,
    );
  await page.locator("#copy-calculator-csv").click();
  assert.equal(
    await page.evaluate(() => navigator.clipboard.readText()),
    "37,36,39,35",
  );
  await go("correction");
  await page.locator("#reference-step").selectOption("2");
  await page.waitForFunction(
    () => document.querySelectorAll(".reference-screen tbody tr").length === 51,
  );
  assert.deepEqual(
    (
      await page
        .locator(".reference-screen tbody tr")
        .nth(25)
        .locator("td")
        .allTextContents()
    ).map(Number),
    [37, 36, 39, 35],
  );
  assert.equal(await page.locator(".reference-heading p").count(), 0);
  assert.ok(
    !(await page.locator(".lookup-sheet").textContent()).includes(
      "생성 당시 출력 조건 사본이 없는 과거 버전입니다.",
    ),
  );
  await page.screenshot({
    path: "test-results/inkjet/reference-sheet.png",
    fullPage: true,
  });
  await page.pdf({
    path: "test-results/inkjet/reference-sheet.pdf",
    preferCSSPageSize: true,
    printBackground: true,
  });
  await page.waitForFunction(
    () =>
      document.querySelector("#save-status").textContent === "자동 저장 완료",
  );
  await page.reload();
  await page.waitForSelector(".reference-screen");
  assert.equal(await page.locator(".reference-screen tbody tr").count(), 51);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#backup").click(),
  ]);
  const savedProject = JSON.parse(
    await readFile(await download.path(), "utf8"),
  ).project;
  for (const [k, lab] of Object.entries(fixture.first))
    for (const f of ["L", "a", "b"])
      assert.equal(Number(savedProject.first[k][f]), lab[f]);
  for (const [k, lab] of Object.entries(fixture.versions[0].second))
    for (const f of ["actual", "L", "a", "b"])
      assert.equal(Number(savedProject.versions[0].second[k][f]), lab[f]);
  await page
    .locator("#restore-file")
    .setInputFiles("examples/inkjet-decimal.json");
  await page.waitForFunction(() =>
    document
      .querySelector("#project-select")
      .selectedOptions[0].textContent.includes("소수"),
  );
  await go("calculator");
  const decimal = inkjetExperiment({ integer: false }),
    input = { C: 23.5, M: 23.5, Y: 23.5, K: 23.5 };
  for (const c of fixture.settings.channels)
    await page.locator(`#calc-${c}`).fill("23.5");
  for (const r of convert(decimal.project, decimal.version, input))
    assert.equal(
      Number(
        (await page.locator(`#output-${r.channel}`).innerText()).replace(
          "%",
          "",
        ),
      ),
      r.output,
    );
  assert.deepEqual(errors, []);
  await writeFile(
    "test-results/inkjet/browser-results.json",
    JSON.stringify(
      {
        passed: true,
        browser: "Chromium",
        firstPatches: 84,
        secondPatches: 84,
        labFields: 504,
        actualFields: 84,
        errors,
        midpointOutput: [37, 36, 39, 35],
        checks: [
          "원본 직접 입력",
          "선형도 리포트",
          "2차 실제 제작값/Lab 직접 입력",
          "독립 오차 일치",
          "확정/계산기/복사",
          "2% 조견표/인쇄",
          "재접속/백업 값 보존",
          "소수 예시 복원",
        ],
      },
      null,
      2,
    ),
  );
  console.log(
    "inkjet: 168 patches, 504 Lab fields, 84 actual inputs; report → remeasurement → confirm → calculator → reference/print → reload/backup → decimal restore PASS",
  );
} finally {
  await browser.close();
}
