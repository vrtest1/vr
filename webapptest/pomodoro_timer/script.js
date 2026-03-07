const WORK_TIME_SEC = 30 * 60; // 30 minutes
const BREAK_TIME_SEC = 5 * 60;  // 5 minutes

let timeLeft = WORK_TIME_SEC;
let isRunning = false;
let isWorkMode = true;
let timerId = null;
let cycles = 0;
let volumeLevel = 2; // 2=High, 1=Low, 0=Mute

const timeDisplay = document.getElementById('time-left');
const modeText = document.getElementById('mode-text');
const btnStart = document.getElementById('btn-start');
const btnReset = document.getElementById('btn-reset');
const btnVolume = document.getElementById('btn-volume');
const cycleCount = document.getElementById('cycle-count');
const circle = document.querySelector('.progress-ring__circle');

// Get the actual radius and calculate circumference
const radius = circle.r.baseVal.value;
const circumference = radius * 2 * Math.PI;

circle.style.strokeDasharray = `${circumference} ${circumference}`;
circle.style.strokeDashoffset = 0;

function setProgress(percent) {
    const offset = circumference - (percent / 100) * circumference;
    circle.style.strokeDashoffset = offset;
}

function updateDisplay() {
    const minutes = Math.floor(timeLeft / 60);
    const seconds = timeLeft % 60;
    timeDisplay.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

    // Update document title for background tracking
    document.title = `${timeDisplay.textContent} - ${isWorkMode ? '作業集中 📚' : '休憩 🌱'}`;

    const totalTime = isWorkMode ? WORK_TIME_SEC : BREAK_TIME_SEC;
    const progress = (timeLeft / totalTime) * 100;
    setProgress(progress);
}

let currentAudioCtx = null;

function playChime() {
    if (volumeLevel === 0) return;

    try {
        if (currentAudioCtx) {
            currentAudioCtx.close(); // Stop any currently playing chime
        }

        currentAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const ctx = currentAudioCtx;

        // Frequencies for C Major:
        // C4 = 261.63 (Do)
        // D4 = 293.66 (Re)
        // E4 = 329.63 (Mi)
        // G3 = 196.00 (Sol low) or G4 = 392.00 (Sol high)
        // We will use G3 for the low Sol to match the traditional chime contour
        const do_c = 261.63;
        const re_d = 293.66;
        const mi_e = 329.63;
        const sol_g = 196.00; // Low G

        const notes = [
            // ドーミーレーソー (Do - Mi - Re - Sol)
            { freq: do_c, time: 0.0 },
            { freq: mi_e, time: 0.5 },
            { freq: re_d, time: 1.0 },
            { freq: sol_g, time: 1.5 },

            // ソーレーミードー (Sol - Re - Mi - Do)
            { freq: sol_g, time: 2.5 },
            { freq: re_d, time: 3.0 },
            { freq: mi_e, time: 3.5 },
            { freq: do_c, time: 4.0 },

            // ミードーレーソー (Mi - Do - Re - Sol)
            { freq: mi_e, time: 5.0 },
            { freq: do_c, time: 5.5 },
            { freq: re_d, time: 6.0 },
            { freq: sol_g, time: 6.5 },

            // ソーレーミードー (Sol - Re - Mi - Do)
            { freq: sol_g, time: 7.5 },
            { freq: re_d, time: 8.0 },
            { freq: mi_e, time: 8.5 },
            { freq: do_c, time: 9.0 }
        ];

        const baseVol = volumeLevel === 2 ? 0.8 : 0.3;

        notes.forEach(note => {
            // Main oscillator (fundamental frequency)
            const osc = ctx.createOscillator();
            const gainNode = ctx.createGain();

            // Overtone oscillator for brighter, richer bell sound
            const osc2 = ctx.createOscillator();
            const gainNode2 = ctx.createGain();

            // Using triangle and sine waves mixed together creates a brighter, more chime-like timbre
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(note.freq, ctx.currentTime + note.time);

            osc2.type = 'sine';
            // True bells have overtones that are not perfect harmonics. 
            // Multiplying by ~2.01 or 2.4 adds a slightly metallic, bright characteristic.
            osc2.frequency.setValueAtTime(note.freq * 2.01, ctx.currentTime + note.time);

            // Bell envelope: sharp attack, long exponential decay
            gainNode.gain.setValueAtTime(0, ctx.currentTime + note.time);
            gainNode.gain.linearRampToValueAtTime(baseVol * 0.7, ctx.currentTime + note.time + 0.02);
            gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + note.time + 1.5);

            gainNode2.gain.setValueAtTime(0, ctx.currentTime + note.time);
            gainNode2.gain.linearRampToValueAtTime(baseVol * 0.3, ctx.currentTime + note.time + 0.01);
            gainNode2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + note.time + 1.0);

            osc.connect(gainNode);
            osc2.connect(gainNode2);

            gainNode.connect(ctx.destination);
            gainNode2.connect(ctx.destination);

            osc.start(ctx.currentTime + note.time);
            osc2.start(ctx.currentTime + note.time);

            osc.stop(ctx.currentTime + note.time + 2.0);
            osc2.stop(ctx.currentTime + note.time + 2.0);
        });

        if (isLoud) {
            // Add a loud buzzer sound at the end of the sequence (starts around 10.5s after chime decay)
            const buzzerStart = 10.5;
            // Retro arcade-style completion chime (major arpeggio)
            const buzzerVol = volumeLevel === 2 ? 1.5 : 0.6; // Significantly louder

            const retroNotes = [
                { f: 440.00, t: 0 },    // A4
                { f: 554.37, t: 0.15 }, // C#5
                { f: 659.25, t: 0.3 },  // E5
                { f: 880.00, t: 0.45 }  // A5
            ];

            retroNotes.forEach(n => {
                const bOsc = ctx.createOscillator();
                const bGain = ctx.createGain();

                bOsc.type = 'triangle'; // Sharper retro sound (triangle wave)
                bOsc.frequency.setValueAtTime(n.f, ctx.currentTime + buzzerStart + n.t);

                bGain.gain.setValueAtTime(0, ctx.currentTime + buzzerStart + n.t);
                bGain.gain.linearRampToValueAtTime(buzzerVol, ctx.currentTime + buzzerStart + n.t + 0.05);
                bGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + buzzerStart + n.t + 0.4);

                bOsc.connect(bGain);
                bGain.connect(ctx.destination);

                bOsc.start(ctx.currentTime + buzzerStart + n.t);
                bOsc.stop(ctx.currentTime + buzzerStart + n.t + 0.5);
            });
        }

    } catch (e) {
        console.log("Audio not supported or blocked");
    }
}

// --- PWA & Notification Setup ---
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch(err => {
            console.log('ServiceWorker registration failed: ', err);
        });
    });
}

function requestNotificationPermission() {
    if (!('Notification' in window)) {
        console.log("This browser does not support desktop notification");
        return;
    }

    if (Notification.permission === 'default' || Notification.permission === 'prompt') {
        Notification.requestPermission().then((permission) => {
            console.log('Notification permission:', permission);
        }).catch((err) => {
            console.log('Notification permission error:', err);
        });
    }
}

function triggerSystemNotification(title, body) {
    // Vibrate (works on Android Chrome)
    if ('vibrate' in navigator && volumeLevel > 0) {
        navigator.vibrate([200, 100, 200]);
    }

    // System Notification (works on PWA / desktop if permitted)
    if ('Notification' in window && Notification.permission === 'granted') {
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.ready.then(function (registration) {
                registration.showNotification(title, {
                    body: body,
                    icon: './favicon.ico' // fallback icon
                });
            }).catch(function (err) {
                console.log("SW notification failed, falling back to window.Notification", err);
                new Notification(title, { body: body, icon: './favicon.ico' });
            });
        } else {
            new Notification(title, { body: body, icon: './favicon.ico' });
        }
    }
}
// ------------------------------

let targetTime = 0; // Timestamp when the current timer should end

// --- Screen Wake Lock Setup ---
let wakeLock = null;

async function requestWakeLock() {
    try {
        if ('wakeLock' in navigator) {
            wakeLock = await navigator.wakeLock.request('screen');
            console.log('Wake Lock is active');

            wakeLock.addEventListener('release', () => {
                console.log('Wake Lock was released');
            });
        }
    } catch (err) {
        console.error(`${err.name}, ${err.message}`);
    }
}

function releaseWakeLock() {
    if (wakeLock !== null) {
        wakeLock.release();
        wakeLock = null;
    }
}
// ------------------------------

function switchMode() {
    playChime();
    isWorkMode = !isWorkMode;

    if (isWorkMode) {
        cycles++;
        cycleCount.textContent = cycles;
        timeLeft = WORK_TIME_SEC;
        modeText.textContent = "📚 作業集中 (30分)";
        document.body.classList.remove('break-mode');
        triggerSystemNotification("作業集中 📚", "30分の作業時間です！");
    } else {
        timeLeft = BREAK_TIME_SEC;
        modeText.textContent = "🌱 休憩タイム (5分)";
        document.body.classList.add('break-mode');
        triggerSystemNotification("休憩タイム 🌱", "5分間の休憩です！");
    }

    if (isRunning) {
        targetTime = Date.now() + (timeLeft * 1000);
    }

    // Briefly disable animation to prevent circle spinning backwards
    circle.style.transition = 'none';
    setProgress(100);
    setTimeout(() => {
        circle.style.transition = 'stroke-dashoffset 1s linear, stroke 0.5s ease';
        updateDisplay();
    }, 50);
}

function tick() {
    if (!isRunning) return;

    const now = Date.now();
    const remainingMs = targetTime - now;

    if (remainingMs > 0) {
        // Calculate remaining seconds, always rounding up so it shows "00:01" until the last millisecond
        timeLeft = Math.ceil(remainingMs / 1000);
        updateDisplay();
    } else {
        // Timer finished
        timeLeft = 0;
        updateDisplay();
        switchMode();
    }
}

function toggleTimer() {
    requestNotificationPermission(); // Ask for permission on first interaction

    if (isRunning) {
        clearInterval(timerId);
        btnStart.textContent = 'Resume';
        isRunning = false;
        releaseWakeLock(); // Let screen sleep when paused
        // timeLeft represents how much time is left when paused.
    } else {
        if (timeLeft <= 0) {
            switchMode();
        }
        // Calculate exactly when this timer will end based on real-world time
        targetTime = Date.now() + (timeLeft * 1000);

        timerId = setInterval(tick, 200); // Check more frequently (5 times a second) for precision
        btnStart.textContent = 'Pause';
        isRunning = true;
        requestWakeLock(); // Keep screen on while running
    }
}

function resetTimer() {
    clearInterval(timerId);
    isRunning = false;
    releaseWakeLock(); // Let screen sleep
    isWorkMode = true;
    timeLeft = WORK_TIME_SEC;
    cycles = 0;

    cycleCount.textContent = cycles;
    modeText.textContent = "📚 作業集中 (30分)";
    btnStart.textContent = 'Start';
    document.body.classList.remove('break-mode');

    circle.style.transition = 'none';
    updateDisplay();
    setTimeout(() => {
        circle.style.transition = 'stroke-dashoffset 1s linear, stroke 0.5s ease';
    }, 50);
}

// When the user switches back to the app from another app or waking up the phone,
// immediately force an update so they don't see stale times
document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === 'visible') {
        if (isRunning) {
            tick();
            requestWakeLock(); // re-request lock if it was lost while hidden
        }
    }
});

const btnPlus = document.getElementById('btn-plus');
const btnMinus = document.getElementById('btn-minus');
const btnLoud = document.getElementById('btn-loud');

let isLoud = true;
btnLoud.checked = true; // Use checked property for checkbox

function adjustTime(seconds) {
    if (isRunning) return; // Prevent adjustment while running

    timeLeft += seconds;

    // Limits
    const totalTime = isWorkMode ? WORK_TIME_SEC : BREAK_TIME_SEC;
    if (timeLeft < 0) timeLeft = 0;
    if (timeLeft > totalTime) timeLeft = totalTime;

    updateDisplay();
}

function toggleVolume() {
    volumeLevel = volumeLevel - 1;
    if (volumeLevel < 0) volumeLevel = 2; // Default to max (2)

    if (volumeLevel === 2) {
        btnVolume.textContent = '🔊';
    } else if (volumeLevel === 1) {
        btnVolume.textContent = '🔉';
    } else {
        btnVolume.textContent = '🔇';
        // Immediately stop any playing sounds
        if (currentAudioCtx) {
            currentAudioCtx.close();
        }
    }

    if (volumeLevel > 0) {
        playChime();
    }
}

function toggleLoud() {
    isLoud = btnLoud.checked; // Sync with checkbox state

    if (isLoud) {
        if (volumeLevel > 0) {
            // Play preview of the retro chime
            try {
                const ctx = new (window.AudioContext || window.webkitAudioContext)();
                const buzzerVol = volumeLevel === 2 ? 1.5 : 0.6;

                const retroNotes = [
                    { f: 440.00, t: 0 },
                    { f: 554.37, t: 0.15 },
                    { f: 659.25, t: 0.3 },
                    { f: 880.00, t: 0.45 }
                ];

                retroNotes.forEach(n => {
                    const bOsc = ctx.createOscillator();
                    const bGain = ctx.createGain();

                    bOsc.type = 'triangle'; // Sharper retro sound
                    bOsc.frequency.setValueAtTime(n.f, ctx.currentTime + n.t);

                    bGain.gain.setValueAtTime(0, ctx.currentTime + n.t);
                    bGain.gain.linearRampToValueAtTime(buzzerVol, ctx.currentTime + n.t + 0.05);
                    bGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + n.t + 0.4);

                    bOsc.connect(bGain);
                    bGain.connect(ctx.destination);

                    bOsc.start(ctx.currentTime + n.t);
                    bOsc.stop(ctx.currentTime + n.t + 0.5);
                });
            } catch (e) { }
        }
    }
}

const btnSkip = document.getElementById('btn-skip');

function skipMode() {
    if (isRunning) {
        clearInterval(timerId);
        btnStart.textContent = 'Start';
        isRunning = false;
    }
    // Set time to 0 to force next mode immediately
    timeLeft = 0;
    switchMode();
}

btnStart.addEventListener('click', toggleTimer);
btnReset.addEventListener('click', resetTimer);
btnSkip.addEventListener('click', skipMode);
btnPlus.addEventListener('click', () => adjustTime(60));
btnMinus.addEventListener('click', () => adjustTime(-60));
btnVolume.addEventListener('click', toggleVolume);
btnLoud.addEventListener('change', toggleLoud);

// Initialize
updateDisplay();
