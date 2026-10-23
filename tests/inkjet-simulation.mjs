/** Generate reproducible simulation backups, independent metrics and a public report. */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { CHANNELS, comparison, deltaE, deriveCalibration } from "../js/core.js";
import { backupText, csv, parseBackup } from "../js/storage/backup.js";
import { inkjetExperiment } from "./helpers/inkjet-experiment.js";
import {
  paperLab,
  inkjetChannels,
  opticalExponent,
} from "./helpers/inkjet-model.js";

const integer = inkjetExperiment(),
  decimal = inkjetExperiment({ integer: false });
const result = {
  model: { paperLab, channels: inkjetChannels, opticalExponent },
  integer: { summary: integer.summary, calculator: integer.calculator },
  decimal: { summary: decimal.summary, calculator: decimal.calculator },
};
if (process.argv[2]) {
  const source = parseBackup(await readFile(process.argv[2], "utf8"));
  const derived = deriveCalibration(
    source.first,
    source.settings.channels,
    source.settings,
  );
  result.suppliedExample = source.settings.channels.map((channel) => ({
    channel,
    labToneAt50:
      (100 *
        deltaE(source.first[`${channel}:0`], source.first[`${channel}:50`])) /
      deltaE(source.first[`${channel}:0`], source.first[`${channel}:100`]),
    midpointProduction: derived.tables[channel].find((r) => r.target === 50)
      .production,
  }));
}
await mkdir("examples", { recursive: true });
await mkdir("test-results/inkjet", { recursive: true });
await writeFile("examples/inkjet-integer.json", backupText(integer.project));
await writeFile("examples/inkjet-decimal.json", backupText(decimal.project));
const details = [
  [
    "모드",
    "채널",
    "목표",
    "1차 L",
    "1차 a",
    "1차 b",
    "내부 보정값",
    "실제 제작값",
    "2차 L",
    "2차 a",
    "2차 b",
    "1차 계조오차 (%p)",
    "2차 계조오차 (%p)",
  ],
];
for (const [mode, run] of [
  ["정수", integer],
  ["소수", decimal],
]) {
  for (const s of run.summary) {
    assert.ok(s.labToneAt50 > 50 && s.midpointProduction < 50);
    assert.ok(s.afterMAE < s.beforeMAE / 5);
  }
  for (const c of CHANNELS)
    for (const r of comparison(run.version, c))
      details.push([
        mode,
        c,
        r.target,
        r.first.L,
        r.first.a,
        r.first.b,
        r.internal,
        r.production,
        r.second.L,
        r.second.a,
        r.second.b,
        r.before,
        r.after,
      ]);
}
await writeFile(
  "test-results/inkjet/results.json",
  JSON.stringify(result, null, 2),
);
await writeFile("test-results/inkjet/measurements.csv", csv(details));
const fmt = (n) => n.toFixed(3);
const table = (summary) =>
  summary
    .map(
      (s) =>
        `| ${s.channel} | ${fmt(s.labToneAt50)} | ${fmt(s.midpointInternal)} → ${s.midpointProduction} | ${fmt(s.beforeMAE)} | ${fmt(s.afterMAE)} | ${fmt(s.afterMax)} |`,
    )
    .join("\n");
const audit = result.suppliedExample
  ? `## 첨부 예시의 방향 확인\n\n첨부 원본은 변경하지 않았습니다. 원본에서 다시 계산한 값입니다.\n\n| 채널 | 50% 입력의 정규화 Lab 계조 (%) | 목표 50%의 제작 입력 (%) |\n|---|---:|---:|\n${result.suppliedExample.map((s) => `| ${s.channel} | ${fmt(s.labToneAt50)} | ${s.midpointProduction} |`).join("\n")}\n\nC·M·K는 중간 계조가 약한 모델이고 Y만 강한 모델입니다. 보정 방향이 서로 다른 것은 해당 합성 원본을 역보간한 결과이며, 계산기를 임의로 반전시키지 않았습니다.\n\n`
  : "";
const report = `# 잉크젯 톤 증가 시뮬레이션\n\n이 자료는 실측이 아닌 가상 장비 실험입니다. 특정 제조사·용지의 대표값으로 해석하거나 실제 출력 보정에 사용하면 안 됩니다.\n\n${audit}## 가정과 독립 검증 방법\n\n- 미보정 잉크젯에서 중간 계조가 진해지는 상황을 가정합니다. 실측으로 추정한 파라미터는 아닙니다.\n- 물리적 유효 면적: \`A(x) = x + 4g x(1−x)[1+s(2x−1)]\`, x는 0~1. g(C/M/Y/K)=0.17/0.19/0.15/0.21, s=−0.10/0.05/−0.08/−0.12. 50%에서 면적은 67/69/65/71%입니다.\n- 종이 Lab=(96, 0.4, −1). 단색 100% Lab은 C=(55,−35,−45), M=(48,65,−12), Y=(88,−7,85), K=(18,0,1)로 가정합니다.\n- D50 기준 Lab을 XYZ로 변환해 \`XYZ = [(1−A)·XYZpaper^(1/n) + A·XYZsolid^(1/n)]^n\`, n=2.2로 혼합합니다. **분광 반사율에 적용하는 Yule–Nielsen 모델의 XYZ 영역 근사**이며 실제 잉크/용지의 분광 특성을 재현하지 않습니다.\n- a*, b*에 채널별 완만한 색상 곡률을 추가하고, 각 측정에 축당 최대 ±0.09 Lab의 결정론적 편차를 추가합니다. 2차에는 최대 0.2%p의 면적 드리프트도 더합니다.\n- 1차: 5% 간격, 채널당 21개. 2차: 보정된 **실제 제작 입력값**을 동일한 연속 모델에 재입력합니다. 목표 계조로 2차 Lab을 만드는 방식은 사용하지 않습니다. 정수/소수 각 168패치, 합계 336패치입니다.\n- 측정 모델은 앱의 보정·역보간 함수를 참조하지 않습니다. 2차 오차는 별도의 거리 수식으로 앱 표시값과 대조합니다.\n- 아래 계조는 앱 기준인 종이색 대비 ΔE76/종이색–100% ΔE76 × 100입니다. 물리적 면적·농도·표준 TVI와 같은 지표가 아닙니다. 오차 단위는 %p이며 색차 ΔE나 색상 일치율이 아닙니다.\n\n## 정수 모드 결과\n\n| 채널 | 50% 입력의 Lab 계조 (%) | 목표 50% 내부값 → 제작값 | 보정 전 평균 오차 | 보정 후 평균 오차 | 보정 후 최대 오차 |\n|---|---:|---:|---:|---:|---:|\n${table(integer.summary)}\n\n## 소수 모드 결과\n\n| 채널 | 50% 입력의 Lab 계조 (%) | 목표 50% 내부값 → 제작값 | 보정 전 평균 오차 | 보정 후 평균 오차 | 보정 후 최대 오차 |\n|---|---:|---:|---:|---:|---:|\n${table(decimal.summary)}\n\n내부 보정값은 두 모드에서 동일하고 마지막 제작값에만 반올림을 적용합니다. 4채널 모두 50% 입력이 목표보다 진하고, 목표 50%의 제작 입력은 50%보다 낮습니다. 편차·반올림·보간 때문에 2차 오차를 0으로 가정하지 않습니다.\n\n## 확인 범위와 재현\n\n단위 테스트는 정수/소수 × 측정 간격 1/2/5/10%에서 개선 여부, 보정 방향, 범위, 실제 제작값 연결 및 JSON 왕복을 검사합니다. 세 가지 면적 증가 강도에서 모델의 단조성도 검사합니다. 이는 선택한 가정에서의 알고리즘 검증이며 실제 프린터 성능 보장이 아닙니다.\n\n\`\`\`sh\nnpm test\nnpm run simulate:inkjet\n# 로컬 정적 서버가 실행 중일 때\nBASE_URL=http://127.0.0.1:8050/ BROWSER_EXECUTABLE=/usr/bin/chromium npm run test:inkjet\n\`\`\`\n\n앱의 JSON 복원에서 [정수 예시](../examples/inkjet-integer.json) 또는 [소수 예시](../examples/inkjet-decimal.json)를 열 수 있습니다. 새 프로젝트로 가져오므로 기존 작업을 덮어쓰지 않습니다. 예시는 1·2차 가상 측정과 확정 버전을 포함하며, 조견표 초기 간격은 2%입니다. 재실행하면 예시 JSON의 ID·시각은 새로 생성되고 측정 수치는 동일합니다. 상세 수치/CSV/인쇄 PDF/브라우저 확인 기록은 \`test-results/inkjet/\`에 생성합니다.\n`;
await writeFile("docs/inkjet-simulation-report.md", report);
console.table(integer.summary);
console.table(decimal.summary);
console.log(
  "Independent inkjet simulation PASS; backups: examples/inkjet-{integer,decimal}.json",
);
