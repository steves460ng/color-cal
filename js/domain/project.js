import { CHANNELS, targets, key, numeric } from "./values.js";
export const CONDITION_FIELDS = [
  "printer",
  "paper",
  "ink",
  "resolution",
  "rip",
  "instrument",
  "condition",
];
export function captureConditions(meta = {}) {
  return Object.fromEntries(
    CONDITION_FIELDS.map((k) => [k, String(meta[k] ?? "").trim()]),
  );
}
export function updateProjectMetadata(project, meta) {
  if (
    JSON.stringify(captureConditions(project.meta)) !==
    JSON.stringify(captureConditions(meta))
  ) {
    project.conditionsRevision = (project.conditionsRevision || 0) + 1;
  }
  project.meta = { ...meta };
}
export function sourceFingerprint(project, channels) {
  const s = project.settings;
  const ordered = CHANNELS.filter((c) => channels.includes(c));
  return JSON.stringify({
    settings: [
      CHANNELS.filter((c) => s.channels.includes(c)),
      s.step,
      s.integer,
      s.precision,
    ],
    first: ordered.map((c) =>
      targets(s).map((t) =>
        ["L", "a", "b"].map((f) => {
          const value = project.first[key(c, t)]?.[f];
          return numeric(value) ? Number(value) : ["invalid", value ?? null];
        }),
      ),
    ),
  });
}

export function sourceSignatureValid(version) {
  try {
    const encoded = JSON.parse(version.signature),
      ts = targets(encoded.settings);
    if (
      !Array.isArray(encoded.first) ||
      encoded.first.length !== version.channels.length
    )
      return false;
    const source = {};
    for (let i = 0; i < version.channels.length; i++) {
      if (
        !Array.isArray(encoded.first[i]) ||
        encoded.first[i].length !== ts.length
      )
        return false;
      ts.forEach((t, j) => {
        source[key(version.channels[i], t)] = encoded.first[i][j];
      });
    }
    return (
      sourceFingerprint(
        { settings: encoded.settings, first: source },
        version.channels,
      ) ===
      sourceFingerprint(
        { settings: version.settings, first: version.source },
        version.channels,
      )
    );
  } catch {
    return false;
  }
}
