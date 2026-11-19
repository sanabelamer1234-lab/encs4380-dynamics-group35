/*
 * ENCS4380 - Homework 2
 * P2: A Slow Sensor in the Loop
 * Group 35
 *
 * Shared engine: pid-core.js (simulatePID with sensorTau, calculateMetrics)
 *
 * Plant:   tau  * y'  + y  = K * u
 * Sensor:  tauS * ym' + ym = y      (first-order sensor in the feedback path)
 * PID:     u = Kp*e + Ki*integral(e) - Kd*d(ym)/dt,   e = r - ym
 *
 * The controller never sees y. It only sees ym, so it reacts late.
 */

// ========================================
// 1. PAGE ELEMENTS AND SETTINGS
// ========================================

const $ = id => document.getElementById(id);

const SLIDER_IDS = ["sensorTau", "kp", "ki", "kd", "plantK", "plantTau", "setpoint"];
// Kp = 2, Ki = 6 on the plant 1/(s + 1) makes the loop unstable at exactly tauS = 1.0 s
const DEFAULTS = { sensorTau: 0.05, kp: 2, ki: 6, kd: 0, plantK: 1, plantTau: 1, setpoint: 1 };

const DURATION = 15;        // seconds simulated for the main plot
const DT = 0.002;           // RK4 step for the main plot
const SWEEP_DT = 0.005;     // coarser step for the overshoot sweep (31 simulations)
const SWEEP_POINTS = 31;
const U_LIMIT = 100;        // actuator limit, same default as P1

function getSettings() {
  return {
    plantType: "first",
    K: Number($("plantK").value),
    tau: Number($("plantTau").value),
    Kp: Number($("kp").value),
    Ki: Number($("ki").value),
    Kd: Number($("kd").value),
    setpoint: Number($("setpoint").value),
    sensorTau: Number($("sensorTau").value),
    duration: DURATION,
    dt: DT,
    uMin: -U_LIMIT,
    uMax: U_LIMIT,
    antiWindup: true,
    derivativeFilterTau: 0.02
  };
}


// ========================================
// 2. THEORY
// ========================================

// Final value of y when the loop is stable. The sensor has DC gain 1,
// so with integral action y ends at the setpoint. Without it, a P loop
// ends at K*Kp/(1 + K*Kp) of the setpoint (D does not affect the final value).
function expectedFinal(s) {
  if (s.Ki > 0) return s.setpoint;
  const loopGain = s.K * s.Kp;
  return loopGain / (1 + loopGain) * s.setpoint;
}

/*
 * Closed-loop characteristic equation (plant, sensor and PID together):
 *
 *   tau*tauS*s^3 + (tau + tauS + K*Kd)*s^2 + (1 + K*Kp)*s + K*Ki = 0
 *
 * Routh-Hurwitz for a cubic a3 s^3 + a2 s^2 + a1 s + a0: stable when all
 * coefficients are positive and a2*a1 > a3*a0. Solving that for tauS gives
 *
 *   tauS_crit = (tau + K*Kd)(1 + K*Kp) / (tau*K*Ki - (1 + K*Kp))
 *
 * If the denominator is <= 0, no sensor lag can make the loop unstable.
 * Without integral action (Ki = 0) the loop is only second order, so it
 * gets more oscillatory but never unstable.
 * The small derivative filter in pid-core.js is ignored here, so with
 * Kd > 0 the value is a close approximation.
 */
function criticalSensorTau(s) {
  if (s.Ki <= 0) return Infinity;
  const denominator = s.tau * s.K * s.Ki - (1 + s.K * s.Kp);
  if (denominator <= 0) return Infinity;
  return (s.tau + s.K * s.Kd) * (1 + s.K * s.Kp) / denominator;
}

// Largest overshoot of a signal above the expected final value, in percent
function peakOvershoot(time, values, final) {
  if (!(final > 1e-9)) return { overshoot: NaN, peakTime: NaN };
  let iPeak = 0;
  for (let i = 1; i < values.length; i++) {
    if (values[i] > values[iPeak]) iPeak = i;
  }
  const overshoot = Math.max(0, (values[iPeak] - final) / final * 100);
  return { overshoot, peakTime: overshoot > 0.01 ? time[iPeak] : NaN };
}


// ========================================
// 3. FORMATTING
// ========================================

const fmt = (v, digits = 2) => Number.isFinite(v) ? v.toFixed(digits) : "--";
const fmtTime = v => Number.isFinite(v) ? v.toFixed(2) + " s" : "Not reached";
const fmtPercent = v => Number.isFinite(v) ? v.toFixed(1) + "%" : "Not settled";

// Keep plots under ~700 points so redraws stay instant
function downsample(arrays, maxPoints = 700) {
  const n = arrays[0].length;
  const stride = Math.max(1, Math.ceil(n / maxPoints));
  const idx = [];
  for (let i = 0; i < n; i += stride) idx.push(i);
  if (idx[idx.length - 1] !== n - 1) idx.push(n - 1);
  return arrays.map(a => idx.map(i => a[i]));
}

const isTouch = window.matchMedia("(pointer: coarse)").matches;
const plotConfig = { responsive: true, displaylogo: false, displayModeBar: false };

function baseLayout(xTitle, yTitle) {
  return {
    xaxis: { title: { text: xTitle }, zeroline: true },
    yaxis: { title: { text: yTitle }, zeroline: true },
    margin: { l: 60, r: 20, t: 20, b: 55 },
    legend: { orientation: "h", x: 0, y: 1.02, yanchor: "bottom" },
    dragmode: isTouch ? false : "zoom",     // a finger drag scrolls the page on phones
    hovermode: "x unified",
    paper_bgcolor: "#ffffff",
    plot_bgcolor: "#ffffff"
  };
}


// ========================================
// 4. MAIN PLOT AND METRICS
// ========================================

function drawResponse(result, s, unstable) {
  const [t, y, ym, r] = downsample([result.time, result.output, result.measured, result.setpoint]);

  const data = [
    { x: t, y: r, name: "Setpoint r(t)", mode: "lines", line: { color: "#6b7280", width: 2, dash: "dot" } },
    { x: t, y: y, name: "True output y(t)", mode: "lines", line: { color: "#2563eb", width: 3 } },
    { x: t, y: ym, name: "Sensor reading ym(t)", mode: "lines", line: { color: "#d97706", width: 3, dash: "dash" } }
  ];

  const layout = baseLayout("Time (s)", "Output");
  layout.xaxis.range = [0, DURATION];
  if (unstable) {
    // Fixed y-range, so the growing oscillation does not squash the plot
    layout.yaxis.range = [-1.5 * s.setpoint, 3.5 * s.setpoint];
    layout.annotations = [{
      text: "Unstable: the oscillation grows until the actuator saturates",
      xref: "paper", yref: "paper", x: 0.5, y: 0.98, showarrow: false,
      font: { color: "#b91c1c", size: 13 }, bgcolor: "rgba(255,255,255,0.85)"
    }];
  }

  Plotly.react("responsePlot", data, layout, plotConfig);
}

function showMetrics(result, s, unstable) {
  const final = expectedFinal(s);
  // An unstable loop has no real peak: its swing keeps growing
  const trueOS = unstable ? { overshoot: NaN, peakTime: NaN } : peakOvershoot(result.time, result.output, final);
  const sensorOS = unstable ? { overshoot: NaN, peakTime: NaN } : peakOvershoot(result.time, result.measured, final);

  const trueMetrics = calculateMetrics(result, s.setpoint);
  const sensorMetrics = calculateMetrics({ time: result.time, output: result.measured }, s.setpoint);

  const peakText = os => unstable ? "Unstable" : Number.isFinite(os.peakTime) ? fmtTime(os.peakTime) : "No peak";
  $("osTrue").textContent = unstable ? "Unstable" : fmtPercent(trueOS.overshoot);
  $("osSensor").textContent = unstable ? "Unstable" : fmtPercent(sensorOS.overshoot);
  $("tpTrue").textContent = peakText(trueOS);
  $("tpSensor").textContent = peakText(sensorOS);
  $("tsTrue").textContent = trueMetrics.isSettled ? fmtTime(trueMetrics.settlingTime) : "Not settled";
  $("tsSensor").textContent = sensorMetrics.isSettled ? fmtTime(sensorMetrics.settlingTime) : "Not settled";
  $("sseTrue").textContent = fmtPercent(trueMetrics.steadyStateError);
  $("sseSensor").textContent = fmtPercent(sensorMetrics.steadyStateError);

  return { trueOS: trueOS.overshoot, sensorOS: sensorOS.overshoot };
}

function showStability(s, critical) {
  const box = $("stability");
  if (!Number.isFinite(critical)) {
    box.className = "status stable";
    box.textContent = s.Ki > 0
      ? "Stable for any sensor τs with these gains: the integral action is too weak to cause oscillation."
      : "No integral action (Ki = 0): the loop can become very oscillatory as τs grows, but it cannot become unstable.";
    return false;
  }
  const ratio = s.sensorTau / critical;
  if (ratio >= 1) {
    box.className = "status unstable";
    box.textContent = `Unstable: τs = ${fmt(s.sensorTau)} s is above the critical value τs,crit ≈ ${fmt(critical)} s. ` +
      "The controller keeps reacting to an old reading, so every correction arrives too late and the oscillation grows.";
    return true;
  }
  box.className = ratio > 0.6 ? "status near" : "status stable";
  box.textContent = `Stable: τs = ${fmt(s.sensorTau)} s is ${Math.round(ratio * 100)}% of the critical value τs,crit ≈ ${fmt(critical)} s. ` +
    (ratio > 0.6 ? "Close to the limit, so expect strong overshoot and slow-dying oscillation." : "");
  return false;
}


// ========================================
// 5. OVERSHOOT SWEEP OVER SENSOR TAU
// ========================================

let sweepCache = { key: "", data: null };

// Only depends on the gains and the plant, not on the current tauS,
// so it is recomputed only when one of those changes.
function computeSweep(s, critical) {
  const key = [s.K, s.tau, s.Kp, s.Ki, s.Kd, s.setpoint].join("|");
  if (sweepCache.key === key) return sweepCache.data;

  const maxTau = Number($("sensorTau").max);
  const final = expectedFinal(s);
  const data = { tauS: [], trueOS: [], sensorOS: [] };

  for (let i = 0; i < SWEEP_POINTS; i++) {
    const tauS = i * maxTau / (SWEEP_POINTS - 1);
    data.tauS.push(tauS);
    if (tauS >= critical) {          // unstable: overshoot has no meaning
      data.trueOS.push(null);
      data.sensorOS.push(null);
      continue;
    }
    const run = simulatePID({ ...s, sensorTau: tauS, dt: SWEEP_DT });
    data.trueOS.push(peakOvershoot(run.time, run.output, final).overshoot);
    data.sensorOS.push(peakOvershoot(run.time, run.measured, final).overshoot);
  }

  sweepCache = { key, data };
  return data;
}

function drawSweep(s, critical, current) {
  const sweep = computeSweep(s, critical);
  const maxTau = Number($("sensorTau").max);
  const finite = sweep.trueOS.filter(Number.isFinite).concat([current.trueOS].filter(Number.isFinite));
  const top = Math.min(300, Math.max(20, ...finite) * 1.1);

  const data = [
    { x: sweep.tauS, y: sweep.trueOS, name: "True output overshoot", mode: "lines+markers",
      line: { color: "#2563eb", width: 3 }, marker: { size: 5 } },
    { x: sweep.tauS, y: sweep.sensorOS, name: "Overshoot the sensor reports", mode: "lines+markers",
      line: { color: "#d97706", width: 3, dash: "dash" }, marker: { size: 5 } }
  ];
  if (s.sensorTau < critical) {
    data.push({ x: [s.sensorTau], y: [current.trueOS], name: "Current τs", mode: "markers",
      marker: { size: 13, color: "#19365d", symbol: "diamond" } });
  }

  const layout = baseLayout("Sensor τs (s)", "Peak overshoot (%)");
  layout.xaxis.range = [0, maxTau];
  layout.yaxis.range = [0, top];
  layout.shapes = [{ type: "line", x0: s.sensorTau, x1: s.sensorTau, y0: 0, y1: top,
    line: { color: "#19365d", width: 1, dash: "dot" } }];
  layout.annotations = [];

  if (critical <= maxTau) {
    layout.shapes.push({ type: "rect", x0: critical, x1: maxTau, y0: 0, y1: top,
      fillcolor: "rgba(220,38,38,0.12)", line: { width: 0 } });
    layout.shapes.push({ type: "line", x0: critical, x1: critical, y0: 0, y1: top,
      line: { color: "#dc2626", width: 2, dash: "dash" } });
    layout.annotations.push({ x: (critical + maxTau) / 2, y: top * 0.9, text: "Unstable: oscillates",
      showarrow: false, font: { color: "#b91c1c", size: 13 } });
  }

  Plotly.react("sweepPlot", data, layout, plotConfig);

  $("criticalNote").textContent = Number.isFinite(critical)
    ? `Routh-Hurwitz limit for these gains: τs,crit = (τ + K·Kd)(1 + K·Kp) / (τ·K·Ki − (1 + K·Kp)) ≈ ${fmt(critical)} s.` +
      (critical > maxTau ? " That is beyond this slider, so the whole range is stable." : "") +
      (s.Kd > 0 ? " With Kd > 0 this ignores the small derivative filter, so it is approximate." : "")
    : "With these gains no sensor time constant makes the loop unstable (see the status box above).";
}


// ========================================
// 6. UPDATE EVERYTHING
// ========================================

function updateLabels() {
  const digits = { sensorTau: 2, kp: 1, ki: 1, kd: 2, plantK: 1, plantTau: 1, setpoint: 1 };
  SLIDER_IDS.forEach(id => { $(id + "Value").textContent = Number($(id).value).toFixed(digits[id]); });
  $("diagramSensor").textContent = `1 / (${Number($("sensorTau").value).toFixed(2)}·s + 1)`;
}

function update() {
  updateLabels();
  const s = getSettings();
  const critical = criticalSensorTau(s);

  try {
    const result = simulatePID(s);
    const unstable = showStability(s, critical);
    drawResponse(result, s, unstable);
    const current = showMetrics(result, s, unstable);
    drawSweep(s, critical, current);
  } catch (error) {
    console.error("P2 simulation error:", error);
    $("stability").className = "status unstable";
    $("stability").textContent = "Simulation error: " + error.message;
  }
}

// Redraw at most once per animation frame while a slider is dragged
let pending = false;
function scheduleUpdate() {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => { pending = false; update(); });
}

function setSliders(values) {
  Object.entries(values).forEach(([id, value]) => { $(id).value = value; });
  update();
}


// ========================================
// 7. PREDICT, THEN CHECK
// ========================================

const QUIZ = [
  {
    q: "Keep the gains (Kp = 2, Ki = 6). The sensor slows down from τs = 0.05 s to τs = 0.6 s. What happens to the overshoot of the true output?",
    options: ["It grows", "It shrinks", "It stays the same"],
    answer: 0,
    show: { ...DEFAULTS, sensorTau: 0.6 },
    why: "It grows. The controller acts on an old, smoothed reading, so it keeps pushing after the real output has already passed the setpoint."
  },
  {
    q: "With τs = 0.6 s, which overshoots more: the true output, or what the sensor reports?",
    options: ["The true output", "The sensor reading", "They overshoot the same"],
    answer: 0,
    show: { ...DEFAULTS, sensorTau: 0.6 },
    why: "The true output. The sensor smooths the peak and shows it late, so the reading looks calmer than reality. Anyone trusting the sensor underestimates the overshoot."
  },
  {
    q: "The loop oscillates with τs = 1.2 s. Following the homework tip, what should you check first?",
    options: ["Raise Kp to react faster", "The sensor's τs", "Raise Ki to remove the error"],
    answer: 1,
    show: { ...DEFAULTS, sensorTau: 1.2 },
    why: "The sensor's τs. For these gains the loop is only stable while τs < τs,crit ≈ 1.0 s. A faster sensor fixes it without touching the gains, and raising Kp or Ki would make it worse."
  }
];

function buildQuiz() {
  $("quiz").innerHTML = QUIZ.map((item, i) => `
    <div class="q">
      <b>${i + 1}. ${item.q}</b>
      ${item.options.map((o, j) => `<label><input type="radio" name="q${i}" value="${j}"> ${o}</label>`).join("")}
      <button data-check="${i}">Check</button>
      <button class="secondary" data-show="${i}" hidden>Show me</button>
      <div class="answer" id="answer${i}" aria-live="polite"></div>
    </div>`).join("");

  document.querySelectorAll("[data-check]").forEach(btn => btn.addEventListener("click", () => {
    const i = Number(btn.dataset.check);
    const picked = document.querySelector(`input[name=q${i}]:checked`);
    const out = $("answer" + i);
    if (!picked) {
      out.innerHTML = '<span class="fail">Pick an answer first.</span>';
      return;
    }
    const ok = Number(picked.value) === QUIZ[i].answer;
    out.innerHTML = `<span class="${ok ? "pass" : "fail"}">${ok ? "Correct." : "Not quite."}</span> ${QUIZ[i].why}`;
    document.querySelector(`[data-show="${i}"]`).hidden = false;
  }));

  document.querySelectorAll("[data-show]").forEach(btn => btn.addEventListener("click", () => {
    setSliders(QUIZ[Number(btn.dataset.show)].show);
    $("responsePlot").scrollIntoView({ behavior: "smooth", block: "center" });
  }));
}


// ========================================
// 8. CONSISTENCY CHECKS (simulation vs theory)
// ========================================

// Peak-to-peak size of y - r inside a time window
function swing(run, t0, t1) {
  let lo = Infinity, hi = -Infinity;
  run.time.forEach((t, i) => {
    if (t >= t0 && t <= t1) {
      lo = Math.min(lo, run.output[i]);
      hi = Math.max(hi, run.output[i]);
    }
  });
  return hi - lo;
}

function runValidation() {
  const body = $("validationBody");
  body.innerHTML = "";

  const addRow = (name, expected, actual, passed) => {
    const row = document.createElement("tr");
    [name, expected, actual, passed ? "PASS" : "FAIL"].forEach((text, i) => {
      const cell = document.createElement("td");
      cell.textContent = text;
      if (i === 3) cell.className = passed ? "pass" : "fail";
      row.appendChild(cell);
    });
    body.appendChild(row);
  };

  try {
    const base = { plantType: "first", K: 1, tau: 1, setpoint: 1, uMin: -U_LIMIT, uMax: U_LIMIT, antiWindup: true, derivativeFilterTau: 0.02 };

    // 1. A perfect sensor reproduces P1 validation check 1
    const p = simulatePID({ ...base, Kp: 9, Ki: 0, Kd: 0, sensorTau: 0, duration: 10, dt: 0.001 });
    const pError = calculateMetrics(p, 1).steadyStateError;
    addRow("Perfect sensor (τs = 0), P only, Kp = 9: steady-state error", "10% (same as P1)", fmt(pError, 3) + "%", Math.abs(pError - 10) < 0.1);

    // 2 and 3. The simulation agrees with the Routh-Hurwitz limit
    const gains = { Kp: 2, Ki: 6, Kd: 0 };
    const critical = criticalSensorTau({ ...base, ...gains });
    const T = 40;
    const below = simulatePID({ ...base, ...gains, sensorTau: 0.9 * critical, duration: T, dt: 0.002 });
    const above = simulatePID({ ...base, ...gains, sensorTau: 1.1 * critical, duration: T, dt: 0.002 });
    const ratioBelow = swing(below, 0.85 * T, T) / swing(below, 0.3 * T, 0.45 * T);
    const ratioAbove = swing(above, 0.85 * T, T) / swing(above, 0.3 * T, 0.45 * T);

    addRow(`Kp = 2, Ki = 6, τs = 0.9 × τs,crit (${fmt(0.9 * critical)} s): oscillation dies out`,
      "late swing < early swing", `late/early = ${fmt(ratioBelow, 3)}`, ratioBelow < 1);
    addRow(`Kp = 2, Ki = 6, τs = 1.1 × τs,crit (${fmt(1.1 * critical)} s): oscillation grows`,
      "late swing > early swing", `late/early = ${fmt(ratioAbove, 1)}`, ratioAbove > 1);

    // 4. With integral action, the sensor still ends at the setpoint (sensor DC gain = 1)
    const slow = simulatePID({ ...base, ...gains, sensorTau: 0.5, duration: 30, dt: 0.002 });
    const slowError = calculateMetrics(slow, 1).steadyStateError;
    addRow("Kp = 2, Ki = 6, τs = 0.5 s: steady-state error", "0% (integral action)", fmtPercent(slowError), Number.isFinite(slowError) && Math.abs(slowError) < 0.1);
  } catch (error) {
    addRow("Validation error: " + error.message, "", "", false);
  }
}


// ========================================
// 9. EVENTS AND START
// ========================================

SLIDER_IDS.forEach(id => $(id).addEventListener("input", scheduleUpdate));
$("presetDefault").addEventListener("click", () => setSliders(DEFAULTS));
document.querySelectorAll("button[data-ts]").forEach(btn =>
  btn.addEventListener("click", () => setSliders({ sensorTau: btn.dataset.ts })));

buildQuiz();
update();
runValidation();
