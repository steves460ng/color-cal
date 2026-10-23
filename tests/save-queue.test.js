import test from "node:test";
import assert from "node:assert/strict";
import { createSaveQueue } from "../js/storage/save-queue.js";
test("빠른 연속 저장은 원본 스냅샷과 순서를 보존하고 저장 리비전을 이어감", async () => {
  const writes = [],
    states = [];
  const queue = createSaveQueue(
    async (p, revision) => {
      writes.push([p.value, revision]);
      return revision + 1;
    },
    { onState: (s) => states.push(s) },
  );
  const p = { id: "A", storageRevision: 7, value: 1 };
  const first = queue.save(p);
  p.value = 2;
  const second = queue.save(p);
  p.value = 3;
  assert.deepEqual(await Promise.all([first, second]), [8, 9]);
  assert.deepEqual(writes, [
    [1, 7],
    [2, 8],
  ]);
  assert.deepEqual(states.at(-1), { pending: 0, failedProjects: [] });
});
test("다른 프로젝트 저장 성공이 실패한 프로젝트를 저장완료로 표시하지 않음", async () => {
  let fail = true,
    state;
  const queue = createSaveQueue(
    async (p, r) => {
      if (p.id === "A" && fail) throw Error("quota");
      return r + 1;
    },
    { onState: (s) => (state = s) },
  );
  await assert.rejects(queue.save({ id: "A" }));
  await queue.save({ id: "B" });
  assert.deepEqual(state.failedProjects, ["A"]);
  fail = false;
  await queue.save({ id: "A" });
  assert.deepEqual(state.failedProjects, []);
});
test("충돌/실패한 저장은 마지막 성공 리비전을 올리지 않음", async () => {
  const versions = [];
  let fail = true;
  const queue = createSaveQueue(async (p, r) => {
    versions.push(r);
    if (fail) throw Error("conflict");
    return r + 1;
  });
  await assert.rejects(queue.save({ id: "A", storageRevision: 2 }));
  fail = false;
  await queue.save({ id: "A", storageRevision: 99 });
  assert.deepEqual(versions, [2, 2]);
});
