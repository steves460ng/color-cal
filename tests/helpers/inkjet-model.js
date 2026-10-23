/** Unmeasured, illustrative inkjet model. Never use as a device profile.
 * D50 Lab endpoints → XYZ-domain Yule–Nielsen approximation → D50 Lab.
 * XYZ mixing is a tristimulus approximation, not a spectral ink/paper fit.
 * This file deliberately has no dependency on the calibration implementation.
 */
export const paperLab = [96, 0.4, -1];
export const inkjetChannels = {
  C: { solid: [55, -35, -45], gain: 0.17, skew: -0.1, hue: [0.5, -0.3] },
  M: { solid: [48, 65, -12], gain: 0.19, skew: 0.05, hue: [0.4, 0.6] },
  Y: { solid: [88, -7, 85], gain: 0.15, skew: -0.08, hue: [-0.3, 0.5] },
  K: { solid: [18, 0, 1], gain: 0.21, skew: -0.12, hue: [0.2, -0.2] },
};
export const opticalExponent = 2.2;
const whiteD50 = [0.96422, 1, 0.82521],
  delta = 6 / 29;
export function labToXYZ([L, a, b]) {
  const y = (L + 16) / 116;
  return [y + a / 500, y, y - b / 200].map(
    (v, i) =>
      whiteD50[i] * (v > delta ? v ** 3 : 3 * delta ** 2 * (v - 4 / 29)),
  );
}
export function xyzToLab(xyz) {
  const [x, y, z] = xyz
    .map((v, i) => v / whiteD50[i])
    .map((v) =>
      v > delta ** 3 ? Math.cbrt(v) : v / (3 * delta ** 2) + 4 / 29,
    );
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
export function physicalCoverage(channel, input, gainScale = 1) {
  const { gain, skew } = inkjetChannels[channel],
    x = input / 100;
  return x + 4 * gain * gainScale * x * (1 - x) * (1 + skew * (2 * x - 1));
}
export function measureInkjet(
  channel,
  input,
  { pass = 1, gainScale = 1, noise = true } = {},
) {
  if (
    !(channel in inkjetChannels) ||
    !Number.isFinite(input) ||
    input < 0 ||
    input > 100
  )
    throw Error("Invalid simulated channel/input");
  const x = input / 100,
    ink = inkjetChannels[channel];
  // Small repeat-run drift, independent of the requested target/calibration table.
  const area =
    physicalCoverage(channel, input, gainScale) +
    (pass === 2 ? 0.002 * Math.sin(Math.PI * x) : 0);
  const paper = labToXYZ(paperLab),
    solid = labToXYZ(ink.solid),
    n = opticalExponent;
  const lab = xyzToLab(
    paper.map(
      (v, i) => ((1 - area) * v ** (1 / n) + area * solid[i] ** (1 / n)) ** n,
    ),
  );
  lab[1] += ink.hue[0] * Math.sin(Math.PI * area);
  lab[2] += ink.hue[1] * Math.sin(Math.PI * area);
  return Object.fromEntries(
    ["L", "a", "b"].map((f, i) => {
      // Repeatable sub-0.1 Lab perturbation; distinct for each patch/pass/axis/channel.
      const jitter = noise
        ? 0.09 *
          Math.sin(
            input * 2.731 + pass * 11.17 + i * 5.31 + channel.charCodeAt(0),
          )
        : 0;
      return [f, Number((lab[i] + jitter).toFixed(8))];
    }),
  );
}
