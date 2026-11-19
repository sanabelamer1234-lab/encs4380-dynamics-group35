
/*
 * ENCS4380 - Homework 2
 * P1: PID Playground
 * Group 35
 *
 * Shared engine: pid-core.js
 * First-order and second-order PID control
 * Live plots, predictions and performance metrics
 */

// ========================================
// 1. PAGE ELEMENTS
// ========================================

const parameterIds = [
  "kp", "ki", "kd",
  "setpoint", "plantK", "plantTau",
  "zeta", "wn"
];

const inputs = {};

parameterIds.forEach(id => {
  inputs[id] = document.getElementById(id);
});

const plantTypeSelect =
  document.getElementById("plantType");

const limitSelect =
  document.getElementById("limit");

const predictionInput =
  document.getElementById("prediction");

const predictionFeedback =
  document.getElementById("predictionFeedback");

let previousMetrics = null;
let predictionBaseline = null;
let lastPrediction = "";

// Add a simulation status message below the metrics
// without modifying p1.html.
const statusMessage = document.createElement("p");
statusMessage.id = "simulationStatus";
statusMessage.setAttribute("aria-live", "polite");

document.querySelector(".metrics")
  .insertAdjacentElement("afterend", statusMessage);


// ========================================
// 2. SIMULATION SETTINGS
// ========================================

function getSettings() {
  const limit = Number(limitSelect.value);

  return {
    plantType: plantTypeSelect.value,

    K: Number(inputs.plantK.value),
    tau: Number(inputs.plantTau.value),

    zeta: Number(inputs.zeta.value),
    wn: Number(inputs.wn.value),

    Kp: Number(inputs.kp.value),
    Ki: Number(inputs.ki.value),
    Kd: Number(inputs.kd.value),

    setpoint: Number(inputs.setpoint.value),

    duration: 15,
    dt: 0.001,

    uMin: -limit,
    uMax: limit,

    sensorTau: 0,
    antiWindup: true,
    derivativeFilterTau: 0.02
  };
}


// ========================================
// 3. SLIDER LABELS
// ========================================

function updateLabels() {
  parameterIds.forEach(id => {
    const label =
      document.getElementById(id + "Value");

    if (label) {
      label.textContent =
        Number(inputs[id].value).toFixed(2);
    }
  });
}


// ========================================
// 4. PLANT SELECTION
// ========================================

function updatePlantControls() {
  const second =
    plantTypeSelect.value === "second";

  document.getElementById("tauControl")
    .style.display = second ? "none" : "block";

  document.getElementById("zetaControl")
    .style.display = second ? "block" : "none";

  document.getElementById("wnControl")
    .style.display = second ? "block" : "none";

  updateSimulation();
}


// ========================================
// 5. DISPLAY PLANT MODEL
// ========================================

function updatePlantDescription() {
  const equation =
    document.getElementById("plantEquation");

  const info =
    document.getElementById("plantInfo");

  const K = Number(inputs.plantK.value);
  const tau = Number(inputs.plantTau.value);
  const zeta = Number(inputs.zeta.value);
  const wn = Number(inputs.wn.value);

  if (plantTypeSelect.value === "first") {
    equation.textContent =
      `G(s) = ${K.toFixed(2)} / ` +
      `(${tau.toFixed(2)}s + 1)`;

    info.textContent =
      "First-order model: " +
      "tau * dy/dt + y = K * u.";

  } else {
    const numerator = K * wn * wn;
    const damping = 2 * zeta * wn;
    const stiffness = wn * wn;

    equation.textContent =
      `G(s) = ${numerator.toFixed(2)} / ` +
      `(s² + ${damping.toFixed(2)}s + ` +
      `${stiffness.toFixed(2)})`;

    info.textContent =
      "Second-order model: " +
      "y'' + 2*zeta*wn*y' + wn²*y = K*wn²*u. " +
      `ζ = ${zeta.toFixed(2)}, ` +
      `ωn = ${wn.toFixed(2)} rad/s.`;
  }
}


// ========================================
// 6. DOWNSAMPLE FOR PLOTTING
// ========================================

function sampleData(result, maxPoints = 700) {
  const stride = Math.max(
    1,
    Math.ceil(result.time.length / maxPoints)
  );

  const indices = [];

  for (
    let i = 0;
    i < result.time.length;
    i += stride
  ) {
    indices.push(i);
  }

  const last = result.time.length - 1;

  if (indices[indices.length - 1] !== last) {
    indices.push(last);
  }

  return {
    time: indices.map(i => result.time[i]),
    output: indices.map(i => result.output[i]),
    setpoint: indices.map(i => result.setpoint[i]),
    control: indices.map(i => result.control[i])
  };
}


// ========================================
// 7. RESPONSE PLOT
// ========================================

function drawResponse(result) {
  const data = [
    {
      x: result.time,
      y: result.output,
      name: "Plant output y(t)",
      type: "scatter",
      mode: "lines",
      line: {
        color: "#2563eb",
        width: 3
      }
    },
    {
      x: result.time,
      y: result.setpoint,
      name: "Setpoint r(t)",
      type: "scatter",
      mode: "lines",
      line: {
        color: "#e11d48",
        width: 2,
        dash: "dash"
      }
    }
  ];

  const layout = {
    title: "Closed-Loop Step Response",
    xaxis: {
      title: "Time (s)",
      rangemode: "tozero"
    },
    yaxis: {
      title: "Output y(t)",
      zeroline: true
    },
    margin: {
      l: 55,
      r: 20,
      t: 55,
      b: 65
    },
    legend: {
      orientation: "h",
      y: -0.3
    },
    paper_bgcolor: "#ffffff",
    plot_bgcolor: "#ffffff"
  };

  Plotly.react(
    "responsePlot",
    data,
    layout,
    {
      responsive: true,
      displaylogo: false
    }
  );
}


// ========================================
// 8. CONTROL SIGNAL PLOT
// ========================================

function drawControl(result, settings) {
  const upperLimit = result.time.map(
    () => settings.uMax
  );

  const lowerLimit = result.time.map(
    () => settings.uMin
  );

  const data = [
    {
      x: result.time,
      y: result.control,
      name: "Control signal u(t)",
      type: "scatter",
      mode: "lines",
      line: {
        color: "#16a34a",
        width: 3
      }
    },
    {
      x: result.time,
      y: upperLimit,
      name: "Upper limit",
      type: "scatter",
      mode: "lines",
      line: {
        color: "#dc2626",
        width: 2,
        dash: "dash"
      }
    },
    {
      x: result.time,
      y: lowerLimit,
      name: "Lower limit",
      type: "scatter",
      mode: "lines",
      line: {
        color: "#dc2626",
        width: 2,
        dash: "dash"
      }
    }
  ];

  const layout = {
    title: "Controller Output and Saturation",
    xaxis: {
      title: "Time (s)"
    },
    yaxis: {
      title: "Control signal u(t)"
    },
    margin: {
      l: 55,
      r: 20,
      t: 55,
      b: 65
    },
    legend: {
      orientation: "h",
      y: -0.3
    }
  };

  Plotly.react(
    "controlPlot",
    data,
    layout,
    {
      responsive: true,
      displaylogo: false
    }
  );
}


// ========================================
// 9. PERFORMANCE FORMATTING
// ========================================

function formatTime(value) {
  if (value === null || !Number.isFinite(value)) {
    return "Not reached";
  }

  return value.toFixed(3) + " s";
}

function formatPercent(value) {
  if (value === null || !Number.isFinite(value)) {
    return "Not settled";
  }

  return value.toFixed(2) + "%";
}


// ========================================
// 10. PERFORMANCE METRICS
// ========================================

function displayMetrics(metrics) {
  const isSettled = metrics.isSettled;

  document.getElementById("rise").textContent =
    isSettled
      ? formatTime(metrics.riseTime)
      : "Not settled";

  document.getElementById("overshoot").textContent =
    formatPercent(metrics.overshoot);

  document.getElementById("settling").textContent =
    isSettled
      ? formatTime(metrics.settlingTime)
      : "Not settled";

  document.getElementById("sse").textContent =
    formatPercent(metrics.steadyStateError);

  if (isSettled) {
    statusMessage.textContent =
      "Response appears stationary near the end " +
      "of the simulation. Metrics are numerical " +
      "estimates. Settling time is measured " +
      "relative to the setpoint.";

    statusMessage.style.color = "#166534";

  } else {
    statusMessage.textContent =
      "Not settled: the response is still " +
      "changing near the end of the simulation. " +
      "Final-value metrics cannot be confirmed. " +
      "Try different gains or a longer simulation.";

    statusMessage.style.color = "#b45309";
  }

  statusMessage.style.fontWeight = "600";
  statusMessage.style.marginTop = "14px";
}


// ========================================
// 11. PREDICT, THEN CHECK
// ========================================

function checkPrediction(metrics) {
  if (!lastPrediction || !predictionBaseline) {
    return;
  }

  const old = predictionBaseline;

  let correct = false;
  let comparable = true;
  let actualChange = "";

  if (!old.isSettled || !metrics.isSettled) {
    comparable = false;
    actualChange =
      "At least one response is not settled. " +
      "The prediction cannot be verified reliably.";

  } else {
    switch (lastPrediction) {

      case "faster":
      case "slower": {
        if (
          old.riseTime === null ||
          metrics.riseTime === null
        ) {
          comparable = false;
          actualChange =
            "Rise times could not be compared.";
          break;
        }

        correct = lastPrediction === "faster"
          ? metrics.riseTime < old.riseTime - 0.001
          : metrics.riseTime > old.riseTime + 0.001;

        actualChange =
          "Rise time changed from " +
          formatTime(old.riseTime) +
          " to " +
          formatTime(metrics.riseTime);

        break;
      }

      case "overshoot":
        if (
          old.overshoot === null ||
          metrics.overshoot === null
        ) {
          comparable = false;
          actualChange =
            "Overshoot could not be compared.";
          break;
        }

        correct =
          metrics.overshoot > old.overshoot + 0.01;

        actualChange =
          "Overshoot changed from " +
          formatPercent(old.overshoot) +
          " to " +
          formatPercent(metrics.overshoot);

        break;

      case "error":
        if (
          old.steadyStateError === null ||
          metrics.steadyStateError === null
        ) {
          comparable = false;
          actualChange =
            "Final errors could not be compared.";
          break;
        }

        correct =
          Math.abs(metrics.steadyStateError) <
          Math.abs(old.steadyStateError) - 0.01;

        actualChange =
          "Final error changed from " +
          formatPercent(old.steadyStateError) +
          " to " +
          formatPercent(metrics.steadyStateError);

        break;
    }
  }

  predictionFeedback.textContent =
    (comparable
      ? correct
        ? "Prediction supported! "
        : "Prediction not supported. "
      : "Inconclusive. ") +
    actualChange;

  lastPrediction = "";
  predictionBaseline = null;
  predictionInput.value = "";
}


// ========================================
// 12. MAIN SIMULATION
// ========================================

function updateSimulation() {
  updateLabels();
  updatePlantDescription();

  try {
    const settings = getSettings();

    // Full numerical simulation
    const result = simulatePID(settings);

    // Metrics from full-resolution results
    const metrics = calculateMetrics(
      result,
      settings.setpoint
    );

    // Reduced data for interactive plotting
    const sampled = sampleData(result);

    drawResponse(sampled);
    drawControl(sampled, settings);

    displayMetrics(metrics);
    checkPrediction(metrics);

    previousMetrics = metrics;

  } catch (error) {
    console.error("PID simulation error:", error);

    statusMessage.textContent =
      "Simulation error: " + error.message;

    statusMessage.style.color = "#b91c1c";

    ["rise", "overshoot", "settling", "sse"]
      .forEach(id => {
        document.getElementById(id).textContent =
          "N/A";
      });

    predictionFeedback.textContent =
      "Simulation could not be completed.";

    previousMetrics = null;
    lastPrediction = "";
    predictionBaseline = null;
    predictionInput.value = "";

    Plotly.purge("responsePlot");
    Plotly.purge("controlPlot");
  }
}


// ========================================
// 13. PREDICTION EVENT
// ========================================

predictionInput.addEventListener(
  "change",
  () => {
    lastPrediction = predictionInput.value;

    predictionBaseline = lastPrediction
      ? previousMetrics
      : null;

    predictionFeedback.textContent = lastPrediction
      ? "Now change a gain to check your prediction."
      : "";
  }
);


// ========================================
// 14. LIVE CONTROLS
// ========================================

parameterIds.forEach(id => {
  inputs[id].addEventListener(
    "input",
    updateSimulation
  );
});

limitSelect.addEventListener(
  "change",
  updateSimulation
);

plantTypeSelect.addEventListener(
  "change",
  updatePlantControls
);


// ========================================
// 15. P AND PI PRESETS
// ========================================

function applyPreset(type) {
  plantTypeSelect.value = "first";

  inputs.plantK.value = 1;
  inputs.plantTau.value = 1;

  inputs.zeta.value = 0.5;
  inputs.wn.value = 2;

  inputs.setpoint.value = 1;
  inputs.kd.value = 0;

  limitSelect.value = "100";

  if (type === "pi") {
    inputs.kp.value = 1;
    inputs.ki.value = 1;
  } else {
    inputs.kp.value = 9;
    inputs.ki.value = 0;
  }

  lastPrediction = "";
  predictionBaseline = null;
  predictionInput.value = "";
  predictionFeedback.textContent = "";

  updatePlantControls();
}


// ========================================
// 16. BUTTON EVENTS
// ========================================

document.getElementById("pOnly")
  .addEventListener("click", () => {
    applyPreset("p");
  });

document.getElementById("piPreset")
  .addEventListener("click", () => {
    applyPreset("pi");
  });

document.getElementById("reset")
  .addEventListener("click", () => {
    applyPreset("p");
  });


// ========================================
// 17. INITIALIZE
// ========================================

updatePlantControls();
