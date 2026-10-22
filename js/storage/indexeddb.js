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
export const putProject = (p) => transaction("readwrite", (s) => s.put(p));
export const deleteProject = (id) =>
  transaction("readwrite", (s) => s.delete(id));
