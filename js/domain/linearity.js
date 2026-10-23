import { targets, key, labValid, deltaE } from "./values.js";
import { deriveCalibration } from "./calibration.js";

// Review thresholds, not instrument accuracy limits or automatic pass criteria.
export const REVIEW_LIMITS = {
  flatChange: 0.1,
  reversalChange: 0.1,
  abruptSlope: 3,
  overshoot: 0.1,
};
export function analyzeChannel(source, settings, channel, savedTable = null) {
  const ts = targets(settings);
  const points = ts.map((target) => ({
    target,
    lab: source[key(channel, target)] ?? null,
    tone: null,
    error: null,
    internal: null,
    production: null,
  }));
  const completed = points.filter((p) => labValid(p.lab)).length;
  const result = {
    channel,
    points,
    completed,
    total: ts.length,
    meanError: null,
    maxError: null,
    anomalies: [],
    reviewIntervals: 0,
    duplicateGroups: [],
    duplicateExtras: 0,
    error: null,
    ready: false,
  };
  const paper = points[0].lab,
    solid = points.at(-1).lab;
  if (!labValid(paper) || !labValid(solid)) {
    result.error =
      "0%와 100% 패치의 Lab를 입력해야 선형도를 진단할 수 있습니다.";
    return result;
  }
  const range = deltaE(paper, solid);
  if (!Number.isFinite(range) || range < 0.01) {
    result.error =
      "종이색과 100% 색의 차이가 너무 작거나 계산 범위를 벗어났습니다.";
    return result;
  }
  for (const p of points) {
    if (!labValid(p.lab)) continue;
    const tone = 100 * (deltaE(paper, p.lab) / range);
    if (!Number.isFinite(tone)) {
      result.error = "측정값이 계산 가능한 범위를 벗어났습니다.";
      return result;
    }
    p.tone = tone;
    p.error = tone - p.target;
  }
  if (completed < ts.length) {
    result.error = `${ts.length - completed}개 패치가 미입력 또는 유효하지 않습니다.`;
    return result;
  }
  result.meanError = points.reduce(
    (sum, p) => sum + Math.abs(p.error) / points.length,
    0,
  );
  result.maxError = Math.max(...points.map((p) => Math.abs(p.error)));
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i],
      change = b.tone - a.tone,
      slope = change / (b.target - a.target);
    const add = (type) =>
      result.anomalies.push({
        type,
        from: a.target,
        to: b.target,
        change,
        slope,
      });
    if (change < -REVIEW_LIMITS.reversalChange) add("계조 역전");
    else if (Math.abs(change) <= REVIEW_LIMITS.flatChange) add("평탄 구간");
    if (slope > REVIEW_LIMITS.abruptSlope) add("급격한 변화");
    if (b.tone > 100 + REVIEW_LIMITS.overshoot) add("최대 농도 초과");
  }
  result.reviewIntervals = new Set(
    result.anomalies.map((a) => `${a.from}:${a.to}`),
  ).size;
  try {
    const table =
      savedTable ??
      deriveCalibration(source, [channel], settings).tables[channel];
    if (table.length !== points.length)
      throw Error("보정 테이블의 패치 수가 다릅니다.");
    const groups = new Map();
    table.forEach((row, i) => {
      if (row.target !== points[i].target)
        throw Error("보정 테이블의 목표 계조가 다릅니다.");
      points[i].internal = row.internal;
      points[i].production = row.production;
      const group = groups.get(row.production) ?? [];
      group.push(row.target);
      groups.set(row.production, group);
    });
    result.duplicateGroups = [...groups]
      .filter(([, values]) => values.length > 1)
      .map(([production, targets]) => ({ production, targets }));
    result.duplicateExtras = result.duplicateGroups.reduce(
      (sum, g) => sum + g.targets.length - 1,
      0,
    );
    result.ready = true;
  } catch (error) {
    result.error = error.message;
  }
  return result;
}
export function firstPassReport(project, version = null) {
  const channels = project.settings.channels.map((c) =>
    analyzeChannel(project.first, project.settings, c, version?.tables[c]),
  );
  return {
    channels,
    canProceed: channels.every((c) => c.ready),
    totalPatches: channels.reduce((s, c) => s + c.total, 0),
    completed: channels.reduce((s, c) => s + c.completed, 0),
    versionNumber: version?.number ?? null,
    hasSecondData: !!version && Object.values(version.second).some(labValid),
  };
}
