import assert from "node:assert/strict";
import {
  CHANNELS,
  createProject,
  targets,
  key,
  calculateVersion,
  confirmVersion,
  comparison,
  convert,
} from "../../js/core.js";
import { backupText, parseBackup } from "../../js/storage/backup.js";
import { measureInkjet, physicalCoverage } from "./inkjet-model.js";
const distance = (a, b) =>
  Math.hypot(...["L", "a", "b"].map((f) => a[f] - b[f]));
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
export function inkjetExperiment({
  integer = true,
  step = 5,
  gainScale = 1,
} = {}) {
  const p = createProject(
    `[시뮬레이션·실측 아님] 잉크젯 톤 증가 · ${integer ? "정수" : "소수"}`,
  );
  Object.assign(p.meta, {
    printer: "미보정 잉크젯 가상 모델",
    paper: "가상 백색 용지",
    ink: "가상 CMYK",
    instrument: "수학적 모델 · 측색계 실측 아님",
    condition: "D50 기준 Lab · XYZ 혼합 근사",
    notes:
      "물리적 면적 증가 + XYZ 영역 Yule–Nielsen 근사(n=2.2), 채널별 색상 곡률, ±0.09 Lab 결정론적 편차 및 2차 미세 드리프트. 실제 장비에서 추정한 파라미터가 아니며 제작용 보정 데이터가 아닙니다.",
  });
  p.settings = { channels: [...CHANNELS], step, integer, precision: 2 };
  for (const c of CHANNELS)
    for (const t of targets(p.settings))
      p.first[key(c, t)] = measureInkjet(c, t, { gainScale });
  const original = structuredClone(p.first),
    version = calculateVersion(p);
  for (const c of CHANNELS)
    for (const r of version.tables[c])
      version.second[key(c, r.target)] = {
        actual: r.production,
        ...measureInkjet(c, r.production, { pass: 2, gainScale }),
      };
  const summary = CHANNELS.map((c) => {
    const start = original[key(c, 0)],
      end = distance(start, original[key(c, 100)]);
    const rows = comparison(version, c);
    for (const r of rows) {
      const independentAfter = Math.abs(
        (100 * distance(start, r.second)) / end - r.target,
      );
      assert.ok(Math.abs(independentAfter - r.after) < 1e-9);
      assert.equal(r.second.actual, r.production);
    }
    const midpoint = version.tables[c].find((r) => r.target === 50);
    return {
      channel: c,
      patches: rows.length,
      physicalCoverageAt50: 100 * physicalCoverage(c, 50, gainScale),
      labToneAt50: (100 * distance(start, original[key(c, 50)])) / end,
      beforeMAE: mean(rows.map((r) => r.before)),
      afterMAE: mean(rows.map((r) => r.after)),
      afterMax: Math.max(...rows.map((r) => r.after)),
      midpointInternal: midpoint?.internal,
      midpointProduction: midpoint?.production,
      improved: rows.filter((r) => r.status === "개선").length,
      worse: rows.filter((r) => r.status === "악화").length,
    };
  });
  assert.deepEqual(p.first, original);
  confirmVersion(p, version);
  p.location = {
    ...p.location,
    route: "correction",
    versionId: version.id,
    referenceStep: 2,
  };
  const restored = parseBackup(backupText(p));
  assert.deepEqual(restored.first, original);
  assert.deepEqual(restored.versions, p.versions);
  return {
    project: p,
    version,
    summary,
    calculator: convert(p, version, { C: 50, M: 30, Y: 70, K: 20 }),
  };
}
