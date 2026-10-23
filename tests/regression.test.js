import test from "node:test";
import assert from "node:assert/strict";
import {
  createProject,
  targets,
  key,
  calculateVersion,
  versionCurrent,
  prepareSecondPass,
  confirmVersion,
  convert,
  production,
  comparison,
} from "../js/core.js";
import { backupText, parseBackup } from "../js/storage/backup.js";
function measured() {
  const p = createProject();
  p.settings = { channels: ["C"], step: 10, integer: false, precision: 2 };
  for (const t of targets(p.settings))
    p.first[key("C", t)] = { L: 100 - t * 0.8, a: 0, b: 0 };
  return p;
}
function confirmed(p) {
  const v = calculateVersion(p);
  for (const r of v.tables.C)
    v.second[key("C", r.target)] = {
      actual: r.production,
      L: 100 - r.target * 0.8,
      a: 0,
      b: 0,
    };
  confirmVersion(p, v);
  return v;
}
test("소수 제작값의 정확한 절반 반올림", () => {
  const s = { integer: false, precision: 2 };
  assert.equal(production(1.005, s), 1.01);
  assert.equal(production(2.675, s), 2.68);
});
test("같은 숫자 재입력과 Lab 키 순서 변경으로 보정 버전이 달라지지 않음", () => {
  const p = measured(),
    v = confirmed(p);
  p.first["C:50"] = { b: "0.00", L: "60.0", a: "0" };
  assert.equal(versionCurrent(p, v), true);
  assert.equal(prepareSecondPass(p).created, false);
  assert.equal(p.versions.length, 1);
});
test("출력 조건 변경 시 기존 보정을 새 용지에 적용하지 않음", () => {
  const p = measured();
  p.meta.paper = "용지 A";
  const v = confirmed(p);
  p.meta.paper = "용지 B";
  assert.equal(versionCurrent(p, v), false);
  assert.throws(() => convert(p, v, { C: 50, M: 0, Y: 0, K: 0 }));
  assert.equal(prepareSecondPass(p).created, true);
});
test("프로젝트 이름과 메모 변경은 같은 출력 조건의 보정을 무효화하지 않음", () => {
  const p = measured(),
    v = confirmed(p);
  p.meta.name = "이름 변경";
  p.meta.notes = "메모 추가";
  assert.equal(versionCurrent(p, v), true);
});
test("범위와 단조성을 만족해도 원본과 다른 보정 테이블은 복원 거부", () => {
  const p = measured(),
    v = confirmed(p);
  v.tables.C[5].internal = 51;
  v.tables.C[5].production = 51;
  assert.throws(() => parseBackup(backupText(p)), /보정/);
});
test("계산 가능한 숫자를 벗어나는 Lab 차이는 보정 생성 전 거부", () => {
  const p = measured();
  p.settings.step = 100;
  p.first["C:0"].a = -1e308;
  p.first["C:100"].a = 1e308;
  assert.throws(() => calculateVersion(p));
  assert.equal(p.versions.length, 0);
});
test("2차 실제 제작값이 누락되거나 범위를 벗어나면 비교 결과를 내지 않음", () => {
  const p = measured(),
    v = calculateVersion(p);
  v.second["C:50"] = { L: 60, a: 0, b: 0, actual: 101 };
  const r = comparison(v, "C")[5];
  assert.equal(r.after, null);
  assert.equal(r.deltaE, null);
  assert.equal(r.status, "미측정");
});
test("소수/정수 미보정 통과와 임의 목표 보간을 독립 수식으로 검증", () => {
  const p = measured(),
    v = confirmed(p);
  for (const x of [0, 0.01, 1.005, 7.25, 23.5, 50, 99.99, 100]) {
    const r = convert(p, v, { C: x, M: x, Y: x, K: x }, false);
    for (const channel of r)
      assert.equal(channel.output, production(x, p.settings));
  }
});

test("1차 제작 및 실제 기록값은 소수 표시 정밀도로 다시 반올림하지 않음", async () => {
  const { formatInput } = await import("../js/ui/formatters.js");
  assert.equal(formatInput(2.5, { integer: false, precision: 0 }, true), "2.5");
  assert.equal(
    formatInput(37.535, { integer: false, precision: 2 }, true),
    "37.535",
  );
  assert.equal(
    formatInput(1e-21, { integer: false, precision: 2 }, true),
    "1e-21",
  );
});
test("과거 조건 스냅샷 없는 버전도 이후 출력 조건 편집 시 무효화", async () => {
  const { updateProjectMetadata } = await import("../js/core.js");
  const p = measured(),
    v = confirmed(p);
  delete v.conditions;
  delete v.conditionsRevision;
  assert.equal(versionCurrent(p, v), true);
  updateProjectMetadata(p, { ...p.meta, paper: "새 용지" });
  assert.equal(versionCurrent(p, v), false);
});
test("과거 버전 제작값은 보존하고 새 버전에만 수정된 반올림 적용", async () => {
  const { productionForVersion } = await import("../js/core.js");
  assert.equal(
    productionForVersion({ settings: { integer: false, precision: 2 } }, 1.005),
    1,
  );
  assert.equal(
    productionForVersion(
      {
        rounding: "decimal-half-up-v1",
        settings: { integer: false, precision: 2 },
      },
      1.005,
    ),
    1.01,
  );
});

test("다른 실제 제작값으로 측정한 결과를 원래 보정 테이블의 검증 완료로 확정하지 않음", () => {
  const p = measured(),
    v = confirmed(p);
  v.confirmedAt = null;
  v.second["C:50"].actual = 55;
  assert.throws(() => confirmVersion(p, v), /제작/);
  assert.throws(() => convert(p, v, { C: 50, M: 0, Y: 0, K: 0 }));
});

test("JSON 객체 키 순서만 바뀐 유효 백업은 동일한 계산값으로 복원", () => {
  const p = measured();
  confirmed(p);
  const sorted = (v) =>
    Array.isArray(v)
      ? v.map(sorted)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((k) => [k, sorted(v[k])]),
          )
        : v;
  const restored = parseBackup(
    JSON.stringify(sorted(JSON.parse(backupText(p)))),
  );
  assert.equal(
    convert(restored, restored.versions[0], { C: 50, M: 0, Y: 0, K: 0 })[0]
      .output,
    50,
  );
});
test("2차 숫자 입력이 유한해도 오차 계산이 무한대면 확정을 거부", () => {
  const p = measured(),
    v = confirmed(p);
  v.confirmedAt = null;
  v.second["C:50"].a = 1.7e308;
  v.second["C:50"].b = 1.7e308;
  assert.equal(comparison(v, "C")[5].status, "계산 범위 오류");
  assert.throws(() => confirmVersion(p, v), /범위/);
});
test("서버/브라우저 로컬 저장 리비전은 복원 프로젝트로 복사하지 않음", () => {
  const p = measured();
  p.storageRevision = 500;
  const restored = parseBackup(backupText(p));
  assert.equal(restored.storageRevision, undefined);
});
test("분해능과 무관한 선형 모델은 임의 지점에서도 항등 보정", () => {
  for (const step of [1, 2, 5, 7, 10, 33]) {
    const p = measured();
    p.settings.step = step;
    p.first = {};
    for (const t of targets(p.settings))
      p.first[key("C", t)] = { L: 100 - 0.8 * t, a: 0.3 * t, b: -0.2 * t };
    const v = calculateVersion(p);
    for (const r of v.tables.C) {
      assert.ok(Math.abs(r.internal - r.target) < 1e-10);
      v.second[key("C", r.target)] = {
        actual: r.production,
        ...p.first[key("C", r.target)],
      };
    }
    confirmVersion(p, v);
    for (const x of [0.01, 1.005, 23.25, 57.3, 99.99]) {
      const output = convert(p, v, { C: x, M: 0, Y: 0, K: 0 })[0];
      assert.ok(Math.abs(output.internal - x) < 1e-10);
    }
  }
});

test("이전 반올림으로 제작·측정한 JSON은 재계산으로 덮어쓰지 않고 복원", () => {
  const p = measured();
  for (const t of targets(p.settings)) {
    const tone =
      t === 0
        ? 0
        : t === 100
          ? 100
          : 100 / 1.005 + ((100 - 100 / 1.005) * (t - 10)) / 90;
    p.first[key("C", t)] = { L: 100 - 0.8 * tone, a: 0, b: 0 };
  }
  const v = calculateVersion(p);
  delete v.rounding;
  v.tables.C[1].internal = 1.005;
  for (const r of v.tables.C) {
    r.production = Number(r.internal.toFixed(2));
    v.second[key("C", r.target)] = {
      actual: r.production,
      L: 100 - 0.8 * r.target,
      a: 0,
      b: 0,
    };
  }
  confirmVersion(p, v);
  const restored = parseBackup(backupText(p));
  assert.equal(restored.versions[0].tables.C[1].production, 1);
  assert.deepEqual(restored.versions[0].tables, v.tables);
});

test("검증 조건을 만족하지 않는 과거 확정 버전은 2차 준비에서 다시 사용하지 않음", () => {
  const p = measured(),
    v = confirmed(p);
  v.second["C:50"].actual = 55;
  const next = prepareSecondPass(p);
  assert.equal(next.created, true);
  assert.notEqual(next.version.id, v.id);
  assert.equal(v.second["C:50"].actual, 55);
});
