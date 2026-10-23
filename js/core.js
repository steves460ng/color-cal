import {
  CHANNELS,
  ALGORITHM,
  META,
  DEFAULT_SETTINGS,
  targets,
  key,
  labValid,
  actualValid,
  deltaE,
} from "./domain/values.js";
import {
  deriveCalibration,
  interpolate,
  calibrationTablesValid,
  productionForVersion,
  convertChannels,
} from "./domain/calibration.js";
import { captureConditions, sourceFingerprint } from "./domain/project.js";
export * from "./domain/values.js";
export {
  isotonic,
  interpolate,
  inverse,
  deriveCalibration,
  calibrationTablesValid,
  productionForVersion,
  convertChannels,
} from "./domain/calibration.js";
export { captureConditions, updateProjectMetadata } from "./domain/project.js";

export function createProject(name = "새 캘리브레이션") {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    schemaVersion: 1,
    meta: Object.fromEntries(
      Object.keys(META).map((k) => [k, k === "name" ? name : ""]),
    ),
    settings: structuredClone(DEFAULT_SETTINGS),
    first: {},
    versions: [],
    history: [{ at: now, action: "프로젝트 생성" }],
    createdAt: now,
    updatedAt: now,
    location: { route: "projects", channel: "C", versionId: null, cell: null },
  };
}
export function record(p, action) {
  p.history.push({ at: new Date().toISOString(), action });
}
export function firstComplete(p, channel) {
  return targets(p.settings).every((t) => labValid(p.first[key(channel, t)]));
}
export function sourceSignature(p, channels) {
  return JSON.stringify({
    settings: p.settings,
    first: channels.map((c) =>
      targets(p.settings).map((t) => p.first[key(c, t)] ?? null),
    ),
  });
}
export function calculateVersion(p, channels = p.settings.channels) {
  if (
    !channels.length ||
    channels.some(
      (c) => !p.settings.channels.includes(c) || !firstComplete(p, c),
    )
  )
    throw Error("계산할 채널의 모든 1차 Lab값을 먼저 입력하세요.");
  const { tables, warnings } = deriveCalibration(p.first, channels, p.settings);
  const source = {};
  channels.forEach((c) =>
    targets(p.settings).forEach((t) => {
      source[key(c, t)] = structuredClone(p.first[key(c, t)]);
    }),
  );
  const number = Math.max(0, ...p.versions.map((v) => v.number)) + 1;
  const version = {
    id: crypto.randomUUID(),
    number,
    algorithm: ALGORITHM,
    rounding: "decimal-half-up-v1",
    createdAt: new Date().toISOString(),
    settings: structuredClone(p.settings),
    channels: [...channels],
    source,
    signature: sourceSignature(p, channels),
    conditions: captureConditions(p.meta),
    conditionsRevision: p.conditionsRevision || 0,
    tables,
    second: {},
    warnings,
    confirmedAt: null,
  };
  p.versions.push(version);
  record(p, `보정 V${number} 생성 (${channels.join(", ")})`);
  return version;
}
export function versionCurrent(p, v) {
  if (!v || v.algorithm !== ALGORITHM) return false;
  try {
    return (
      sourceFingerprint(p, v.channels) ===
        sourceFingerprint(
          { settings: v.settings, first: v.source },
          v.channels,
        ) &&
      (v.conditions
        ? JSON.stringify(captureConditions(p.meta)) ===
          JSON.stringify(captureConditions(v.conditions))
        : (p.conditionsRevision || 0) === (v.conditionsRevision || 0))
    );
  } catch {
    return false;
  }
}
export function secondComplete(v) {
  return (
    !!v &&
    v.channels.every((c) =>
      v.tables[c].every((r) => {
        const m = v.second[key(c, r.target)];
        return labValid(m) && actualValid(m.actual, v.settings);
      }),
    )
  );
}
export function confirmationReason(p, v) {
  if (!v) return "보정 테이블을 먼저 생성하세요.";
  if (!calibrationTablesValid(v))
    return "보정 테이블이 원본 측정값과 일치하지 않습니다. 새 버전으로 제작·측정하세요.";
  if (!versionCurrent(p, v))
    return "현재 출력 조건·설정 또는 1차 측정값과 버전이 다릅니다. 새 보정 버전으로 제작·측정하세요.";
  if (!secondComplete(v))
    return "선택 버전의 2차 Lab값과 실제 제작값을 모두 입력하세요.";
  if (
    v.channels.some((c) =>
      comparison(v, c).some((r) => r.after === null || r.deltaE === null),
    )
  )
    return "2차 Lab값이 계산 가능한 범위를 벗어났습니다. 측정값을 확인하세요.";
  const mismatched = v.channels.filter((c) =>
    v.tables[c].some(
      (r) =>
        Math.abs(Number(v.second[key(c, r.target)].actual) - r.production) >
        1e-8,
    ),
  );
  if (mismatched.length)
    return `${mismatched.join(" · ")} 채널의 실제 제작값이 보정 테이블과 다릅니다. 테이블의 제작값으로 패치를 제작·재측정한 뒤 확정하세요.`;
  return "";
}
export function confirmVersion(p, v) {
  const reason = confirmationReason(p, v);
  if (reason) throw Error(reason);
  if (v.confirmedAt) return;
  v.confirmedAt = new Date().toISOString();
  record(p, `보정 V${v.number} 확정`);
}
export function calculatorReason(p, v) {
  return (
    confirmationReason(p, v) ||
    (!v.confirmedAt ? "최종 결과에서 보정 테이블을 확정하세요." : "")
  );
}
export function convert(p, v, input, integer = p.settings.integer) {
  const reason = calculatorReason(p, v);
  if (reason) throw Error(reason);
  const settings = { ...p.settings, integer };
  return convertChannels(v, input, settings);
}
export function comparison(v, c) {
  const ts = v.tables[c];
  const paper = v.source[key(c, 0)],
    solid = v.source[key(c, 100)],
    range = deltaE(paper, solid);
  return ts.map((r) => {
    const first = v.source[key(c, r.target)],
      second = v.second[key(c, r.target)];
    const ideal = Object.fromEntries(
      ["L", "a", "b"].map((k) => [
        k,
        Number(paper[k]) +
          ((Number(solid[k]) - Number(paper[k])) * r.target) / 100,
      ]),
    );
    const before = Math.abs((deltaE(paper, first) / range) * 100 - r.target);
    const measured = labValid(second) && actualValid(second.actual, v.settings);
    const rawAfter = measured
      ? Math.abs((deltaE(paper, second) / range) * 100 - r.target)
      : NaN;
    const rawDeltaE = measured ? deltaE(ideal, second) : NaN;
    const after =
      Number.isFinite(rawAfter) && Number.isFinite(rawDeltaE) ? rawAfter : null;
    return {
      ...r,
      first,
      second,
      before,
      after,
      deltaE: Number.isFinite(rawDeltaE) ? rawDeltaE : null,
      status:
        after === null
          ? measured
            ? "계산 범위 오류"
            : "미측정"
          : after < before - 0.01
            ? "개선"
            : after > before + 0.01
              ? "악화"
              : "동등",
    };
  });
}

export function reusableVersion(p) {
  return [...p.versions]
    .reverse()
    .find(
      (v) =>
        v.channels.length === p.settings.channels.length &&
        p.settings.channels.every((c) => v.channels.includes(c)) &&
        versionCurrent(p, v) &&
        calibrationTablesValid(v) &&
        (!v.confirmedAt || !confirmationReason(p, v)),
    );
}

/** Prepare the selected channels once; revisiting preserves existing second-pass work. */
export function prepareSecondPass(p) {
  const missing = p.settings.channels.filter((c) => !firstComplete(p, c));
  if (missing.length)
    throw Error(`${missing.join(" · ")} 채널의 1차 측정을 완료하세요.`);
  const existing = reusableVersion(p);
  const version = existing || calculateVersion(p);
  p.location.versionId = version.id;
  if (!version.channels.includes(p.location.channel))
    p.location.channel = version.channels[0];
  return { version, created: !existing };
}
