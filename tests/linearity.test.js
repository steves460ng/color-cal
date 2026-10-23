import test from "node:test";
import assert from "node:assert/strict";
import { createProject, targets, key, calculateVersion } from "../js/core.js";
import { analyzeChannel, firstPassReport } from "../js/domain/linearity.js";
function sample(fn = (t) => t, step = 10) {
  const p = createProject();
  p.settings = { channels: ["C"], step, integer: true, precision: 2 };
  for (const t of targets(p.settings))
    p.first[key("C", t)] = { L: 100 - fn(t) * 0.8, a: 0, b: 0 };
  return p;
}
test("선형 원본의 평균·최대 오차는 0이며 원본을 변경하지 않음", () => {
  const p = sample(),
    copy = structuredClone(p);
  const r = firstPassReport(p);
  assert.equal(r.canProceed, true);
  assert.ok(r.channels[0].meanError < 1e-12);
  assert.ok(r.channels[0].maxError < 1e-12);
  assert.deepEqual(r.channels[0].anomalies, []);
  assert.deepEqual(p, copy);
});
test("비선형 원본의 계조 오차는 보정 후 오차와 혼동하지 않고 직접 산출", () => {
  const p = sample((t) => (t * t) / 100),
    r = analyzeChannel(p.first, p.settings, "C");
  assert.ok(Math.abs(r.points[5].tone - 25) < 1e-10);
  assert.ok(Math.abs(r.points[5].error + 25) < 1e-10);
  assert.ok(Math.abs(r.maxError - 25) < 1e-10);
  assert.ok(Math.abs(r.meanError - 15) < 1e-10);
  assert.ok(r.points[5].internal > 70);
});
test("단조 회귀 전의 역전·평탄·급변을 찾아 원본 계조를 보존", () => {
  const p = sample();
  p.first["C:30"].L = 100 - 60 * 0.8;
  p.first["C:40"].L = 100 - 20 * 0.8;
  p.first["C:50"].L = 100 - 20 * 0.8;
  const r = analyzeChannel(p.first, p.settings, "C");
  assert.ok(
    r.anomalies.some(
      (a) => a.type === "계조 역전" && a.from === 30 && a.to === 40,
    ),
  );
  assert.ok(
    r.anomalies.some(
      (a) => a.type === "평탄 구간" && a.from === 40 && a.to === 50,
    ),
  );
  assert.ok(
    r.anomalies.some(
      (a) => a.type === "급격한 변화" && a.from === 20 && a.to === 30,
    ),
  );
  assert.ok(Math.abs(r.points[3].tone - 60) < 1e-10);
});
test("정수 제작값 중복은 목표 ID를 유지하고 추가 중복 개수를 정확히 집계", () => {
  const p = sample((t) => 100 * Math.sqrt(t / 100), 1);
  const v = calculateVersion(p),
    r = analyzeChannel(p.first, p.settings, "C", v.tables.C);
  const unique = new Set(v.tables.C.map((x) => x.production));
  assert.equal(r.duplicateExtras, 101 - unique.size);
  assert.ok(r.duplicateGroups.length > 0);
  assert.equal(r.points.length, 101);
});
test("끝점 누락·같은 끝점·중간 누락은 진행 불가이며 오차를 완성된 리포트처럼 표시하지 않음", () => {
  for (const change of [
    (p) => delete p.first["C:0"],
    (p) => (p.first["C:100"] = { ...p.first["C:0"] }),
    (p) => delete p.first["C:50"],
  ]) {
    const p = sample();
    change(p);
    const r = firstPassReport(p);
    assert.equal(r.canProceed, false);
    assert.equal(r.channels[0].meanError, null);
    assert.ok(r.channels[0].error);
  }
});
test("채널별 결과와 진행 여부는 선택 채널 모두의 입력을 반영", () => {
  const p = sample();
  p.settings.channels = ["C", "M"];
  const r = firstPassReport(p);
  assert.equal(r.channels.length, 2);
  assert.equal(r.totalPatches, 22);
  assert.equal(r.completed, 11);
  assert.equal(r.canProceed, false);
});
test("기존 버전의 제작값을 그대로 리포트에 사용", () => {
  const p = sample(),
    v = calculateVersion(p),
    r = firstPassReport(p, v);
  assert.equal(r.versionNumber, v.number);
  assert.deepEqual(
    r.channels[0].points.map((x) => x.production),
    v.tables.C.map((x) => x.production),
  );
});

test("한 구간의 급변과 최대 농도 초과는 검토 구간 하나로 집계", () => {
  const p = sample();
  p.first["C:30"].L = 4;
  const r = analyzeChannel(p.first, p.settings, "C");
  const unique = new Set(r.anomalies.map((a) => `${a.from}:${a.to}`));
  assert.equal(r.reviewIntervals, unique.size);
  assert.ok(r.anomalies.length > r.reviewIntervals);
  assert.ok(r.points[3].tone > 100);
});
test("매우 큰 유한 계조의 평균을 합산 오버플로 없이 계산", () => {
  const p = sample((t) => t, 1);
  for (const t of targets(p.settings)) {
    p.first[key("C", t)] = {
      L: 100,
      a: t === 0 ? 0 : t === 100 ? 0.01 : 1e303,
      b: 0,
    };
  }
  const r = analyzeChannel(p.first, p.settings, "C");
  assert.equal(r.ready, true);
  assert.ok(Number.isFinite(r.meanError));
  assert.ok(r.meanError > 1e305);
});
