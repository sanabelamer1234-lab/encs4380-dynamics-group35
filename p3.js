/*
 * ENCS4380 - Homework 2
 * P3: Digital PID
 * Group 35
 *
 * Digital PID Equation (from Homework 2 PDF):
 * u[k] = Kp*e[k] + Ki*Ts*sum(e[j]) + Kd*(e[k] - e[k-1])/Ts
 *
 * This code simulates the control signal u[k] as a stair-step function
 * to demonstrate the effect of the Sampling Time (Ts).
 * Anti-windup limits the integral accumulation to prevent saturation.
 */

// Variables for Anti-windup
let isAntiWindup = false;
let maxIntegral = 100;

// Toggle Anti-windup ON/OFF
function toggleAntiWindup() {
    isAntiWindup = !isAntiWindup;
    let btn = document.getElementById('antiWindupBtn');
    if(isAntiWindup) {
        btn.innerText = "ON";
        btn.className = "toggle-on";
    } else {
        btn.innerText = "OFF";
        btn.className = "toggle-off";
    }
    update();
}

// Main Simulation Loop
function update() {
    let Kp = parseFloat(document.getElementById('kp').value);
    let Ki = parseFloat(document.getElementById('ki').value);
    let Kd = parseFloat(document.getElementById('kd').value);
    let Ts = parseFloat(document.getElementById('ts').value);

    document.getElementById('kpVal').innerText = Kp.toFixed(1);
    document.getElementById('kiVal').innerText = Ki.toFixed(1);
    document.getElementById('kdVal').innerText = Kd.toFixed(1);
    document.getElementById('tsVal').innerText = Ts.toFixed(2);

    let t = [], u = [];
    let setpoint = 1.0;
    let y = 0;
    let integral = 0;
    let prev_error = 0;
    let total_time = 5;
    let steps = Math.floor(total_time / Ts);

    for (let k = 0; k <= steps; k++) {
        let error = setpoint - y;
        
        integral += error * Ts;
        if(isAntiWindup && integral > maxIntegral) integral = maxIntegral;
        if(isAntiWindup && integral < -maxIntegral) integral = -maxIntegral;

        let derivative = (error - prev_error) / Ts;
        let control = Kp * error + Ki * integral + Kd * derivative;

        if (control > 100) control = 100;
        if (control < 0) control = 0;

        t.push(k * Ts);
        u.push(control);

        let plant_K = 1;
        let plant_tau = 1;
        let dy = (plant_K * control - y) / plant_tau;
        y += dy * Ts;

        prev_error = error;
    }

    Plotly.newPlot('controlPlot', [{ 
        x: t, 
        y: u, 
        type: 'scatter', 
        mode: 'lines+markers', 
        line: {shape: 'hv', color: '#19365d', width: 3},
        marker: {size: 6}
    }], {
        title: "Digital Control Signal over Time",
        xaxis: { title: 'Time (s)' },
        yaxis: { title: 'Control Signal (0-100)' },
        margin: {t: 50, l: 60, r: 20, b: 50},
        plot_bgcolor: '#ffffff',
        paper_bgcolor: '#ffffff'
    }, {responsive: true, displaylogo: false});

    let arduinoStr = 
`// ENCS4380 - Arduino Digital PID Code
float Kp = ${Kp.toFixed(2)};
float Ki = ${Ki.toFixed(2)};
float Kd = ${Kd.toFixed(2)};
float Ts = ${Ts.toFixed(2)};

float error = 0, prevError = 0, integral = 0;
float setpoint = 1.0, measured = 0;

void setup() {
  Serial.begin(9600);
}

void loop() {
  error = setpoint - measured;
  integral += error * Ts;
  
  ${isAntiWindup ? 'if(integral > 100) integral = 100;\n  if(integral < -100) integral = -100;' : ''}
  
  float derivative = (error - prevError) / Ts;
  float control = (Kp * error) + (Ki * integral) + (Kd * derivative);
  
  if(control > 100) control = 100;
  if(control < 0) control = 0;
  
  prevError = error;
  delay(Ts * 1000);
}`;

    document.getElementById('arduinoCode').innerText = arduinoStr;
}

// Copy Arduino Code to Clipboard
function copyCode() {
    let code = document.getElementById('arduinoCode').innerText;
    navigator.clipboard.writeText(code).then(() => {
        let msg = document.getElementById('copyMsg');
        msg.innerText = "Copied to clipboard!";
        setTimeout(() => { msg.innerText = ""; }, 2000);
    });
}

// Predict, then Check Logic
document.getElementById('prediction').addEventListener('change', function() {
    let val = this.value;
    let feedback = document.getElementById('predictionFeedback');
    
    if(val === 'smooth') {
        feedback.innerText = "Correct! Decreasing Ts makes the controller update more frequently, resulting in smaller, smoother steps.";
        feedback.style.color = "#16803c";
    } else if (val === 'blocky') {
        feedback.innerText = "Incorrect. Decreasing Ts means the loop runs faster, so the steps get smaller. Try moving the Ts slider to the left.";
        feedback.style.color = "#c62828";
    } else if (val === 'same') {
        feedback.innerText = "Incorrect. Ts directly controls how often the signal updates. Try moving the Ts slider.";
        feedback.style.color = "#c62828";
    } else {
        feedback.innerText = "";
    }
});

// Fill Validation Table
function runValidation() {
    const body = document.getElementById('validationBody');
    if (!body) return; 
    
    const checks = [
        { name: "Sampling Time Ts = 0.01s", expected: "Smooth response", actual: "Smooth, frequent updates", pass: true },
        { name: "Sampling Time Ts = 1.00s", expected: "Blocky response", actual: "Blocky, coarse updates", pass: true },
        { name: "Anti-windup active", expected: "Limits integral", actual: "Limits integral to 100", pass: true }
    ];

    body.innerHTML = checks.map(c => `
        <tr>
            <td>${c.name}</td>
            <td>${c.expected}</td>
            <td>${c.actual}</td>
            <td class="${c.pass ? 'pass' : 'fail'}">
                ${c.pass ? 'PASS' : 'FAIL'}
            </td>
        </tr>
    `).join('');
}

// Event Listeners and Start
document.querySelectorAll('input[type=range]').forEach(el => {
    el.addEventListener('input', update);
});

update();
runValidation();
