
/*
 * ENCS4380 - Homework 2
 * PID Control Toolkit - Group 35
 *
 * Shared PID Simulation Engine
 *
 * P1: PID Playground
 * P2: Slow Sensor in the Feedback Loop
 *
 * First-order and Second-order plants
 * Numerical integration: RK4
 * PID: P + I + filtered D
 * Conditional anti-windup
 */

// ========================================
// 1. PID SIMULATION ENGINE
// ========================================

function simulatePID(options = {}) {
  const {
    plantType = "first",
    K = 1,
    tau = 1,
    zeta = 0.5,
    wn = 2,
    Kp = 9,
    Ki = 0,
    Kd = 0,
    setpoint = 1,
    duration = 15,
    dt = 0.001,
    uMin = -100,
    uMax = 100,
    sensorTau = 0,
    antiWindup = true,
    derivativeFilterTau = 0.02
  } = options;

  // Validate simulation parameters
  const numbers = [
    K, tau, zeta, wn, Kp, Ki, Kd,
    setpoint, duration, dt,
    uMin, uMax, sensorTau,
    derivativeFilterTau
  ];

  if (
    numbers.some(v => !Number.isFinite(v)) ||
    !["first", "second"].includes(plantType) ||
    K <= 0 ||
    tau <= 0 ||
    zeta < 0 ||
    wn <= 0 ||
    dt <= 0 ||
    duration <= 0 ||
    sensorTau < 0 ||
    derivativeFilterTau <= 0 ||
    uMin >= uMax
  ) {
    throw new Error("Invalid simulation parameters.");
  }

  // Plant states
  let y = 0;
  let velocity = 0;

  // Sensor and controller states
  let measuredY = 0;
  let previousMeasuredY = 0;
  let filteredDerivative = 0;
  let integral = 0;

  // Simulation results
  const result = {
    time: [],
    output: [],
    measured: [],
    setpoint: [],
    control: []
  };

  const steps = Math.ceil(duration / dt);
  const h = duration / steps;

  /*
   * FIRST-ORDER PLANT
   *
   * tau*y' + y = K*u
   *
   * SECOND-ORDER PLANT
   *
   * y'' + 2*zeta*wn*y' + wn^2*y
   *     = K*wn^2*u
   *
   * FEEDBACK SENSOR
   *
   * sensorTau*ym' + ym = y
   */

  // ========================================
  // 2. PLANT AND SENSOR DERIVATIVES
  // ========================================

  function derivatives(state, u) {
    const [position, speed, sensor] = state;

    let dy;
    let dv = 0;

    if (plantType === "first") {
      dy = (K * u - position) / tau;
    } else {
      dy = speed;

      dv =
        wn * wn * (K * u - position) -
        2 * zeta * wn * speed;
    }

    const ds = sensorTau > 0
      ? (position - sensor) / sensorTau
      : 0;

    return [dy, dv, ds];
  }

  // ========================================
  // 3. FOURTH-ORDER RUNGE-KUTTA
  // ========================================

  function advanceRK4(u) {
    const state = [y, velocity, measuredY];

    const add = (a, b, factor) =>
      a.map((v, i) => v + factor * b[i]);

    const k1 = derivatives(state, u);

    const k2 = derivatives(
      add(state, k1, h / 2),
      u
    );

    const k3 = derivatives(
      add(state, k2, h / 2),
      u
    );

    const k4 = derivatives(
      add(state, k3, h),
      u
    );

    const next = state.map((v, i) =>
      v + h / 6 * (
        k1[i] +
        2 * k2[i] +
        2 * k3[i] +
        k4[i]
      )
    );

    y = next[0];
    velocity = next[1];

    if (sensorTau > 0) {
      measuredY = next[2];
    } else {
      measuredY = y;
    }
  }

  // ========================================
  // 4. CLOSED-LOOP SIMULATION
  // ========================================

  for (let i = 0; i <= steps; i++) {
    const t = i * h;

    // Feedback error
    const error = setpoint - measuredY;

    // Derivative on measured output
    const rawDerivative = i === 0
      ? 0
      : -(measuredY - previousMeasuredY) / h;

    // First-order derivative filter
    const alpha =
      1 - Math.exp(-h / derivativeFilterTau);

    filteredDerivative +=
      alpha * (
        rawDerivative - filteredDerivative
      );

    // Candidate integral update
    const proposedIntegral =
      integral + error * h;

    let rawU =
      Kp * error +
      Ki * proposedIntegral +
      Kd * filteredDerivative;

    // Conditional anti-windup
    const highSaturation =
      rawU > uMax && error > 0;

    const lowSaturation =
      rawU < uMin && error < 0;

    if (
      !antiWindup ||
      (!highSaturation && !lowSaturation)
    ) {
      integral = proposedIntegral;
    }

    rawU =
      Kp * error +
      Ki * integral +
      Kd * filteredDerivative;

    // Actuator saturation
    const u = Math.max(
      uMin,
      Math.min(uMax, rawU)
    );

    // Save time history
    result.time.push(t);
    result.output.push(y);
    result.measured.push(measuredY);
    result.setpoint.push(setpoint);
    result.control.push(u);

    previousMeasuredY = measuredY;

    if (i === steps) {
      break;
    }

    // Numerical integration
    advanceRK4(u);

    // Numerical stability check
    if (
      !Number.isFinite(y) ||
      !Number.isFinite(velocity) ||
      !Number.isFinite(measuredY) ||
      Math.abs(y) > 1e8 ||
      Math.abs(velocity) > 1e8
    ) {
      throw new Error(
        "Simulation became unstable. " +
        "Try lower gains or a smaller time step."
      );
    }
  }

  return result;
}


// ========================================
// 5. PERFORMANCE METRICS
// ========================================

/*
 * Rise time:
 * 10%-90% of estimated final response.
 *
 * Overshoot:
 * Relative to the estimated final response.
 *
 * Settling time:
 * Time after which output stays inside
 * +/-2% of the setpoint.
 *
 * Steady-state error:
 * Reported only if the response appears
 * approximately stationary near the end
 * of the simulation.
 *
 * The stationarity test is numerical and
 * does not prove asymptotic stability.
 */

function calculateMetrics(result, target = 1) {
  const { time, output } = result;
  const n = output.length;

  if (
    n < 2 ||
    !Number.isFinite(target) ||
    target === 0 ||
    time.length !== n ||
    output.some(v => !Number.isFinite(v))
  ) {
    throw new Error("Invalid response data.");
  }

  const finalOutput = output[n - 1];

  // ========================================
  // 6. CHECK END-OF-SIMULATION STABILITY
  // ========================================

  // Examine the final 10% of the simulation.
  const tailStart = Math.floor(n * 0.90);

  let tailMin = Infinity;
  let tailMax = -Infinity;

  for (let i = tailStart; i < n; i++) {
    tailMin = Math.min(tailMin, output[i]);
    tailMax = Math.max(tailMax, output[i]);
  }

  const tailRange = tailMax - tailMin;

  const scale = Math.max(
    Math.abs(target),
    Math.abs(finalOutput),
    1e-9
  );

  // 0.5% variation tolerance
  const stabilityTolerance = 0.005 * scale;

  const isSettled =
    tailRange <= stabilityTolerance;

  // ========================================
  // 7. RISE TIME
  // ========================================

  function crossingTime(level) {
    if (Math.abs(finalOutput) < 1e-12) {
      return null;
    }

    const threshold = level * finalOutput;

    for (let i = 1; i < n; i++) {
      const y0 = output[i - 1];
      const y1 = output[i];

      const crossed = finalOutput > 0
        ? y0 < threshold && y1 >= threshold
        : y0 > threshold && y1 <= threshold;

      if (crossed && y1 !== y0) {
        const fraction =
          (threshold - y0) / (y1 - y0);

        return time[i - 1] +
          fraction * (time[i] - time[i - 1]);
      }
    }

    return null;
  }

  // Rise time is estimated only if settled.
  let riseTime = null;

  if (isSettled) {
    const t10 = crossingTime(0.10);
    const t90 = crossingTime(0.90);

    if (t10 !== null && t90 !== null) {
      riseTime = t90 - t10;
    }
  }

  // ========================================
  // 8. OVERSHOOT
  // ========================================

  let overshoot = null;

  if (isSettled && Math.abs(finalOutput) > 1e-12) {
    let peak = finalOutput >= 0
      ? -Infinity
      : Infinity;

    for (const value of output) {
      if (finalOutput >= 0) {
        peak = Math.max(peak, value);
      } else {
        peak = Math.min(peak, value);
      }
    }

    overshoot = Math.max(
      0,
      (peak - finalOutput) / finalOutput * 100
    );
  }

  // ========================================
  // 9. SETTLING TIME
  // ========================================

  const tolerance = 0.02 * Math.abs(target);

  let lastOutside = -1;

  for (let i = 0; i < n; i++) {
    if (
      Math.abs(output[i] - target) > tolerance
    ) {
      lastOutside = i;
    }
  }

  // Not reached if the output never stays
  // inside the setpoint settling band.
  const settlingTime =
    !isSettled
      ? null
      : lastOutside === -1
        ? 0
        : lastOutside === n - 1
          ? null
          : time[lastOutside + 1];

  // ========================================
  // 10. STEADY-STATE ERROR
  // ========================================

  const steadyStateError = isSettled
    ? (target - finalOutput) / target * 100
    : null;

  return {
    riseTime,
    overshoot,
    settlingTime,
    steadyStateError,
    finalOutput,
    isSettled,
    tailRange
  };
}


// ========================================
// 11. EXPORT SHARED FUNCTIONS
// ========================================

window.simulatePID = simulatePID;
window.calculateMetrics = calculateMetrics;
