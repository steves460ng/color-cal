/** Pure domain rules. Internal floats never receive display rounding. */
export const CHANNELS = ["C", "M", "Y", "K"];
export const ALGORITHM = "paper-deltaE76-isotonic-linear-v1";
export const DEFAULT_SETTINGS = {
  channels: [...CHANNELS],
  step: 5,
  integer: true,
  precision: 2,
};
export const META = {
  name: "프로젝트 이름",
  printer: "인쇄장비 이름 및 모델",
  paper: "용지 종류",
  ink: "잉크 종류",
  resolution: "출력 해상도",
  rip: "RIP / 드라이버 설정",
  instrument: "측색계 모델",
  condition: "측색 조건",
  notes: "작업 메모",
};
export function numeric(v) {
  return (
    (typeof v === "number" || (typeof v === "string" && v.trim() !== "")) &&
    Number.isFinite(Number(v))
  );
}
export function clamp(v) {
  return Math.min(100, Math.max(0, v));
}
export function production(v, settings) {
  return clamp(
    settings.integer ? Math.round(v) : Number(v.toFixed(settings.precision)),
  );
}
export function validateSettings(s) {
  if (
    !s ||
    !Array.isArray(s.channels) ||
    !s.channels.length ||
    new Set(s.channels).size !== s.channels.length ||
    s.channels.some((c) => !CHANNELS.includes(c))
  )
    throw Error("채널을 하나 이상 선택하세요.");
  if (
    !numeric(s.step) ||
    s.step < 0.1 ||
    s.step > 100 ||
    (s.integer && !Number.isInteger(s.step))
  )
    throw Error("증분은 0.1~100%이며 정수값 모드에서는 정수여야 합니다.");
  if (
    typeof s.integer !== "boolean" ||
    !Number.isInteger(s.precision) ||
    s.precision < 0 ||
    s.precision > 4
  )
    throw Error("표시 정밀도는 0~4자리여야 합니다.");
}
export function targets(s) {
  validateSettings(s);
  const values = [];
  for (let i = 0; i * s.step < 100 - 1e-8; i++)
    values.push(Number((i * s.step).toFixed(8)));
  values.push(100);
  return values;
}
export const key = (c, t) => `${c}:${t}`;
export const patchId = (c, t, phase = 1, version = 0) =>
  `${c}-${phase === 1 ? "P1" : `V${version}-P2`}-${String(t).replace(".", "_")}`;
export function labValid(lab) {
  return (
    !!lab &&
    ["L", "a", "b"].every((k) => numeric(lab[k])) &&
    Number(lab.L) >= 0 &&
    Number(lab.L) <= 100
  );
}
export function actualValid(v, s) {
  return (
    numeric(v) &&
    Number(v) >= 0 &&
    Number(v) <= 100 &&
    (!s.integer || Number.isInteger(Number(v)))
  );
}
export function deltaE(a, b) {
  return Math.hypot(
    Number(a.L) - Number(b.L),
    Number(a.a) - Number(b.a),
    Number(a.b) - Number(b.b),
  );
}
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
// Pool adjacent violators: least-squares nondecreasing fit, without mutating raw observations.
export function isotonic(values) {
  const blocks = [];
  values.forEach((v, i) => {
    blocks.push({ sum: v, count: 1, start: i, end: i });
    while (
      blocks.length > 1 &&
      blocks.at(-2).sum / blocks.at(-2).count >
        blocks.at(-1).sum / blocks.at(-1).count
    ) {
      const b = blocks.pop(),
        a = blocks.pop();
      blocks.push({
        sum: a.sum + b.sum,
        count: a.count + b.count,
        start: a.start,
        end: b.end,
      });
    }
  });
  const out = [];
  blocks.forEach((b) => {
    for (let i = b.start; i <= b.end; i++) out[i] = b.sum / b.count;
  });
  return out;
}
export function interpolate(points, x, xKey = "target", yKey = "internal") {
  if (!numeric(x) || !points.length)
    throw Error("보간 입력 또는 테이블이 유효하지 않습니다.");
  if (x <= points[0][xKey]) return points[0][yKey];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i];
    if (x <= b[xKey])
      return (
        a[yKey] + ((b[yKey] - a[yKey]) * (x - a[xKey])) / (b[xKey] - a[xKey])
      );
  }
  return points.at(-1)[yKey];
}
export function inverse(xs, ys, target) {
  if (target === 0) return 0;
  if (target === 100) return 100;
  const equal = ys
    .map((y, i) => (Math.abs(y - target) < 1e-10 ? i : -1))
    .filter((i) => i >= 0);
  if (equal.length) return (xs[equal[0]] + xs[equal.at(-1)]) / 2;
  for (let i = 1; i < ys.length; i++)
    if (ys[i] > target)
      return (
        xs[i - 1] +
        ((xs[i] - xs[i - 1]) * (target - ys[i - 1])) / (ys[i] - ys[i - 1])
      );
  throw Error("역보간 범위를 벗어났습니다.");
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
  const ts = targets(p.settings),
    tables = {},
    warnings = [],
    source = {};
  channels.forEach((c) => {
    const labs = ts.map((t) => structuredClone(p.first[key(c, t)]));
    const end = deltaE(labs[0], labs.at(-1));
    if (end < 0.01)
      throw Error(
        `${c}: 종이색과 100% 색의 차이가 너무 작아 보정할 수 없습니다.`,
      );
    const raw = labs.map((l) => (100 * deltaE(labs[0], l)) / end);
    if (
      raw.some((v, i) => i && v < raw[i - 1] - 1e-8) ||
      raw.some((v) => v > 100 + 1e-8)
    )
      warnings.push(
        `${c}: 비단조 또는 끝점 초과 측정 곡선을 단조 회귀로 정리했습니다. 재측정을 권장합니다.`,
      );
    const fitted = isotonic(raw.map(clamp));
    tables[c] = ts.map((t) => {
      const internal = inverse(ts, fitted, t);
      return {
        target: t,
        internal,
        production: production(internal, p.settings),
      };
    });
    ts.forEach((t, i) => {
      source[key(c, t)] = labs[i];
    });
  });
  const number = Math.max(0, ...p.versions.map((v) => v.number)) + 1;
  const version = {
    id: crypto.randomUUID(),
    number,
    algorithm: ALGORITHM,
    createdAt: new Date().toISOString(),
    settings: structuredClone(p.settings),
    channels: [...channels],
    source,
    signature: sourceSignature(p, channels),
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
  return !!v && v.signature === sourceSignature(p, v.channels);
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
export function confirmVersion(p, v) {
  if (!versionCurrent(p, v))
    throw Error(
      "설정 또는 1차 측정값이 달라졌습니다. 새 보정 버전을 만드세요.",
    );
  if (!secondComplete(v))
    throw Error("모든 2차 Lab값과 실제 제작 입력값을 확인하세요.");
  v.confirmedAt = new Date().toISOString();
  record(p, `보정 V${v.number} 확정`);
}
export function calculatorReason(p, v) {
  if (!v) return "보정 테이블을 먼저 생성하세요.";
  if (!versionCurrent(p, v))
    return "현재 설정 또는 1차 측정값과 버전이 다릅니다. 새 보정 버전으로 제작·측정하세요.";
  if (!secondComplete(v)) return "선택 버전의 2차 측정을 모두 완료하세요.";
  if (!v.confirmedAt) return "최종 결과에서 보정 테이블을 확정하세요.";
  return "";
}
export function convert(p, v, input, integer = p.settings.integer) {
  const reason = calculatorReason(p, v);
  if (reason) throw Error(reason);
  const settings = { ...p.settings, integer };
  return CHANNELS.map((c) => {
    const value = input[c];
    if (!actualValid(value, settings))
      throw Error(`${c}: ${integer ? "정수 " : ""}0~100%를 입력하세요.`);
    const internal = v.tables[c]
      ? interpolate(v.tables[c], Number(value))
      : Number(value);
    return {
      channel: c,
      input: Number(value),
      internal,
      output: production(internal, settings),
      applied: !!v.tables[c],
    };
  });
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
    const after =
      labValid(second) && actualValid(second.actual, v.settings)
        ? Math.abs((deltaE(paper, second) / range) * 100 - r.target)
        : null;
    return {
      ...r,
      first,
      second,
      before,
      after,
      deltaE:
        labValid(second) && actualValid(second.actual, v.settings)
          ? deltaE(ideal, second)
          : null,
      status:
        after === null
          ? "미측정"
          : after < before - 0.01
            ? "개선"
            : after > before + 0.01
              ? "악화"
              : "동등",
    };
  });
}

/** Prepare the selected channels once; revisiting preserves existing second-pass work. */
export function prepareSecondPass(p) {
  const missing = p.settings.channels.filter((c) => !firstComplete(p, c));
  if (missing.length)
    throw Error(`${missing.join(" · ")} 채널의 1차 측정을 완료하세요.`);
  const existing = [...p.versions]
    .reverse()
    .find(
      (v) =>
        v.channels.length === p.settings.channels.length &&
        p.settings.channels.every((c) => v.channels.includes(c)) &&
        versionCurrent(p, v),
    );
  const version = existing || calculateVersion(p);
  p.location.versionId = version.id;
  if (!version.channels.includes(p.location.channel))
    p.location.channel = version.channels[0];
  return { version, created: !existing };
}
