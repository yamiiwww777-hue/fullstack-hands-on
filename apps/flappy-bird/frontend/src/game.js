(() => {
  "use strict";

  // ---------------------------------------------------------------------
  // Backend link: window.API_BASE_URL is injected at runtime by server.js
  // from the API_BASE_URL env var set in docker-compose.yml.
  // ---------------------------------------------------------------------
  const API_BASE = (window.API_BASE_URL || "http://localhost:8000").replace(/\/$/, "");

  const DIFFICULTY = {
    easy:   { gravity: 1500, flap: -380, pipeSpeed: 130, gap: 165, spawnEvery: 1500 },
    medium: { gravity: 1700, flap: -420, pipeSpeed: 165, gap: 145, spawnEvery: 1300 },
    hard:   { gravity: 1900, flap: -460, pipeSpeed: 205, gap: 128, spawnEvery: 1100 },
  };
  const MAX_SPEED_MULT = 1.6; // difficulty ramps up the longer a run lasts (US-15/US-40)

  const STATE = { MENU: "menu", COUNTDOWN: "countdown", PLAYING: "playing", PAUSED: "paused", GAMEOVER: "gameover" };

  // ------------------------------- DOM ----------------------------------
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const el = (id) => document.getElementById(id);
  const hud = el("hud");
  const scoreEl = el("score");
  const screens = {
    menu: el("menu-screen"),
    tutorial: el("tutorial-screen"),
    countdown: el("countdown-screen"),
    pause: el("pause-screen"),
    gameover: el("gameover-screen"),
  };
  const menuHighscoreEl = el("menu-highscore");
  const leaderboardListEl = el("leaderboard-list");
  const countdownNumberEl = el("countdown-number");
  const finalScoreEl = el("final-score");
  const finalHighscoreEl = el("final-highscore");
  const newHighscoreMsgEl = el("new-highscore-msg");
  const toastEl = el("toast");

  // ----------------------------- settings --------------------------------
  const prefs = {
    sound: localStorage.getItem("flappy.sound") !== "off",
    music: localStorage.getItem("flappy.music") !== "off",
    vibration: localStorage.getItem("flappy.vibration") !== "off",
    theme: localStorage.getItem("flappy.theme") || "day",
    difficulty: localStorage.getItem("flappy.difficulty") || "medium",
    seenTutorial: localStorage.getItem("flappy.seenTutorial") === "yes",
  };
  const savePref = (key, value) => localStorage.setItem(`flappy.${key}`, value);

  // ------------------------------ audio ----------------------------------
  let audioCtx = null;
  function getAudioCtx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return audioCtx;
  }
  function beep(freq, duration, type = "sine", vol = 0.2) {
    if (!prefs.sound) return;
    try {
      const ac = getAudioCtx();
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.value = vol;
      osc.connect(gain).connect(ac.destination);
      osc.start();
      gain.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + duration);
      osc.stop(ac.currentTime + duration);
    } catch (e) { /* audio not available - fail silently */ }
  }
  const sfx = {
    flap: () => beep(520, 0.08, "square", 0.12),
    score: () => beep(880, 0.12, "triangle", 0.15),
    crash: () => beep(120, 0.35, "sawtooth", 0.2),
    ui: () => beep(660, 0.06, "sine", 0.08),
  };
  let musicOsc = null, musicGain = null;
  function startMusic() {
    if (!prefs.music || musicOsc) return;
    try {
      const ac = getAudioCtx();
      musicOsc = ac.createOscillator();
      musicGain = ac.createGain();
      musicOsc.type = "sine";
      musicOsc.frequency.value = 220;
      musicGain.gain.value = 0.02;
      musicOsc.connect(musicGain).connect(ac.destination);
      musicOsc.start();
    } catch (e) { /* ignore */ }
  }
  function stopMusic() {
    if (musicOsc) { try { musicOsc.stop(); } catch (e) {} musicOsc = null; musicGain = null; }
  }
  function vibrate(pattern) {
    if (prefs.vibration && navigator.vibrate) navigator.vibrate(pattern);
  }

  // ------------------------------ toast -----------------------------------
  let toastTimer = null;
  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.add("hidden"), 2200);
  }

  // -------------------------- backend API calls -----------------------------
  async function apiGet(path) {
    const res = await fetch(`${API_BASE}${path}`);
    if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
    return res.json();
  }
  async function apiPost(path, body) {
    const res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`POST ${path} failed: ${res.status}`);
    return res.json();
  }
  async function apiDelete(path) {
    const res = await fetch(`${API_BASE}${path}`, { method: "DELETE" });
    if (!res.ok) throw new Error(`DELETE ${path} failed: ${res.status}`);
    return res.json();
  }

  let highScore = 0;

  async function refreshHighScore() {
    try {
      const data = await apiGet("/api/highscore");
      highScore = data.high_score || 0;
    } catch (e) {
      highScore = Number(localStorage.getItem("flappy.localHighScore") || 0);
    }
    menuHighscoreEl.textContent = highScore;
  }

  async function refreshLeaderboard() {
    leaderboardListEl.innerHTML = "";
    try {
      const rows = await apiGet("/api/scores?limit=5");
      if (!rows.length) {
        leaderboardListEl.innerHTML = `<li class="muted">No scores yet — be the first!</li>`;
        return;
      }
      for (const row of rows) {
        const li = document.createElement("li");
        li.innerHTML = `<span>${escapeHtml(row.name)}</span><span>${row.score}</span>`;
        leaderboardListEl.appendChild(li);
      }
    } catch (e) {
      leaderboardListEl.innerHTML = `<li class="muted">Backend unavailable — playing offline.</li>`;
    }
  }

  async function submitScore(score) {
    try {
      const result = await apiPost("/api/scores", { name: "Player", score, difficulty: prefs.difficulty });
      highScore = result.high_score;
      return result.is_new_high_score;
    } catch (e) {
      const local = Number(localStorage.getItem("flappy.localHighScore") || 0);
      const isNew = score > local;
      if (isNew) localStorage.setItem("flappy.localHighScore", score);
      highScore = Math.max(local, score);
      return isNew;
    }
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // ------------------------------- canvas sizing ---------------------------
  const BASE_W = 400, BASE_H = 600;
  function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = BASE_W * dpr;
    canvas.height = BASE_H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener("resize", resizeCanvas);
  resizeCanvas();

  // ------------------------------- game entities ---------------------------
  const GROUND_H = 70;

  function freshGameState() {
    const cfg = DIFFICULTY[prefs.difficulty];
    return {
      bird: { x: 90, y: BASE_H / 2, vy: 0, radius: 14, rotation: 0 },
      pipes: [], // {x, gapY, gapSize, passed}
      groundOffset: 0,
      cloudOffset: 0,
      elapsed: 0,
      spawnTimer: 0,
      score: 0,
      cfg,
    };
  }

  let game = freshGameState();
  let state = STATE.MENU;
  let lastTime = performance.now();
  let flapPulse = 0; // for wing animation

  function currentSpeedMultiplier() {
    return 1 + Math.min(MAX_SPEED_MULT - 1, game.elapsed / 45); // ramps over ~45s
  }

  function flap() {
    if (state !== STATE.PLAYING) return;
    game.bird.vy = game.cfg.flap;
    flapPulse = 1;
    sfx.flap();
    vibrate(10);
  }

  function spawnPipe() {
    const margin = 60;
    const gapSize = game.cfg.gap;
    const gapY = margin + Math.random() * (BASE_H - GROUND_H - margin * 2 - gapSize);
    game.pipes.push({ x: BASE_W + 30, gapY, gapSize, passed: false, width: 52 });
  }

  function update(dt) {
    game.elapsed += dt;
    const speedMult = currentSpeedMultiplier();

    // bird physics
    const b = game.bird;
    b.vy += game.cfg.gravity * dt;
    b.y += b.vy * dt;
    b.rotation = Math.max(-0.5, Math.min(1.1, b.vy / 500));
    if (flapPulse > 0) flapPulse = Math.max(0, flapPulse - dt * 6);

    // scrolling
    game.groundOffset = (game.groundOffset + game.cfg.pipeSpeed * speedMult * dt) % 40;
    game.cloudOffset = (game.cloudOffset + 12 * dt) % BASE_W;

    // pipes
    game.spawnTimer -= dt * 1000;
    if (game.spawnTimer <= 0) {
      spawnPipe();
      game.spawnTimer = game.cfg.spawnEvery / speedMult;
    }
    for (const p of game.pipes) {
      p.x -= game.cfg.pipeSpeed * speedMult * dt;
      if (!p.passed && p.x + p.width < b.x - b.radius) {
        p.passed = true;
        game.score += 1;
        scoreEl.textContent = game.score;
        sfx.score();
      }
    }
    game.pipes = game.pipes.filter((p) => p.x > -80);

    // collisions
    if (b.y + b.radius >= BASE_H - GROUND_H || b.y - b.radius <= 0) {
      return endGame();
    }
    for (const p of game.pipes) {
      const withinX = b.x + b.radius > p.x && b.x - b.radius < p.x + p.width;
      if (!withinX) continue;
      const withinGap = b.y - b.radius > p.gapY && b.y + b.radius < p.gapY + p.gapSize;
      if (!withinGap) return endGame();
    }
  }

  // ------------------------------- drawing ----------------------------------
  function draw() {
    const night = prefs.theme === "night";
    const sky = night ? ["#0a1128", "#1b2a4a"] : ["#4ec0ca", "#7fd6de"];
    const g = ctx.createLinearGradient(0, 0, 0, BASE_H);
    g.addColorStop(0, sky[0]);
    g.addColorStop(1, sky[1]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, BASE_W, BASE_H);

    // clouds
    ctx.fillStyle = night ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.85)";
    drawCloudRow(60, 0.6, 34);
    drawCloudRow(140, 1.0, 26);

    if (night) {
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      for (let i = 0; i < 18; i++) {
        const sx = (i * 53 + 20) % BASE_W;
        const sy = (i * 97 + 10) % 220;
        ctx.fillRect(sx, sy, 2, 2);
      }
    }

    // pipes
    for (const p of game.pipes) drawPipe(p, night);

    // ground
    drawGround(night);

    // bird
    drawBird(night);
  }

  function drawCloudRow(y, speedMult, size) {
    const offset = (game.cloudOffset * speedMult) % (BASE_W + 120);
    for (let i = -1; i < 3; i++) {
      const x = i * 160 - offset;
      ellipseCluster(x, y, size);
    }
  }
  function ellipseCluster(x, y, size) {
    ctx.beginPath();
    ctx.ellipse(x, y, size, size * 0.6, 0, 0, Math.PI * 2);
    ctx.ellipse(x + size * 0.7, y + 4, size * 0.7, size * 0.5, 0, 0, Math.PI * 2);
    ctx.ellipse(x - size * 0.7, y + 6, size * 0.6, size * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawPipe(p, night) {
    const bodyColor = night ? "#2f7a4f" : "#4caf50";
    const edgeColor = night ? "#1f5636" : "#357a38";
    const topH = p.gapY;
    const bottomY = p.gapY + p.gapSize;
    const bottomH = BASE_H - GROUND_H - bottomY;

    ctx.fillStyle = bodyColor;
    ctx.fillRect(p.x, 0, p.width, topH);
    ctx.fillRect(p.x, bottomY, p.width, bottomH);

    ctx.fillStyle = edgeColor;
    ctx.fillRect(p.x - 4, topH - 18, p.width + 8, 18);
    ctx.fillRect(p.x - 4, bottomY, p.width + 8, 18);
  }

  function drawGround(night) {
    const y = BASE_H - GROUND_H;
    ctx.fillStyle = night ? "#3a2f1c" : "#ded18f";
    ctx.fillRect(0, y, BASE_W, GROUND_H);
    ctx.fillStyle = night ? "#2a2113" : "#c9b968";
    ctx.fillRect(0, y, BASE_W, 8);

    ctx.fillStyle = night ? "#4a3d24" : "#c2b46a";
    for (let x = -40; x < BASE_W + 40; x += 40) {
      const sx = ((x - game.groundOffset) % (BASE_W + 40));
      ctx.fillRect(sx, y + 18, 20, 6);
    }
  }

  function drawBird(night) {
    const b = game.bird;
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(b.rotation);

    // body
    ctx.fillStyle = "#ffcd3c";
    ctx.beginPath();
    ctx.ellipse(0, 0, b.radius, b.radius * 0.85, 0, 0, Math.PI * 2);
    ctx.fill();

    // wing (animated on flap)
    const wingLift = -6 - flapPulse * 10;
    ctx.fillStyle = "#f2a627";
    ctx.beginPath();
    ctx.ellipse(-3, wingLift * -0.2 + 3, 8, 5, -0.3 - flapPulse * 0.6, 0, Math.PI * 2);
    ctx.fill();

    // eye
    ctx.fillStyle = "#3a2a00";
    ctx.beginPath();
    ctx.arc(6, -4, 2.2, 0, Math.PI * 2);
    ctx.fill();

    // beak
    ctx.fillStyle = "#ff7a3c";
    ctx.beginPath();
    ctx.moveTo(b.radius - 2, -2);
    ctx.lineTo(b.radius + 8, 1);
    ctx.lineTo(b.radius - 2, 5);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  // ------------------------------- loop ----------------------------------
  function loop(now) {
    const dt = Math.min(0.033, (now - lastTime) / 1000);
    lastTime = now;
    if (state === STATE.PLAYING) update(dt);
    draw();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame((t) => { lastTime = t; requestAnimationFrame(loop); });

  // ------------------------------- state transitions ----------------------
  function showScreen(name) {
    for (const key of Object.keys(screens)) screens[key].classList.add("hidden");
    if (name) screens[name].classList.remove("hidden");
  }

  function goToMenu() {
    state = STATE.MENU;
    stopMusic();
    hud.classList.add("hidden");
    showScreen("menu");
    refreshHighScore();
    refreshLeaderboard();
  }

  function beginCountdown() {
    if (!prefs.seenTutorial) return showTutorial(beginCountdown);
    state = STATE.COUNTDOWN;
    showScreen("countdown");
    let n = 3;
    countdownNumberEl.textContent = n;
    const iv = setInterval(() => {
      n -= 1;
      if (n <= 0) {
        clearInterval(iv);
        startPlaying();
      } else {
        countdownNumberEl.textContent = n;
        sfx.ui();
      }
    }, 600);
  }

  function showTutorial(onClose) {
    showScreen("tutorial");
    const handler = () => {
      prefs.seenTutorial = true;
      savePref("seenTutorial", "yes");
      el("tutorial-close-btn").removeEventListener("click", handler);
      onClose();
    };
    el("tutorial-close-btn").addEventListener("click", handler);
  }

  function startPlaying() {
    game = freshGameState();
    scoreEl.textContent = "0";
    state = STATE.PLAYING;
    hud.classList.remove("hidden");
    showScreen(null);
    startMusic();
  }

  function togglePause() {
    if (state === STATE.PLAYING) {
      state = STATE.PAUSED;
      showScreen("pause");
    } else if (state === STATE.PAUSED) {
      state = STATE.PLAYING;
      showScreen(null);
    }
  }

  async function endGame() {
    state = STATE.GAMEOVER;
    stopMusic();
    sfx.crash();
    vibrate([30, 40, 30]);
    hud.classList.add("hidden");
    finalScoreEl.textContent = game.score;
    const isNewHighScore = await submitScore(game.score);
    finalHighscoreEl.textContent = highScore;
    newHighscoreMsgEl.classList.toggle("hidden", !isNewHighScore);
    showScreen("gameover");
  }

  // ------------------------------- input -----------------------------------
  function handlePrimaryInput(e) {
    if (e.target.closest("button")) return; // let buttons handle their own clicks
    if (state === STATE.PLAYING) flap();
  }
  canvas.addEventListener("mousedown", handlePrimaryInput);
  canvas.addEventListener("touchstart", (e) => { e.preventDefault(); handlePrimaryInput(e); }, { passive: false });
  document.getElementById("game-wrap").addEventListener("click", handlePrimaryInput);

  window.addEventListener("keydown", (e) => {
    if (e.code === "Space") {
      e.preventDefault();
      if (state === STATE.PLAYING) flap();
      else if (state === STATE.MENU) beginCountdown();
    }
    if (e.code === "Escape" && (state === STATE.PLAYING || state === STATE.PAUSED)) togglePause();
  });

  // menu buttons
  el("start-btn").addEventListener("click", () => { sfx.ui(); beginCountdown(); });
  el("how-to-play-btn").addEventListener("click", () => { sfx.ui(); showTutorial(goToMenu); });
  document.querySelectorAll(".diff-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".diff-btn").forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");
      prefs.difficulty = btn.dataset.diff;
      savePref("difficulty", prefs.difficulty);
      sfx.ui();
    });
  });
  document.querySelector(`.diff-btn[data-diff="${prefs.difficulty}"]`)?.classList.add("selected");

  // pause / resume
  el("pause-btn").addEventListener("click", (e) => { e.stopPropagation(); togglePause(); });
  el("resume-btn").addEventListener("click", togglePause);
  el("pause-menu-btn").addEventListener("click", goToMenu);

  // game over
  el("retry-btn").addEventListener("click", () => { sfx.ui(); beginCountdown(); });
  el("gameover-menu-btn").addEventListener("click", goToMenu);
  el("share-btn").addEventListener("click", async () => {
    const text = `I scored ${game.score} in Flappy Byte! Can you beat me?`;
    if (navigator.share) {
      try { await navigator.share({ text, title: "Flappy Byte" }); } catch (e) {}
    } else {
      try {
        await navigator.clipboard.writeText(text);
        showToast("Score copied to clipboard!");
      } catch (e) {
        showToast(text);
      }
    }
  });

  // settings toggles
  function syncToggleButton(btnId, isOn, onIcon, offIcon) {
    const btn = el(btnId);
    btn.textContent = isOn ? onIcon : offIcon;
    btn.classList.toggle("off", !isOn);
  }
  syncToggleButton("sound-toggle", prefs.sound, "🔊", "🔇");
  syncToggleButton("music-toggle", prefs.music, "🎵", "🚫");
  syncToggleButton("vibration-toggle", prefs.vibration, "📳", "🚷");
  syncToggleButton("theme-toggle", prefs.theme === "day", "☀️", "🌙");

  el("sound-toggle").addEventListener("click", () => {
    prefs.sound = !prefs.sound; savePref("sound", prefs.sound ? "on" : "off");
    syncToggleButton("sound-toggle", prefs.sound, "🔊", "🔇");
    if (prefs.sound) sfx.ui();
  });
  el("music-toggle").addEventListener("click", () => {
    prefs.music = !prefs.music; savePref("music", prefs.music ? "on" : "off");
    syncToggleButton("music-toggle", prefs.music, "🎵", "🚫");
    if (prefs.music && state === STATE.PLAYING) startMusic(); else stopMusic();
  });
  el("vibration-toggle").addEventListener("click", () => {
    prefs.vibration = !prefs.vibration; savePref("vibration", prefs.vibration ? "on" : "off");
    syncToggleButton("vibration-toggle", prefs.vibration, "📳", "🚷");
  });
  el("theme-toggle").addEventListener("click", () => {
    prefs.theme = prefs.theme === "day" ? "night" : "day";
    savePref("theme", prefs.theme);
    syncToggleButton("theme-toggle", prefs.theme === "day", "☀️", "🌙");
  });
  el("reset-highscore-btn").addEventListener("click", async () => {
    if (!confirm("Reset your saved high score and leaderboard?")) return;
    try {
      await apiDelete("/api/scores");
    } catch (e) { /* ignore, still clear local fallback */ }
    localStorage.removeItem("flappy.localHighScore");
    highScore = 0;
    showToast("High score reset");
    refreshHighScore();
    refreshLeaderboard();
  });

  // ------------------------------- boot ------------------------------------
  goToMenu();
})();
