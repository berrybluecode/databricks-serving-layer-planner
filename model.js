(function (root) {
  "use strict";

  const DEFAULTS = Object.freeze({
    workload: "genie-api",
    averageUsers: 10,
    peakUsers: 50,
    sessionMinutes: 10,
    adoptionRate: 50,
    peaksPerDay: 2,
    peakWidthHours: 3,
    scenario: "Standard",
    scenarioSeconds: { Fast: 45, Standard: 90, Slow: 150 },
    weekendPercent: 20,
    targetNoQueue: 99.99,
    reservationQpm: 10,
    queryRuntimeSeconds: 30,
  });

  const BUCKET_MINUTES = 15;
  const BUCKETS_PER_DAY = (24 * 60) / BUCKET_MINUTES;
  const WEEKDAYS = 20;
  const WEEKEND_DAYS = 8;

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, Number(value)));
  }

  function normalPdf(x, mean, sigma) {
    const z = (x - mean) / sigma;
    return Math.exp(-0.5 * z * z) / (sigma * Math.sqrt(2 * Math.PI));
  }

  function peakCenters(count) {
    const n = clamp(Math.round(count), 1, 3);
    return Array.from({ length: n }, (_, i) => (i + 0.5) / n);
  }

  function demandAtReservation(weekday, weekend, reservationQpm) {
    const cap = Math.max(0, reservationQpm);
    let totalQueries = 0;
    let queuedQueries = 0;
    let weightedBucketsAbove = 0;
    let servedQueries = 0;

    weekday.forEach((value, index) => {
      const weekendValue = weekend[index];
      totalQueries += (value * WEEKDAYS + weekendValue * WEEKEND_DAYS) * BUCKET_MINUTES;
      queuedQueries +=
        (Math.max(0, value - cap) * WEEKDAYS +
          Math.max(0, weekendValue - cap) * WEEKEND_DAYS) *
        BUCKET_MINUTES;
      weightedBucketsAbove +=
        (value > cap ? WEEKDAYS : 0) + (weekendValue > cap ? WEEKEND_DAYS : 0);
      servedQueries +=
        (Math.min(value, cap) * WEEKDAYS + Math.min(weekendValue, cap) * WEEKEND_DAYS) *
        BUCKET_MINUTES;
    });

    if (cap === 0) {
      return {
        queuedPercent: totalQueries > 0 ? 100 : 0,
        timeAbovePercent: totalQueries > 0 ? 100 : 0,
        utilizationPercent: 0,
      };
    }

    return {
      queuedPercent: totalQueries ? (queuedQueries / totalQueries) * 100 : 0,
      timeAbovePercent:
        (weightedBucketsAbove / (BUCKETS_PER_DAY * (WEEKDAYS + WEEKEND_DAYS))) * 100,
      utilizationPercent:
        (servedQueries /
          (cap * BUCKET_MINUTES * BUCKETS_PER_DAY * (WEEKDAYS + WEEKEND_DAYS))) *
        100,
    };
  }

  function simulate(raw = {}) {
    const input = {
      ...DEFAULTS,
      ...raw,
      scenarioSeconds: { ...DEFAULTS.scenarioSeconds, ...(raw.scenarioSeconds || {}) },
    };

    input.averageUsers = clamp(input.averageUsers, 0, 1_000_000);
    input.peakUsers = clamp(input.peakUsers, 0, 1_000_000);
    input.sessionMinutes = clamp(input.sessionMinutes, 0, 1_440);
    input.adoptionRate = clamp(input.adoptionRate, 0, 100);
    input.peaksPerDay = clamp(Math.round(input.peaksPerDay), 1, 3);
    input.peakWidthHours = clamp(input.peakWidthHours, 0.25, 12);
    input.weekendPercent = clamp(input.weekendPercent, 0, 200);
    input.targetNoQueue = clamp(input.targetNoQueue, 0, 100);
    input.reservationQpm = clamp(input.reservationQpm, 0, 10_000);
    input.queryRuntimeSeconds = clamp(input.queryRuntimeSeconds, 0.1, 86_400);

    const selectedSeconds = clamp(
      input.scenarioSeconds[input.scenario] || DEFAULTS.scenarioSeconds.Standard,
      1,
      3_600
    );
    const adoption = input.adoptionRate / 100;
    const averageConcurrent =
      (input.averageUsers * input.sessionMinutes * adoption) / 60;
    const peakConcurrent = (input.peakUsers * input.sessionMinutes * adoption) / 60;
    const averageQpm = (averageConcurrent * 60) / selectedSeconds;
    const peakQpm = (peakConcurrent * 60) / selectedSeconds;

    const centers = peakCenters(input.peaksPerDay);
    const sigma = input.peakWidthHours / 24;
    const shape = Array.from({ length: BUCKETS_PER_DAY }, (_, index) => {
      const timeFraction = index / BUCKETS_PER_DAY;
      return centers.reduce((sum, center) => sum + normalPdf(timeFraction, center, sigma), 0);
    });
    const shapeAverage = shape.reduce((sum, value) => sum + value, 0) / shape.length;
    const shapeMax = Math.max(...shape);
    const denominator = shapeMax - shapeAverage;
    const scale = denominator > 0 ? (peakQpm - averageQpm) / denominator : 0;
    const offset = peakQpm - scale * shapeMax;

    const weekday = shape.map((value) => Math.max(0, scale * value + offset));
    const weekend = weekday.map((value) => value * (input.weekendPercent / 100));
    const times = Array.from({ length: BUCKETS_PER_DAY }, (_, index) => {
      const minutes = index * BUCKET_MINUTES;
      return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(
        minutes % 60
      ).padStart(2, "0")}`;
    });

    const metrics = demandAtReservation(weekday, weekend, input.reservationQpm);
    const weekdayQueries = weekday.reduce((sum, value) => sum + value, 0) * BUCKET_MINUTES;
    const weekendQueries = weekend.reduce((sum, value) => sum + value, 0) * BUCKET_MINUTES;
    const monthlyInteractions = weekdayQueries * WEEKDAYS + weekendQueries * WEEKEND_DAYS;
    const peakConcurrentQueries = (peakQpm * input.queryRuntimeSeconds) / 60;
    const targetQueued = Math.max(0, 100 - input.targetNoQueue);
    let recommendedQpm = 0;
    const searchCeiling = Math.max(peakQpm * 1.25, 1);
    for (let cap = 0; cap <= searchCeiling + 0.001; cap += 0.1) {
      if (demandAtReservation(weekday, weekend, cap).queuedPercent <= targetQueued + 1e-9) {
        recommendedQpm = Math.ceil(cap * 10) / 10;
        break;
      }
    }

    const tradeoffMax = Math.max(
      10,
      Math.ceil(peakQpm * 2),
      Math.ceil(input.reservationQpm * 1.5)
    );
    const tradeoff = Array.from({ length: 81 }, (_, index) => {
      const reservation = (tradeoffMax * index) / 80;
      return { reservation, ...demandAtReservation(weekday, weekend, reservation) };
    });

    return {
      input,
      selectedSeconds,
      averageConcurrent,
      peakConcurrent,
      averageQpm,
      peakQpm,
      times,
      weekday,
      weekend,
      metrics,
      weekdayQueries,
      weekendQueries,
      monthlyInteractions,
      peakConcurrentQueries,
      recommendedQpm,
      targetQueuedPercent: targetQueued,
      tradeoff,
      tradeoffMax,
    };
  }

  root.FinOpsModel = {
    DEFAULTS,
    BUCKET_MINUTES,
    simulate,
    demandAtReservation,
  };
})(typeof window === "undefined" ? globalThis : window);
