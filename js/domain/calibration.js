import {
  numeric,
  CHANNELS,
  actualValid,
  clamp,
  production,
  targets,
  key,
  labValid,
  deltaE,
} from "./values.js";
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

export function deriveCalibration(source, channels, settings) {
  const ts = targets(settings),
    tables = {},
    warnings = [];
  if (
    !Array.isArray(channels) ||
    !channels.length ||
    new Set(channels).size !== channels.length ||
    channels.some((c) => !settings.channels.includes(c))
  )
    throw Error("보정 채널이 유효하지 않습니다.");
  for (const c of channels) {
    const labs = ts.map((t) => source[key(c, t)]);
    if (!labs.every(labValid))
      throw Error(`${c}: 모든 1차 Lab값을 입력하세요.`);
    const end = deltaE(labs[0], labs.at(-1));
    if (!Number.isFinite(end) || end < 0.01)
      throw Error(
        `${c}: 종이색과 100% 색의 차이가 너무 작거나 계산 범위를 벗어났습니다.`,
      );
    const raw = labs.map((l) => 100 * (deltaE(labs[0], l) / end));
    if (!raw.every(Number.isFinite))
      throw Error(`${c}: Lab 측정값이 계산 가능한 범위를 벗어났습니다.`);
    if (
      raw.some((v, i) => i && v < raw[i - 1] - 1e-8) ||
      raw.some((v) => v > 100 + 1e-8)
    )
      warnings.push(
        `${c}: 비단조 또는 끝점 초과 측정 곡선을 단조 회귀로 정리했습니다. 재측정을 권장합니다.`,
      );
    const fitted = isotonic(raw.map(clamp));
    tables[c] = ts.map((target) => {
      const internal = inverse(ts, fitted, target);
      if (!Number.isFinite(internal))
        throw Error(`${c}: 보정값을 계산할 수 없습니다.`);
      return { target, internal, production: production(internal, settings) };
    });
  }
  return { tables, warnings };
}

export function calibrationTablesValid(version) {
  try {
    const expected = deriveCalibration(
      version.source,
      version.channels,
      version.settings,
    ).tables;
    if (Object.keys(version.tables).length !== version.channels.length)
      return false;
    return version.channels.every(
      (c) =>
        Array.isArray(version.tables[c]) &&
        version.tables[c].length === expected[c].length &&
        version.tables[c].every(
          (r, i) =>
            r.target === expected[c][i].target &&
            Number.isFinite(r.internal) &&
            r.internal >= 0 &&
            r.internal <= 100 &&
            Math.abs(r.internal - expected[c][i].internal) <= 1e-10 &&
            r.production === productionForVersion(version, r.internal),
        ),
    );
  } catch {
    return false;
  }
}

/** Historical fabrication tables retain the rounding rule used when created. */
export function productionForVersion(
  version,
  value,
  settings = version.settings,
) {
  if (version.rounding === "decimal-half-up-v1")
    return production(value, settings);
  if (version.rounding !== undefined)
    throw Error("지원하지 않는 반올림 버전입니다.");
  if (!Number.isFinite(value)) throw Error("보정값은 유한한 숫자여야 합니다.");
  return clamp(
    settings.integer
      ? Math.round(value)
      : Number(value.toFixed(settings.precision)),
  );
}

/** Shared arithmetic for the interactive calculator and printable lookup sheet. */
export function convertChannels(version, input, settings = version.settings) {
  return CHANNELS.map((channel) => {
    const value = input[channel];
    if (!actualValid(value, settings))
      throw Error(
        `${channel}: ${settings.integer ? "정수 " : ""}0–100%를 입력하세요.`,
      );
    const internal = version.tables[channel]
      ? interpolate(version.tables[channel], Number(value))
      : Number(value);
    return {
      channel,
      input: Number(value),
      internal,
      output: productionForVersion(version, internal, settings),
      applied: !!version.tables[channel],
    };
  });
}
