import test from "node:test";
import assert from "node:assert/strict";
import {
  createProject,
  targets,
  production,
  labValid,
  actualValid,
  key,
  isotonic,
  calculateVersion,
  confirmVersion,
  calculatorReason,
  convert,
  comparison,
  versionCurrent,
} from "../js/core.js";
import { backupText, parseBackup, csv } from "../js/storage/backup.js";
function measured(integer = true, channels = ["C"]) {
  const p = createProject("시험 프로젝트");
  p.settings = { channels, step: 10, integer, precision: 2 };
  channels.forEach((c) =>
    targets(p.settings).forEach((t) => {
      p.first[key(c, t)] = { L: 100 - 80 * (t / 100) ** 2, a: 0, b: 0 };
    }),
  );
  return p;
}
function finish(p, v) {
  v.channels.forEach((c) =>
    v.tables[c].forEach((r) => {
      const actual = r.production;
      v.second[key(c, r.target)] = {
        actual,
        L: 100 - 80 * (actual / 100) ** 2,
        a: 0,
        b: 0,
      };
    }),
  );
  confirmVersion(p, v);
  return v;
}
for (const [step, count] of [
  [1, 101],
  [2, 51],
  [5, 21],
  [10, 11],
  [7, 16],
  [100, 2],
])
  test(`패치 증분 ${step}%`, () => {
    const ts = targets({ ...createProject().settings, step });
    assert.equal(ts.length, count);
    assert.equal(ts[0], 0);
    assert.equal(ts.at(-1), 100);
    assert.equal(new Set(ts).size, count);
  });
test("소수 증분과 정수 모드 제약", () => {
  const s = { channels: ["Y"], step: 2.5, integer: false, precision: 2 };
  assert.equal(targets(s).length, 41);
  assert.throws(() => targets({ ...s, integer: true }));
  for (const step of [0, NaN, 101, -1])
    assert.throws(() => targets({ ...s, step }));
});
test("반올림과 범위 / 내부 정밀도", () => {
  const s = createProject().settings;
  for (const [v, expected] of [
    [12.49, 12],
    [12.5, 13],
    [37.53, 38],
    [64.8, 65],
    [99.8, 100],
    [-1, 0],
    [110, 100],
  ])
    assert.equal(production(v, s), expected);
  assert.equal(production(37.53456, { ...s, integer: false }), 37.53);
});
test("Lab 및 실제 제작값 검증", () => {
  assert.equal(labValid({ L: 0, a: -128, b: 200 }), true);
  for (const L of ["", null, 101, -1, Infinity, "abc"])
    assert.equal(labValid({ L, a: 0, b: 0 }), false);
  assert.equal(actualValid(1.5, { integer: true }), false);
  assert.equal(actualValid(1.5, { integer: false }), true);
  assert.equal(actualValid("", { integer: false }), false);
});
test("PAVA는 원본을 바꾸지 않고 비단조를 평탄화", () => {
  const input = [0, 30, 20, 60, 100];
  assert.deepEqual(isotonic(input), [0, 25, 25, 60, 100]);
  assert.deepEqual(input, [0, 30, 20, 60, 100]);
});
test("비선형 역보간 / 단색 채널 독립 / 끝점", () => {
  const p = measured(false);
  const original = structuredClone(p.first);
  const v = calculateVersion(p);
  const half = v.tables.C.find((r) => r.target === 50);
  assert.ok(half.internal > 70 && half.internal < 71);
  assert.equal(half.production, Number(half.internal.toFixed(2)));
  assert.notEqual(half.internal, half.production);
  assert.equal(v.tables.C[0].internal, 0);
  assert.equal(v.tables.C.at(-1).internal, 100);
  assert.deepEqual(p.first, original);
  assert.deepEqual(v.source, original);
});
test("불완전 / 동일 끝점 측정은 거부", () => {
  const p = measured();
  delete p.first["C:10"];
  assert.throws(() => calculateVersion(p));
  p.first["C:10"] = { L: 90, a: 0, b: 0 };
  p.first["C:100"] = { L: 100, a: 0, b: 0 };
  assert.throws(() => calculateVersion(p));
});
test("비단조 경고와 단조 출력", () => {
  const p = measured();
  p.first["C:40"].L = 10;
  const v = calculateVersion(p);
  assert.equal(v.warnings.length, 1);
  v.tables.C.forEach((r, i) => {
    if (i) assert.ok(r.internal >= v.tables.C[i - 1].internal);
  });
});
test("2차 실제 입력 누락 방지 / 확정 활성화 / 미보정 통과", () => {
  const p = measured();
  const v = calculateVersion(p);
  assert.ok(calculatorReason(p, v));
  assert.throws(() => confirmVersion(p, v));
  v.tables.C.forEach(
    (r) =>
      (v.second[key("C", r.target)] = { L: 100 - r.target * 0.8, a: 0, b: 0 }),
  );
  assert.throws(() => confirmVersion(p, v));
  finish(p, v);
  assert.equal(calculatorReason(p, v), "");
  const out = convert(p, v, { C: 50, M: 30, Y: 70, K: 20 });
  assert.equal(out[0].output, production(v.tables.C[5].internal, p.settings));
  assert.equal(out[1].output, 30);
  assert.equal(out[1].applied, false);
  assert.throws(() => convert(p, v, { C: 1.5, M: 0, Y: 0, K: 0 }));
  const decimal = convert(p, v, { C: 50.5, M: 30.49, Y: 0, K: 0 }, false);
  assert.equal(decimal[1].output, 30.49);
});
test("모드 변경은 과거 제작 / 2차 / 검증 결과를 보존하고 새 버전을 요구", () => {
  const p = measured();
  const v = finish(p, calculateVersion(p));
  const snapshot = structuredClone(v),
    results = structuredClone(comparison(v, "C"));
  p.settings.integer = false;
  assert.equal(versionCurrent(p, v), false);
  assert.ok(calculatorReason(p, v));
  assert.deepEqual(v, snapshot);
  assert.deepEqual(comparison(v, "C"), results);
  const next = calculateVersion(p);
  assert.equal(next.number, 2);
  assert.deepEqual(next.second, {});
  assert.equal(next.settings.integer, false);
});
test("1차 데이터 수정은 버전 스냅샷을 바꾸지 않음", () => {
  const p = measured();
  const v = finish(p, calculateVersion(p));
  const source = structuredClone(v.source);
  p.first["C:10"].L = 90;
  assert.equal(versionCurrent(p, v), false);
  assert.deepEqual(v.source, source);
});
test("검증 계조 오차 개선 확인", () => {
  const p = measured(false);
  const v = finish(p, calculateVersion(p));
  const rows = comparison(v, "C");
  assert.ok(rows[5].after < rows[5].before);
  assert.equal(rows[5].status, "개선");
});
test("JSON 전체 왕복 / 충돌 없는 복원 / 미완성 초안", () => {
  const p = measured();
  finish(p, calculateVersion(p));
  p.first["M:5"] = { L: "", a: "-2", b: "3" };
  const restored = parseBackup(backupText(p));
  assert.notEqual(restored.id, p.id);
  assert.deepEqual(restored.first, p.first);
  assert.deepEqual(restored.versions, p.versions);
  assert.ok(restored.meta.name.includes("복원"));
});
test("손상된 / 악성 / 다른 버전 백업 거부", () => {
  const p = measured();
  const v = finish(p, calculateVersion(p));
  for (const mutate of [
    (p) => (p.schemaVersion = 99),
    (p) => (p.versions[0].tables.C[2].internal = -1),
    (p) => (p.versions[0].tables.C[2].production = 99),
    (p) => (p.versions[0].source["C:0"].L = 50),
    (p) => (p.versions[0].second["C:20"].actual = ""),
    (p) => (p.settings.channels = []),
  ]) {
    const bad = structuredClone(p);
    mutate(bad);
    assert.throws(() => parseBackup(backupText(bad)));
  }
  assert.throws(() => parseBackup('{"__proto__":{}}'));
  assert.throws(() => parseBackup("{}"));
});
test("CSV 정밀도 보존 / 정수 제작값 / 특수문자 / 수식 방지", () => {
  const text = csv([
    ["내부", "제작"],
    [37.5345678, 38],
    ['a,"b', "\nline"],
    ["=1+1", -2],
  ]);
  assert.ok(text.includes("37.5345678"));
  assert.ok(text.includes('"38"'));
  assert.ok(text.includes('"a,""b"'));
  assert.ok(text.includes("'=1+1"));
  assert.ok(text.includes('"-2"'));
});
