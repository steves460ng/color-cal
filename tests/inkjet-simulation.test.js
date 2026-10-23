import test from "node:test";
import assert from "node:assert/strict";
import { CHANNELS } from "../js/core.js";
import {
  paperLab,
  inkjetChannels,
  measureInkjet,
  physicalCoverage,
  labToXYZ,
  xyzToLab,
} from "./helpers/inkjet-model.js";
import { inkjetExperiment } from "./helpers/inkjet-experiment.js";

test("D50 Lab/XYZ conversion round-trips paper and all solid endpoints", () => {
  for (const lab of [
    paperLab,
    ...Object.values(inkjetChannels).map((c) => c.solid),
  ])
    xyzToLab(labToXYZ(lab)).forEach((v, i) =>
      assert.ok(Math.abs(v - lab[i]) < 1e-10),
    );
});
test("Inkjet coverage grows through midtones; endpoints and monotonicity survive gain variants", () => {
  for (const gainScale of [0.75, 1, 1.15])
    for (const c of CHANNELS) {
      let previous = -1;
      for (let x = 0; x <= 100; x++) {
        const t = physicalCoverage(c, x, gainScale);
        assert.ok(t >= 0 && t <= 1 && t > previous);
        if (x > 0 && x < 100) assert.ok(t > x / 100);
        previous = t;
        const lab = measureInkjet(c, x, { gainScale });
        assert.ok(
          lab.L >= 0 &&
            lab.L <= 100 &&
            Number.isFinite(lab.a) &&
            Number.isFinite(lab.b),
        );
      }
      assert.equal(physicalCoverage(c, 0), 0);
      assert.equal(physicalCoverage(c, 100), 1);
    }
});
for (const integer of [true, false])
  for (const step of [1, 2, 5, 10])
    test(`Independent inkjet remeasurement improves all channels: integer=${integer}, step=${step}`, () => {
      const run = inkjetExperiment({ integer, step });
      for (const s of run.summary) {
        assert.ok(s.labToneAt50 > 50);
        assert.ok(s.midpointInternal < 50);
        assert.ok(s.afterMAE < s.beforeMAE / 5);
        assert.ok(s.afterMax < 2.5);
      }
      for (const rows of Object.values(run.version.tables))
        for (const r of rows) {
          assert.ok(r.internal >= 0 && r.internal <= 100);
          if (r.target >= 10 && r.target <= 90)
            assert.ok(r.internal < r.target);
          if (integer) assert.ok(Number.isInteger(r.production));
        }
    });
