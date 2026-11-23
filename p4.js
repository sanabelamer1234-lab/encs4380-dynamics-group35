/*
 * ENCS4380 - Homework 2
 * P4: Tuning Challenge
 * Group 35
 *
 * Shared engine: pid-core.js (simulatePID, calculateMetrics)
 * Hidden random plant: same idea as Homework 1 Module 4
 * (first-order or underdamped second-order, random parameters).
 *
 * How a round works:
 *   1. A random hidden plant is generated.
 *   2. A spec is generated. It is always achievable: the page first
 *      searches for a reference design that meets it, then sets the
 *      settling-time limit relative to that design.
 *   3. The user tunes Kp, Ki, Kd live. Pass/fail is shown per spec part.
 *   4. "Submit design" locks the score and reveals the plant.
 */

// ========================================
// 1. CONSTANTS
// ========================================

const SETPOINT = 1;
const U_LIMIT = 10;          // actuator limit: u is clipped to +/- U_LIMIT
const DT = 0.002;            // time step for the live simulation
const SEARCH_DT = 0.01;      // coarser step for the reference-design search
const SSE_LIMIT = 1;         // steady-state error spec, in percent
const POINTS_PER_PART = 25;  // 4 spec parts x 25 = 100
const OVERSHOOT_CHOICES = [5, 10, 15, 20];

const DIFFICULTIES = {
  easy:   { label: "Easy",   factor: 2.5 },
  normal: { label: "Normal", factor: 1.8 },
  hard:   { label: "Hard",   factor: 1.3 }
};

const SCORE_KEY = "encs4380-p4-score";


// ========================================
// 2. SMALL HELPERS
// ========================================

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const rand = (a, b) => a + Math.random() * (b - a);
const logRand = (a, b) =>
  Math.exp(rand(Math.log(a), Math.log(b)));
const round1 = v => Math.round(v * 10) / 10;
const round2 = v => Math.round(v * 100) / 100;
const pick = list =>
  list[Math.floor(Math.random() * list.length)];

// Standard normal random number (Box-Muller)
const gauss = () =>
  Math.sqrt(-2 * Math.log(1 - Math.random())) *
  Math.cos(2 * Math.PI * Math.random());


// ========================================
// 3. HIDDEN RANDOM PLANT
// ========================================

/*
 * Same ranges as Module 4 for the dynamics:
 *   first order : tau between 0.3 and 6 s
 *   second order: zeta between 0.15 and 0.65, wn between 1 and 10 rad/s
 * The plant gain K is random too, so the user cannot assume K = 1.
 * Unused fields keep valid defaults so simulatePID accepts them.
 */

function randomPlant() {
  if (Math.random() < 0.5) {
    return {
      plantType: "second",
      K: round1(rand(0.5, 3)),
      tau: 1,
      zeta: round2(rand(0.15, 0.65)),
      wn: round2(logRand(1, 10))
    };
  }

  return {
    plantType: "first",
    K: round1(rand(0.5, 5)),
    tau: round2(logRand(0.3, 6)),
    zeta: 0.5,
    wn: 2
  };
}

// Slowest natural time scale of the plant, in seconds
function plantTimeScale(p) {
  return p.plantType === "first"
    ? p.tau
    : 1 / (p.zeta * p.wn);
}

// Simulation length, scaled to how slow the plant is
function simDuration(p) {
  return clamp(10 * plantTimeScale(p), 10, 40);
}


// ========================================
// 4. CLOSED-LOOP RUN
// ========================================

function evaluate(plant, gains, duration, dt) {
  try {
    const result = simulatePID({
      plantType: plant.plantType,
      K: plant.K,
      tau: plant.tau,
      zeta: plant.zeta,
      wn: plant.wn,

      Kp: gains.Kp,
      Ki: gains.Ki,
      Kd: gains.Kd,

      setpoint: SETPOINT,
      duration,
      dt,

      uMin: -U_LIMIT,
      uMax: U_LIMIT,

      sensorTau: 0,
      antiWindup: true,
      derivativeFilterTau: 0.02
    });

    const metrics = calculateMetrics(result, SETPOINT);

    let peakU = 0;
    for (const u of result.control) {
      peakU = Math.max(peakU, Math.abs(u));
    }

    return { ok: true, result, metrics, peakU };

  } catch (error) {
    return { ok: false, error: error.message };
  }
}


// ========================================
// 5. SPEC CHECK: PASS OR FAIL PER PART
// ========================================

function checkSpec(spec, ev) {
  const unstable = !ev.ok;
  const m = ev.metrics;

  const overshootOk =
    !unstable &&
    m.overshoot !== null &&
    m.overshoot <= spec.overshoot;

  const settlingOk =
    !unstable &&
    m.settlingTime !== null &&
    m.settlingTime <= spec.settling;

  const sseOk =
    !unstable &&
    m.steadyStateError !== null &&
    Math.abs(m.steadyStateError) <= spec.sse;

  const actuatorOk =
    !unstable &&
    ev.peakU < spec.uLimit - 1e-6;

  return [
    {
      id: "overshoot",
      label: "Overshoot",
      requirement: `≤ ${spec.overshoot}%`,
      actual: unstable ? "Unstable"
        : m.overshoot === null ? "Not settled"
        : m.overshoot.toFixed(2) + "%",
      pass: overshootOk
    },
    {
      id: "settling",
      label: "Settling time (±2%)",
      requirement: `≤ ${spec.settling.toFixed(1)} s`,
      actual: unstable ? "Unstable"
        : m.settlingTime === null ? "Not reached"
        : m.settlingTime.toFixed(3) + " s",
      pass: settlingOk
    },
    {
      id: "sse",
      label: "Steady-state error",
      requirement: `|e_ss| ≤ ${spec.sse}%`,
      actual: unstable ? "Unstable"
        : m.steadyStateError === null ? "Not settled"
        : m.steadyStateError.toFixed(2) + "%",
      pass: sseOk
    },
    {
      id: "actuator",
      label: "Actuator (no saturation)",
      requirement: `peak |u| < ${spec.uLimit}`,
      actual: unstable ? "Unstable"
        : "peak |u| = " + ev.peakU.toFixed(2),
      pass: actuatorOk
    }
  ];
}

function scoreOf(parts) {
  return parts.filter(p => p.pass).length * POINTS_PER_PART;
}


// ========================================
// 6. BUILDING AN ACHIEVABLE CHALLENGE
// ========================================

/*
 * Candidate gains are scaled to the plant so the search is small:
 *   - Kp from the loop gain L = K*Kp
 *   - Ki from Kp / (time scale)
 *   - Kd from a short fixed list
 * All candidates stay inside the slider ranges, so the user can
 * reach any design the search finds.
 */

function candidateGains(plant) {
  const Tc = plantTimeScale(plant);
  const seen = new Set();
  const list = [];

  for (const L of [0.5, 1, 2, 4, 8, 15]) {
    for (const m of [0.25, 0.6, 1.2, 2.5]) {
      for (const Kd of [0, 0.1, 0.3, 0.7, 1.5, 3]) {
        const Kp = clamp(round1(L / plant.K), 0.1, 20);
        const Ki = clamp(round1(Kp * m / Tc), 0.1, 10);
        const key = Kp + "|" + Ki + "|" + Kd;

        if (!seen.has(key)) {
          seen.add(key);
          list.push({ Kp, Ki, Kd });
        }
      }
    }
  }

  return list;
}

function searchDesigns(plant, duration) {
  const found = [];

  for (const g of candidateGains(plant)) {
    const ev = evaluate(plant, g, duration, SEARCH_DT);

    if (!ev.ok) {
      continue;
    }

    const m = ev.metrics;

    // Keep only designs that settle, remove the error,
    // and do not saturate the actuator.
    if (
      m.overshoot !== null &&
      m.settlingTime !== null &&
      m.steadyStateError !== null &&
      Math.abs(m.steadyStateError) <= SSE_LIMIT &&
      ev.peakU < U_LIMIT - 1e-6
    ) {
      found.push({
        ...g,
        os: m.overshoot,
        ts: m.settlingTime
      });
    }
  }

  return found;
}

function buildChallenge(difficulty = "normal") {
  const factor = DIFFICULTIES[difficulty].factor;

  // Fail early with a clear reason if the shared engine is
  // missing or broken (for example pid-core.js not loaded).
  if (
    typeof simulatePID !== "function" ||
    typeof calculateMetrics !== "function"
  ) {
    throw new Error(
      "pid-core.js did not load. Put p4.html, p4.js and " +
      "pid-core.js in the same folder."
    );
  }

  const probe = evaluate(
    { plantType: "first", K: 1, tau: 1, zeta: 0.5, wn: 2 },
    { Kp: 1, Ki: 0, Kd: 0 },
    5,
    SEARCH_DT
  );

  if (!probe.ok) {
    throw new Error(
      "Simulation engine error: " + probe.error
    );
  }

  const why = { noDesign: 0, refRun: 0, refSpec: 0 };

  for (let attempt = 0; attempt < 8; attempt++) {
    const plant = randomPlant();
    const duration = simDuration(plant);
    const designs = searchDesigns(plant, duration);

    if (designs.length === 0) {
      why.noDesign++;
      continue;
    }

    // Overshoot limit. If no design reaches it, relax it
    // just enough that the best design meets it.
    let overshootLimit = pick(OVERSHOOT_CHOICES);

    if (!designs.some(d => d.os <= overshootLimit)) {
      const minOs = Math.min(...designs.map(d => d.os));
      overshootLimit = Math.ceil((minOs + 2) / 5) * 5;
    }

    const pool = designs.filter(d => d.os <= overshootLimit);
    const best = pool.reduce((a, b) => (b.ts < a.ts ? b : a));
    const reference = { Kp: best.Kp, Ki: best.Ki, Kd: best.Kd };

    // Confirm the reference with the same step size the page uses.
    const ev = evaluate(plant, reference, duration, DT);

    if (!ev.ok || ev.metrics.settlingTime === null) {
      why.refRun++;
      continue;
    }

    if (ev.metrics.overshoot > overshootLimit) {
      overshootLimit =
        Math.ceil((ev.metrics.overshoot + 1) / 5) * 5;
    }

    const spec = {
      overshoot: overshootLimit,
      settling: Math.max(
        0.3,
        Math.ceil(ev.metrics.settlingTime * factor * 10) / 10
      ),
      sse: SSE_LIMIT,
      uLimit: U_LIMIT
    };

    // The reference must pass every part of its own spec.
    const parts = checkSpec(spec, ev);

    if (!parts.every(p => p.pass)) {
      why.refSpec++;
      continue;
    }

    return {
      plant,
      duration,
      spec,
      reference,
      referenceMetrics: ev.metrics,
      difficulty
    };
  }

  console.error("P4 buildChallenge failed:", why);

  throw new Error(
    "Could not build a challenge (no design found: " +
    why.noDesign + ", reference run failed: " + why.refRun +
    ", reference missed spec: " + why.refSpec + "). Try again."
  );
}


// ========================================
// 7. OPEN-LOOP STEP TEST (NOISY RECORD)
// ========================================

// Unit-step response of wn^2 / (s^2 + 2*zeta*wn*s + wn^2),
// underdamped case (same formula as Module 3 / Module 4).
function secondOrderStep(t, zeta, wn) {
  const r = Math.sqrt(1 - zeta * zeta);
  const wd = wn * r;
  const phi = Math.acos(zeta);

  return 1 - Math.exp(-zeta * wn * t) / r *
    Math.sin(wd * t + phi);
}

function openLoopRecord(plant) {
  let T;

  if (plant.plantType === "first") {
    T = plant.tau * rand(5.5, 9);
  } else {
    const r = Math.sqrt(1 - plant.zeta * plant.zeta);
    const tp = Math.PI / (plant.wn * r);
    T = Math.max(rand(5, 8) / (plant.zeta * plant.wn), 2.5 * tp);
  }

  const samples = 400;
  const noise = 0.01 * plant.K;     // 1% of the final value
  const t = [];
  const y = [];

  for (let i = 0; i <= samples; i++) {
    const time = i * T / samples;

    const clean = plant.plantType === "first"
      ? plant.K * (1 - Math.exp(-time / plant.tau))
      : plant.K * secondOrderStep(time, plant.zeta, plant.wn);

    t.push(time);
    y.push(clean + noise * gauss());
  }

  return { t, y, T };
}


// ========================================
// 8. EXPORT FOR TESTING
// ========================================

window.P4 = {
  randomPlant,
  buildChallenge,
  evaluate,
  checkSpec,
  scoreOf,
  openLoopRecord,
  constants: { SETPOINT, U_LIMIT, DT, SSE_LIMIT }
};


// ========================================
// 9. PAGE (runs only in a browser)
// ========================================

if (typeof document !== "undefined") {
  initPage();
}

function initPage() {
  const $ = id => document.getElementById(id);

  const gainIds = ["kp", "ki", "kd"];

  const state = {
    challenge: null,
    submitted: false,
    evaluation: null,
    openLoop: null,
    hintIndex: 0,
    previousMetrics: null,
    predictionBaseline: null,
    lastPrediction: "",
    roundId: 0,
    updateQueued: false
  };

  let score = { rounds: 0, points: 0 };


  // ----------------------------------------
  // 9.1 Session score
  // ----------------------------------------

  function loadScore() {
    try {
      score = JSON.parse(
        sessionStorage.getItem(SCORE_KEY)
      ) || score;
    } catch (e) { /* storage unavailable */ }
  }

  function saveScore() {
    try {
      sessionStorage.setItem(SCORE_KEY, JSON.stringify(score));
    } catch (e) { /* storage unavailable */ }
  }

  function showScore() {
    $("statRounds").textContent = score.rounds;

    $("statPoints").textContent =
      `${score.points} / ${score.rounds * 100}`;

    $("statAverage").textContent = score.rounds
      ? Math.round(score.points / score.rounds) + "%"
      : "—";
  }


  // ----------------------------------------
  // 9.2 Reading the sliders
  // ----------------------------------------

  function getGains() {
    return {
      Kp: Number($("kp").value),
      Ki: Number($("ki").value),
      Kd: Number($("kd").value)
    };
  }

  function setGains(g) {
    $("kp").value = g.Kp;
    $("ki").value = g.Ki;
    $("kd").value = g.Kd;
  }

  function updateLabels() {
    gainIds.forEach(id => {
      $(id + "Value").textContent =
        Number($(id).value).toFixed(2);
    });
  }


  // ----------------------------------------
  // 9.3 Spec panel (requirements, shown always)
  // ----------------------------------------

  function renderRequirements() {
    const s = state.challenge.spec;

    $("specList").innerHTML = `
      <li>Overshoot <b>≤ ${s.overshoot}%</b></li>
      <li>Settling time (±2% band) <b>≤ ${s.settling.toFixed(1)} s</b></li>
      <li>Steady-state error <b>≈ 0</b> (|e<sub>ss</sub>| ≤ ${s.sse}%)</li>
      <li>Actuator limit ±${s.uLimit}: the control signal
          must <b>never saturate</b></li>`;

    $("setpointNote").textContent =
      `Setpoint r = ${SETPOINT} (unit step). ` +
      `Difficulty: ${DIFFICULTIES[state.challenge.difficulty].label}.`;
  }


  // ----------------------------------------
  // 9.4 Plots
  // ----------------------------------------

  function sampleData(result, maxPoints = 700) {
    const n = result.time.length;
    const stride = Math.max(1, Math.ceil(n / maxPoints));
    const idx = [];

    for (let i = 0; i < n; i += stride) {
      idx.push(i);
    }

    if (idx[idx.length - 1] !== n - 1) {
      idx.push(n - 1);
    }

    return {
      time: idx.map(i => result.time[i]),
      output: idx.map(i => result.output[i]),
      control: idx.map(i => result.control[i])
    };
  }

  const plotConfig = { responsive: true, displaylogo: false };

  function drawResponse(sampled) {
    const c = state.challenge;
    const s = c.spec;
    const end = c.duration;
    const osLine = SETPOINT * (1 + s.overshoot / 100);

    const data = [
      {
        x: sampled.time,
        y: sampled.output,
        name: "Plant output y(t)",
        type: "scatter",
        mode: "lines",
        line: { color: "#2563eb", width: 3 }
      },
      {
        x: [0, end],
        y: [SETPOINT, SETPOINT],
        name: "Setpoint r",
        type: "scatter",
        mode: "lines",
        line: { color: "#e11d48", width: 2, dash: "dash" }
      },
      {
        x: [0, end],
        y: [osLine, osLine],
        name: "Overshoot limit",
        type: "scatter",
        mode: "lines",
        line: { color: "#ea580c", width: 2, dash: "dot" }
      }
    ];

    const layout = {
      title: "Closed-Loop Step Response",
      xaxis: { title: "Time (s)", range: [0, end] },
      yaxis: { title: "Output y(t)", zeroline: true },
      shapes: [
        {
          // +/-2% settling band
          type: "rect",
          xref: "x", yref: "y",
          x0: 0, x1: end,
          y0: SETPOINT * 0.98, y1: SETPOINT * 1.02,
          fillcolor: "rgba(34,197,94,0.18)",
          line: { width: 0 }
        },
        {
          // settling-time limit
          type: "line",
          xref: "x", yref: "paper",
          x0: s.settling, x1: s.settling,
          y0: 0, y1: 1,
          line: { color: "#7c3aed", width: 2, dash: "dot" }
        }
      ],
      margin: { l: 55, r: 20, t: 55, b: 65 },
      legend: { orientation: "h", y: -0.3 },
      uirevision: "r" + state.roundId
    };

    Plotly.react("responsePlot", data, layout, plotConfig);
  }

  function drawControl(sampled) {
    const lim = state.challenge.spec.uLimit;
    const end = state.challenge.duration;

    const data = [
      {
        x: sampled.time,
        y: sampled.control,
        name: "Control signal u(t)",
        type: "scatter",
        mode: "lines",
        line: { color: "#16a34a", width: 3 }
      },
      {
        x: [0, end],
        y: [lim, lim],
        name: "Actuator limit",
        type: "scatter",
        mode: "lines",
        line: { color: "#dc2626", width: 2, dash: "dash" }
      },
      {
        x: [0, end],
        y: [-lim, -lim],
        name: "Actuator limit",
        showlegend: false,
        type: "scatter",
        mode: "lines",
        line: { color: "#dc2626", width: 2, dash: "dash" }
      }
    ];

    const layout = {
      title: "Controller Output and Saturation",
      xaxis: { title: "Time (s)", range: [0, end] },
      yaxis: { title: "Control signal u(t)" },
      margin: { l: 55, r: 20, t: 55, b: 65 },
      legend: { orientation: "h", y: -0.3 },
      uirevision: "r" + state.roundId
    };

    Plotly.react("controlPlot", data, layout, plotConfig);
  }

  function drawOpenLoop() {
    const rec = state.openLoop;

    Plotly.react(
      "openLoopPlot",
      [{
        x: rec.t,
        y: rec.y,
        name: "Measured open-loop output",
        type: "scatter",
        mode: "markers",
        marker: { size: 4, color: "#2457c5" }
      }],
      {
        title: "Open-loop unit-step test (no controller)",
        xaxis: { title: "Time (s)", range: [0, rec.T] },
        yaxis: { title: "Output y(t)", zeroline: true },
        margin: { l: 55, r: 20, t: 55, b: 55 },
        showlegend: false,
        uirevision: "o" + state.roundId
      },
      plotConfig
    );
  }


  // ----------------------------------------
  // 9.5 Spec results table
  // ----------------------------------------

  function renderResults(parts) {
    $("specBody").innerHTML = parts.map(p => `
      <tr>
        <td>${p.label}</td>
        <td>${p.requirement}</td>
        <td>${p.actual}</td>
        <td class="${p.pass ? "pass" : "fail"}">
          ${p.pass ? "PASS" : "FAIL"}
        </td>
      </tr>`).join("");

    const passed = parts.filter(p => p.pass).length;
    const points = passed * POINTS_PER_PART;

    $("liveScore").textContent =
      `${passed} / ${parts.length} parts passed. ` +
      (state.submitted
        ? "Round score is locked."
        : `Score if you submit now: ${points} / 100.`);

    $("liveScore").style.color =
      passed === parts.length ? "#166534" : "#b45309";
  }


  // ----------------------------------------
  // 9.6 Predict, then check
  // ----------------------------------------

  function formatTime(v) {
    return v === null || !Number.isFinite(v)
      ? "Not reached" : v.toFixed(3) + " s";
  }

  function formatPercent(v) {
    return v === null || !Number.isFinite(v)
      ? "Not settled" : v.toFixed(2) + "%";
  }

  function checkPrediction(metrics) {
    if (!state.lastPrediction || !state.predictionBaseline) {
      return;
    }

    const old = state.predictionBaseline;
    let correct = false;
    let comparable = true;
    let text = "";

    if (!old.isSettled || !metrics.isSettled) {
      comparable = false;
      text = "At least one response is not settled, " +
        "so the prediction cannot be verified.";

    } else if (
      state.lastPrediction === "faster" ||
      state.lastPrediction === "slower"
    ) {
      if (old.riseTime === null || metrics.riseTime === null) {
        comparable = false;
        text = "Rise times could not be compared.";
      } else {
        correct = state.lastPrediction === "faster"
          ? metrics.riseTime < old.riseTime - 0.001
          : metrics.riseTime > old.riseTime + 0.001;

        text = "Rise time changed from " +
          formatTime(old.riseTime) + " to " +
          formatTime(metrics.riseTime) + ".";
      }

    } else if (state.lastPrediction === "overshoot") {
      if (old.overshoot === null || metrics.overshoot === null) {
        comparable = false;
        text = "Overshoot could not be compared.";
      } else {
        correct = metrics.overshoot > old.overshoot + 0.01;

        text = "Overshoot changed from " +
          formatPercent(old.overshoot) + " to " +
          formatPercent(metrics.overshoot) + ".";
      }

    } else if (state.lastPrediction === "error") {
      if (
        old.steadyStateError === null ||
        metrics.steadyStateError === null
      ) {
        comparable = false;
        text = "Final errors could not be compared.";
      } else {
        correct =
          Math.abs(metrics.steadyStateError) <
          Math.abs(old.steadyStateError) - 0.01;

        text = "Steady-state error changed from " +
          formatPercent(old.steadyStateError) + " to " +
          formatPercent(metrics.steadyStateError) + ".";
      }
    }

    $("predictionFeedback").textContent =
      (comparable
        ? (correct ? "Prediction supported! "
                   : "Prediction not supported. ")
        : "Inconclusive. ") + text;

    state.lastPrediction = "";
    state.predictionBaseline = null;
    $("prediction").value = "";
  }

  function clearPrediction() {
    state.lastPrediction = "";
    state.predictionBaseline = null;
    $("prediction").value = "";
    $("predictionFeedback").textContent = "";
  }


  // ----------------------------------------
  // 9.7 Main live update
  // ----------------------------------------

  function updateSimulation() {
    state.updateQueued = false;
    updateLabels();

    if (!state.challenge) {
      return;
    }

    const c = state.challenge;
    const ev = evaluate(c.plant, getGains(), c.duration, DT);
    state.evaluation = ev;

    if (!ev.ok) {
      $("status").textContent =
        "Simulation error: " + ev.error;
      $("status").style.color = "#b91c1c";

      renderResults(checkSpec(c.spec, ev));

      state.previousMetrics = null;
      clearPrediction();
      return;
    }

    $("status").textContent = ev.metrics.isSettled
      ? "Response appears stationary near the end " +
        "of the simulation."
      : "Not settled: the response is still changing " +
        "near the end of the simulation.";

    $("status").style.color =
      ev.metrics.isSettled ? "#166534" : "#b45309";

    const sampled = sampleData(ev.result);
    drawResponse(sampled);
    drawControl(sampled);

    renderResults(checkSpec(c.spec, ev));
    checkPrediction(ev.metrics);

    state.previousMetrics = ev.metrics;
  }

  // Slider drags can fire faster than the solver runs.
  // Run at most one simulation per animation frame.
  function scheduleUpdate() {
    updateLabels();

    if (state.updateQueued) {
      return;
    }

    state.updateQueued = true;
    requestAnimationFrame(updateSimulation);
  }


  // ----------------------------------------
  // 9.8 Hints
  // ----------------------------------------

  const HINTS = [
    "Press the open-loop step test button. A first-order plant " +
      "is steepest at t = 0 and never overshoots. A second-order " +
      "plant starts flat and can overshoot.",
    "With P only, a steady-state error remains: " +
      "e_ss = 1 / (1 + K*Kp). You need Ki > 0 to remove it.",
    "Too much overshoot? Lower Ki, or add some Kd. " +
      "Derivative action adds damping.",
    "Kp times the step size is the first control value the " +
      "actuator sees. A very large Kp saturates u at the start.",
    "Too slow? Raise Kp first for speed, then add just enough " +
      "Ki to remove the remaining error."
  ];

  function resetHints() {
    state.hintIndex = 0;
    $("hintList").innerHTML = "";
    $("hintBtn").hidden = false;
  }

  function nextHint() {
    if (state.hintIndex >= HINTS.length) {
      return;
    }

    const li = document.createElement("li");
    li.textContent = HINTS[state.hintIndex++];
    $("hintList").appendChild(li);

    if (state.hintIndex >= HINTS.length) {
      $("hintBtn").hidden = true;
    }
  }


  // ----------------------------------------
  // 9.9 Submit and reveal
  // ----------------------------------------

  function describePlant(p) {
    return p.plantType === "first"
      ? `First-order: G(s) = ${p.K} / (${p.tau}s + 1)  ` +
        `(K = ${p.K}, τ = ${p.tau} s)`
      : `Second-order: K = ${p.K}, ζ = ${p.zeta}, ` +
        `ωn = ${p.wn} rad/s  ` +
        `(G(s) = ${round2(p.K * p.wn * p.wn)} / ` +
        `(s² + ${round2(2 * p.zeta * p.wn)}s + ` +
        `${round2(p.wn * p.wn)}))`;
  }

  function submitDesign() {
    if (state.submitted || !state.challenge) {
      return;
    }

    const c = state.challenge;
    const gains = getGains();
    const ev = evaluate(c.plant, gains, c.duration, DT);
    const parts = checkSpec(c.spec, ev);
    const points = scoreOf(parts);

    state.submitted = true;

    score.rounds += 1;
    score.points += points;
    saveScore();
    showScore();

    renderResults(parts);

    $("submitBtn").disabled = true;

    $("revealScore").textContent =
      `Round score: ${points} / 100 ` +
      `(${parts.filter(p => p.pass).length} of 4 parts passed).`;

    $("revealPlant").textContent = describePlant(c.plant);

    const rm = c.referenceMetrics;
    const r = c.reference;

    $("revealYours").textContent =
      `Your gains: Kp = ${gains.Kp.toFixed(2)}, ` +
      `Ki = ${gains.Ki.toFixed(2)}, Kd = ${gains.Kd.toFixed(2)}.`;

    $("revealReference").textContent =
      `One design that meets the spec: Kp = ${r.Kp}, ` +
      `Ki = ${r.Ki}, Kd = ${r.Kd} (overshoot ` +
      `${rm.overshoot.toFixed(1)}%, settling ` +
      `${rm.settlingTime.toFixed(2)} s). ` +
      `Other designs also work.`;

    $("revealCard").hidden = false;
    $("revealCard").scrollIntoView({
      behavior: "smooth", block: "start"
    });
  }


  // ----------------------------------------
  // 9.10 New round
  // ----------------------------------------

  function startRound() {
    $("newBtn").disabled = true;
    $("submitBtn").disabled = true;

    $("status").textContent = "Preparing a new challenge…";
    $("status").style.color = "#4a596b";

    // Let the browser paint the message before the search runs.
    setTimeout(() => {
      try {
        state.challenge =
          buildChallenge($("difficulty").value);
      } catch (error) {
        $("status").textContent = error.message;
        $("status").style.color = "#b91c1c";
        $("newBtn").disabled = false;
        return;
      }

      state.roundId += 1;
      state.submitted = false;
      state.openLoop = null;
      state.previousMetrics = null;

      setGains({ Kp: 1, Ki: 0, Kd: 0 });

      clearPrediction();
      resetHints();

      $("openLoopCard").hidden = true;
      $("openLoopBtn").textContent =
        "Run open-loop step test";
      $("revealCard").hidden = true;

      renderRequirements();

      $("newBtn").disabled = false;
      $("submitBtn").disabled = false;

      updateSimulation();
    }, 30);
  }


  // ----------------------------------------
  // 9.11 Open-loop step test
  // ----------------------------------------

  function toggleOpenLoop() {
    if (!state.challenge) {
      return;
    }

    const card = $("openLoopCard");

    if (!card.hidden) {
      card.hidden = true;
      $("openLoopBtn").textContent = "Run open-loop step test";
      return;
    }

    if (!state.openLoop) {
      state.openLoop = openLoopRecord(state.challenge.plant);
    }

    card.hidden = false;
    $("openLoopBtn").textContent = "Hide open-loop step test";
    drawOpenLoop();
  }


  // ----------------------------------------
  // 9.12 Events
  // ----------------------------------------

  gainIds.forEach(id => {
    $(id).addEventListener("input", scheduleUpdate);
  });

  $("prediction").addEventListener("change", () => {
    state.lastPrediction = $("prediction").value;

    state.predictionBaseline = state.lastPrediction
      ? state.previousMetrics
      : null;

    $("predictionFeedback").textContent = state.lastPrediction
      ? "Now change a gain to check your prediction."
      : "";
  });

  $("newBtn").addEventListener("click", startRound);
  $("submitBtn").addEventListener("click", submitDesign);
  $("hintBtn").addEventListener("click", nextHint);
  $("openLoopBtn").addEventListener("click", toggleOpenLoop);

  $("resetGains").addEventListener("click", () => {
    setGains({ Kp: 1, Ki: 0, Kd: 0 });
    clearPrediction();
    updateSimulation();
  });

  $("loadReference").addEventListener("click", () => {
    if (state.challenge) {
      setGains(state.challenge.reference);
      updateSimulation();
    }
  });

  $("resetScore").addEventListener("click", () => {
    score = { rounds: 0, points: 0 };
    saveScore();
    showScore();
  });


  // ----------------------------------------
  // 9.13 Start
  // ----------------------------------------

  loadScore();
  showScore();
  updateLabels();
  startRound();
}
