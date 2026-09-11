// Both views use the same discrete multiples of real time: 1x is one second per second.
export const simulationRates = Object.freeze([
  500, 1_000, 5_000, 20_000, 100_000,
]);
export const defaultSimulationRate = 1_000;
export const defaultSimulationDate = Date.UTC(1971,7,1,17);

export function simulationElapsed(elapsedMilliseconds, rate) {
  return elapsedMilliseconds * rate;
}

export function restoreSimulationRate(saved) {
  // Legacy rates used three days per second at 1x; never read them as real-time units.
  return saved?.speedUnit === 'realtime' && simulationRates.includes(saved.speed)
    ? saved.speed : defaultSimulationRate;
}

export function restoreSimulationDate(saved) {
  // Start existing pre-epoch sessions at the new historical origin once.
  return saved?.timelineEpoch === defaultSimulationDate && Number.isFinite(saved.date)
    && saved.date > 0 && saved.date < 8e13 ? saved.date : defaultSimulationDate;
}

export function formatSimulationRate(rate) {
  for (const [divisor, suffix] of [[1e9, 'b'], [1e6, 'm'], [1e3, 'k']]) {
    if (rate >= divisor) return `${rate / divisor}${suffix}×`;
  }
  return `${rate}×`;
}

export function simulationRateEquivalent(rate) {
  const [divisor, unit] = rate < 60 ? [1, '秒'] : rate < 3600 ? [60, '分钟']
    : rate < 86400 ? [3600, '小时'] : [86400, '天'];
  return `现实 1 秒 = 模拟 ${Number((rate / divisor).toFixed(2))} ${unit}`;
}
