/** Serialize snapshots, retain per-project failure state and compare persisted revisions. */
export function createSaveQueue(
  write,
  { onState = () => {}, onError = () => {} } = {},
) {
  let tail = Promise.resolve(),
    pending = 0;
  const failed = new Set(),
    revisions = new Map();
  const notify = () => onState({ pending, failedProjects: [...failed] });
  return {
    save(project) {
      const snapshot = structuredClone(project);
      if (!revisions.has(snapshot.id))
        revisions.set(snapshot.id, snapshot.storageRevision || 0);
      pending++;
      notify();
      const task = tail.then(() => write(snapshot, revisions.get(snapshot.id)));
      tail = task.then(
        (revision) => {
          revisions.set(snapshot.id, revision);
          failed.delete(snapshot.id);
          pending--;
          notify();
        },
        (error) => {
          failed.add(snapshot.id);
          pending--;
          notify();
          onError(error, snapshot.id);
        },
      );
      return task;
    },
    idle() {
      return tail;
    },
    forget(id) {
      failed.delete(id);
      revisions.delete(id);
      notify();
    },
  };
}
