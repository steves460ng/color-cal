let db;
export async function openDB() {
  if (db) return db;
  db = await new Promise((resolve, reject) => {
    const request = indexedDB.open("color-cal", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("projects", { keyPath: "id" });
    request.onsuccess = () => {
      request.result.onversionchange = () => {
        request.result.close();
        db = null;
      };
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(Error("다른 탭을 닫고 다시 시도하세요."));
  });
  return db;
}
async function transaction(mode, operation) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("projects", mode);
    let result;
    const request = operation(tx.objectStore("projects"));
    request.onsuccess = () => {
      result = request.result;
    };
    tx.oncomplete = () => resolve(result);
    tx.onerror = tx.onabort = () =>
      reject(tx.error || Error("저장 트랜잭션 실패"));
  });
}
export const listProjects = () => transaction("readonly", (s) => s.getAll());
async function mutateProject(id, expectedRevision, change) {
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction("projects", "readwrite"),
      store = tx.objectStore("projects");
    let failure, result;
    const request = store.get(id);
    request.onsuccess = () => {
      try {
        if (
          expectedRevision !== undefined &&
          (request.result?.storageRevision || 0) !== expectedRevision
        ) {
          throw Error(
            "다른 탭에서 이 프로젝트를 변경했습니다. 현재 입력을 JSON 백업한 뒤 새로고침하세요.",
          );
        }
        result = change(store);
      } catch (error) {
        failure = error;
        tx.abort();
      }
    };
    tx.oncomplete = () => resolve(result);
    tx.onerror = tx.onabort = () =>
      reject(failure || tx.error || Error("저장 트랜잭션 실패"));
  });
}
export function putProject(p, expectedRevision = p.storageRevision || 0) {
  return mutateProject(p.id, expectedRevision, (store) => {
    const revision = expectedRevision + 1;
    store.put({ ...p, storageRevision: revision });
    return revision;
  });
}
export function deleteProject(id, expectedRevision) {
  return mutateProject(id, expectedRevision, (store) => {
    store.delete(id);
  });
}
