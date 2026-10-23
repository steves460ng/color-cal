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
  if (!Number.isFinite(v)) throw Error("보정값은 유한한 숫자여야 합니다.");
  const value = clamp(v);
  if (settings.integer) return Math.round(value);
  const shift = (number, places) => {
    const [coefficient, exponent = "0"] = String(number).split("e");
    return Number(`${coefficient}e${Number(exponent) + places}`);
  };
  return clamp(
    shift(Math.round(shift(value, settings.precision)), -settings.precision),
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
    !Number.isFinite(s.step) ||
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
