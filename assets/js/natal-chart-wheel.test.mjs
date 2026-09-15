import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function loadWheelDebug() {
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('assets/js/natal-chart-wheel.js', 'utf8'), context);
  return context.window.NatalWheel._debug;
}

function normalizeDegrees(value) {
  return ((value % 360) + 360) % 360;
}

function longitudeFromChartAngle(angle, ascendant) {
  return normalizeDegrees(ascendant + 270 - angle);
}

function unwrapAngleNear(debug, angle, reference) {
  return reference + debug.signedAngleDelta(angle, reference);
}

test('planet label collision resolver separates collapsed degree/sign stacks', () => {
  const debug = loadWheelDebug();
  const ascendant = 100;
  const markerAngle = 180;
  const collapsedAngle = markerAngle + debug.PLANET_MARKER_SAFE_DEG;
  const markers = [{ key: 'IC', longitude: longitudeFromChartAngle(markerAngle, ascendant) }];
  const planets = [
    { key: 'Sun', longitude: longitudeFromChartAngle(markerAngle - 1.5, ascendant), labelLongitude: longitudeFromChartAngle(collapsedAngle, ascendant) },
    { key: 'Mars', longitude: longitudeFromChartAngle(markerAngle - 0.5, ascendant), labelLongitude: longitudeFromChartAngle(collapsedAngle, ascendant) },
    { key: 'Saturn', longitude: longitudeFromChartAngle(markerAngle + 0.5, ascendant), labelLongitude: longitudeFromChartAngle(collapsedAngle, ascendant) }
  ];

  const resolved = debug.resolvePlanetLabelCollisions(planets, ascendant, markers);
  const angles = resolved.map((planet) => debug.planetLabelAngle(planet, ascendant));
  const componentStacks = resolved.map((planet, index) => {
    const laneOffset = Number.isFinite(planet.labelLaneOffset) ? planet.labelLaneOffset : 0;
    assert.equal(
      laneOffset,
      0,
      `planet ${index} should stay on the shared radius; laneOffset=${laneOffset}`
    );
    assert.ok(
      Math.abs(planet.labelDisplacement || 0) <= debug.LABEL_MAX_ANGLE_SHIFT_DEG + 0.05,
      `planet ${index} should stay close to exact degree; displacement=${planet.labelDisplacement}`
    );
    return debug.labelComponents(angles[index], laneOffset);
  });

  for (let i = 0; i < angles.length; i += 1) {
    assert.ok(
      (resolved[i].labelAxisPenalty || 0) <= 0.001,
      `planet ${i} should clear radial chart lines; penalty=${resolved[i].labelAxisPenalty}`
    );
    for (let j = i + 1; j < angles.length; j += 1) {
      const overlap = debug.componentOverlapAmount(componentStacks[i], componentStacks[j]);
      assert.ok(
        overlap <= 0.001,
        `planet ${i}/${j} stacks should not overlap; overlap=${overlap}`
      );
    }
  }
});

test('planet label order repair preserves crowded cluster longitude order', () => {
  const debug = loadWheelDebug();
  const ascendant = 100;
  const exactAngles = [110, 114, 118];
  const reversedLabelAngles = [118, 114, 110];
  const planets = exactAngles.map((angle, index) => ({
    key: ['Sun', 'Mercury', 'Venus'][index],
    longitude: longitudeFromChartAngle(angle, ascendant),
    labelLongitude: longitudeFromChartAngle(reversedLabelAngles[index], ascendant),
    labelLaneOffset: 0,
    labelDisplacement: Math.abs(reversedLabelAngles[index] - angle)
  }));

  const repaired = debug.preserveClusterLabelOrder(planets, ascendant);
  const labelAngles = repaired.map((planet, index) => {
    const angle = debug.planetLabelAngle(planet, ascendant);
    assert.equal(
      planet.labelLaneOffset || 0,
      0,
      `planet ${index} should keep the shared radius`
    );
    assert.ok(
      Math.abs(planet.labelDisplacement || 0) <= debug.LABEL_MAX_ANGLE_SHIFT_DEG + 0.05,
      `planet ${index} should stay close to exact degree; displacement=${planet.labelDisplacement}`
    );
    return unwrapAngleNear(debug, angle, exactAngles[index]);
  });

  for (let i = 1; i < labelAngles.length; i += 1) {
    assert.ok(
      labelAngles[i] >= labelAngles[i - 1],
      `label order should match longitude order: ${labelAngles.join(', ')}`
    );
  }
});
