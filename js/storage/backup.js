import {
  CHANNELS,
  META,
  ALGORITHM,
  validateSettings,
  targets,
  key,
  production,
  sourceSignature,
  labValid,
  actualValid,
  secondComplete,
} from "../core.js";
const object = (v) => !!v && typeof v === "object" && !Array.isArray(v);
function assert(ok, message) {
  if (!ok) throw Error(`잘못된 백업: ${message}`);
}
const validCell = (v) =>
  v === "" ||
  v === null ||
  (typeof v === "string" && v.length <= 100) ||
  (typeof v === "number" && Number.isFinite(v));
function validateMeasurements(map, second = false) {
  assert(object(map) && Object.keys(map).length <= 20000, "측정 데이터 형식");
  for (const [k, row] of Object.entries(map)) {
    assert(
      /^[CMYK]:(?:\d+(?:\.\d+)?)$/.test(k) && Number(k.slice(2)) <= 100,
      "측정 키",
    );
    assert(
      object(row) &&
        ["L", "a", "b", ...(second ? ["actual"] : [])].every(
          (k) => row[k] === undefined || validCell(row[k]),
        ),
      "측정 셀",
    );
    assert(
      Object.keys(row).every((k) =>
        ["L", "a", "b", ...(second ? ["actual"] : [])].includes(k),
      ),
      "허용하지 않는 측정 필드",
    );
  }
}
export function validateProject(p) {
  assert(
    object(p) &&
      p.schemaVersion === 1 &&
      typeof p.id === "string" &&
      p.id.length < 100,
    "프로젝트 버전 / ID",
  );
  assert(
    object(p.meta) &&
      Object.keys(META).every(
        (k) => typeof p.meta[k] === "string" && p.meta[k].length <= 20000,
      ) &&
      p.meta.name.trim(),
    "프로젝트 정보",
  );
  validateSettings(p.settings);
  validateMeasurements(p.first);
  assert(
    Array.isArray(p.versions) && p.versions.length <= 1000,
    "보정 버전 목록",
  );
  const ids = new Set(),
    numbers = new Set();
  for (const v of p.versions) {
    assert(
      object(v) &&
        typeof v.id === "string" &&
        !ids.has(v.id) &&
        Number.isInteger(v.number) &&
        v.number > 0 &&
        !numbers.has(v.number),
      "보정 버전 ID / 번호",
    );
    ids.add(v.id);
    numbers.add(v.number);
    validateSettings(v.settings);
    assert(
      v.algorithm === ALGORITHM &&
        Array.isArray(v.channels) &&
        v.channels.length > 0 &&
        new Set(v.channels).size === v.channels.length &&
        v.channels.every(
          (c) => CHANNELS.includes(c) && v.settings.channels.includes(c),
        ),
      "보정 방식 / 채널",
    );
    assert(
      object(v.tables) && Object.keys(v.tables).length === v.channels.length,
      "테이블 채널",
    );
    validateMeasurements(v.source);
    validateMeasurements(v.second, true);
    const ts = targets(v.settings);
    assert(
      Object.keys(v.source).length === ts.length * v.channels.length,
      "1차 스냅샷 크기",
    );
    v.channels.forEach((c) => {
      assert(
        Array.isArray(v.tables[c]) && v.tables[c].length === ts.length,
        "테이블 길이",
      );
      v.tables[c].forEach((r, i) => {
        assert(
          object(r) &&
            r.target === ts[i] &&
            Number.isFinite(r.internal) &&
            r.internal >= 0 &&
            r.internal <= 100 &&
            r.production === production(r.internal, v.settings) &&
            (!i || r.internal >= v.tables[c][i - 1].internal),
          "보정값",
        );
        assert(labValid(v.source[key(c, r.target)]), "1차 스냅샷");
      });
      assert(
        v.tables[c][0].internal === 0 && v.tables[c].at(-1).internal === 100,
        "테이블 끝점",
      );
    });
    assert(
      Object.keys(v.second).every(
        (k) => v.channels.includes(k[0]) && ts.includes(Number(k.slice(2))),
      ),
      "2차 패치 키",
    );
    assert(
      v.signature ===
        sourceSignature({ settings: v.settings, first: v.source }, v.channels),
      "원본 서명",
    );
    assert(
      Array.isArray(v.warnings) &&
        v.warnings.every((w) => typeof w === "string"),
      "경고",
    );
    assert(
      v.confirmedAt === null ||
        (typeof v.confirmedAt === "string" &&
          Number.isFinite(Date.parse(v.confirmedAt)) &&
          secondComplete(v)),
      "확정 상태",
    );
    assert(
      typeof v.createdAt === "string" &&
        Number.isFinite(Date.parse(v.createdAt)),
      "버전 날짜",
    );
  }
  assert(
    Array.isArray(p.history) &&
      p.history.length <= 100000 &&
      p.history.every(
        (h) =>
          object(h) && typeof h.at === "string" && typeof h.action === "string",
      ),
    "이력",
  );
  assert(
    typeof p.createdAt === "string" &&
      Number.isFinite(Date.parse(p.createdAt)) &&
      typeof p.updatedAt === "string" &&
      Number.isFinite(Date.parse(p.updatedAt)),
    "프로젝트 날짜",
  );
  assert(
    object(p.location) &&
      typeof p.location.route === "string" &&
      typeof p.location.channel === "string" &&
      (p.location.cell === null || typeof p.location.cell === "string") &&
      (p.location.versionId === null ||
        typeof p.location.versionId === "string"),
    "작업 위치",
  );
  return p;
}
export function backupText(p) {
  return JSON.stringify(
    {
      format: "color-cal-backup",
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      project: p,
    },
    null,
    2,
  );
}
export function parseBackup(text) {
  if (text.length > 30 * 1024 * 1024)
    throw Error("백업은 30MB 이하여야 합니다.");
  const data = JSON.parse(text, (k, v) => {
    if (["__proto__", "prototype", "constructor"].includes(k))
      throw Error("허용하지 않는 백업 키");
    return v;
  });
  assert(
    data.format === "color-cal-backup" && data.schemaVersion === 1,
    "백업 형식",
  );
  const p = validateProject(data.project);
  p.id = crypto.randomUUID();
  p.meta.name += " (복원)";
  p.history.push({
    at: new Date().toISOString(),
    action: "JSON 백업에서 별도 프로젝트로 복원",
  });
  return p;
}
export function csv(rows) {
  const escape = (v) => {
    let text = v == null ? "" : String(v);
    if (/^[=+@\-\t\r]/.test(text) && !(typeof v === "number"))
      text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  return "\uFEFF" + rows.map((row) => row.map(escape).join(",")).join("\r\n");
}
export function download(text, name, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
