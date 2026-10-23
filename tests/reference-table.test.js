import test from "node:test";
import assert from "node:assert/strict";
import {
  createProject,
  targets,
  key,
  calculateVersion,
  confirmVersion,
  convert,
} from "../js/core.js";
import {
  referenceTable,
  referencePrintPages,
} from "../js/domain/reference-table.js";
function fixture(integer = true) {
  const p = createProject();
  p.settings = { channels: ["C", "K"], step: 10, integer, precision: 2 };
  for (const c of p.settings.channels)
    for (const t of targets(p.settings))
      p.first[key(c, t)] = { L: 100 - (0.8 * t * t) / 100, a: 0, b: 0 };
  const v = calculateVersion(p);
  for (const c of v.channels)
    for (const r of v.tables[c])
      v.second[key(c, r.target)] = {
        actual: r.production,
        L: 100 - 0.8 * r.target,
        a: 0,
        b: 0,
      };
  confirmVersion(p, v);
  return { p, v };
}
test("조견표는 계산기와 같은 보간·반올림을 사용하고 미보정 채널은 통과", () => {
  for (const integer of [true, false]) {
    const { p, v } = fixture(integer);
    const original = structuredClone(p);
    for (const row of referenceTable(v, integer ? 1 : 2.5)) {
      const expected = convert(p, v, {
        C: row.target,
        M: row.target,
        Y: row.target,
        K: row.target,
      });
      assert.deepEqual(row.channels, expected);
    }
    assert.deepEqual(p, original);
  }
});
test("분해능별 행 수와 끝점 및 사용자 지정 마지막 간격", () => {
  const { v } = fixture();
  for (const [step, count] of [
    [1, 101],
    [2, 51],
    [5, 21],
    [10, 11],
    [7, 16],
    [100, 2],
  ]) {
    const rows = referenceTable(v, step);
    assert.equal(rows.length, count);
    assert.equal(rows[0].target, 0);
    assert.equal(rows.at(-1).target, 100);
    assert.equal(new Set(rows.map((r) => r.target)).size, count);
  }
  assert.throws(() => referenceTable(v, 0.5));
  assert.throws(() => referenceTable(v, 0));
});
test("인쇄용 분할이 모든 목표를 순서대로 한 번씩 보존", () => {
  const { v } = fixture(false);
  for (const step of [1, 5, 0.1]) {
    const rows = referenceTable(v, step),
      pages = referencePrintPages(rows);
    assert.deepEqual(pages.flat(2), rows);
    assert.ok(
      pages.every((p) => p.length <= 3 && p.every((c) => c.length <= 34)),
    );
  }
  assert.equal(referencePrintPages(referenceTable(v, 1)).length, 1);
});
test("변조된 보정 테이블은 인쇄 조견표로 만들 수 없음", () => {
  const { v } = fixture();
  v.tables.C[5].internal = 0;
  assert.throws(() => referenceTable(v, 5));
});
