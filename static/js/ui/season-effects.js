// Copyright (c) 2026 Jamal2367
// Licensed under the MIT License. See LICENSE file in the project root for full license information.

/**
 * What falls through the page while a season is picked: snow at Christmas,
 * pumpkins and bats at Halloween.
 *
 * Dozens of small shapes that move every frame, which is one canvas and one
 * loop - drawn here rather than loaded, so there is no request and no image to
 * scale. Where the canvas sits is in chrome.css.
 *
 * A season belongs to no theme: the adaptive one also leans its covers towards
 * it (see ui/cover-gradient.js), but the layer below falls on every theme. It
 * does not run while the tab is in the background or while the visitor has
 * asked for reduced motion, though - this is decoration, and decoration is the
 * first thing that should get out of the way.
 */

// How many particles the air holds, per million square pixels of viewport, and
// the ceiling for a very large window. A 1440x900 desktop lands at around 60.
const DENSITY = 48e-6;
const MAX_PARTICLES = 110;

// A frame longer than this is a tab coming back or a stalled main thread; the
// particles would jump a screen further rather than carry on where they were.
const MAX_FRAME = 0.05;

const SEASONS = {
    christmas: {
        kinds: [
            { draw: drawSnowflake, weight: 1, size: [1.4, 4.6], fall: [16, 42], sway: [8, 26], spin: [-0.4, 0.4] }
        ],
        // Snow drifts sideways as a body, so the whole fall leans a little.
        wind: 9
    },
    halloween: {
        kinds: [
            { draw: drawPumpkin, weight: 0.45, size: [5, 11], fall: [22, 48], sway: [10, 30], spin: [-1.4, 1.4] },
            { draw: drawBat, weight: 0.55, size: [6, 12], fall: [26, 60], sway: [26, 70], spin: [-0.25, 0.25] }
        ],
        wind: -14
    }
};

/* ============================================================
   What falls
   ============================================================ */

const random = (min, max) => min + Math.random() * (max - min);

function pickKind(season) {
    let roll = Math.random() * season.kinds.reduce((sum, kind) => sum + kind.weight, 0);
    for (const kind of season.kinds) {
        roll -= kind.weight;
        if (roll <= 0) return kind;
    }
    return season.kinds[season.kinds.length - 1];
}

function spawn(season, width, height, fromTop) {
    const kind = pickKind(season);
    return {
        kind,
        x: random(-40, width + 40),
        // At start-up the air is already full, so the first frame is not an
        // empty page with a line of snow arriving at the top edge.
        y: fromTop ? random(-height * 0.4, -10) : random(-20, height),
        size: random(kind.size[0], kind.size[1]),
        fall: random(kind.fall[0], kind.fall[1]),
        sway: random(kind.sway[0], kind.sway[1]),
        swayRate: random(0.3, 0.9),
        spin: random(kind.spin[0], kind.spin[1]),
        angle: random(0, Math.PI * 2),
        phase: random(0, Math.PI * 2),
        alpha: random(0.45, 0.9)
    };
}

function drawSnowflake(ctx, particle) {
    const size = particle.size;
    ctx.fillStyle = '#e8f2ff';
    if (size < 2.6) {
        ctx.beginPath();
        ctx.arc(0, 0, size, 0, Math.PI * 2);
        ctx.fill();
        return;
    }
    ctx.strokeStyle = '#e8f2ff';
    ctx.lineWidth = Math.max(1, size * 0.26);
    ctx.lineCap = 'round';
    for (let spoke = 0; spoke < 3; spoke++) {
        ctx.beginPath();
        ctx.moveTo(-size, 0);
        ctx.lineTo(size, 0);
        ctx.stroke();
        ctx.rotate(Math.PI / 3);
    }
}

function drawPumpkin(ctx, particle) {
    const size = particle.size;
    ctx.fillStyle = '#e8721c';
    ctx.beginPath();
    ctx.ellipse(0, 0, size, size * 0.86, 0, 0, Math.PI * 2);
    ctx.fill();
    // The ridges, as two darker lobes rather than drawn lines - at this size a
    // line is a pixel that flickers while the pumpkin turns.
    ctx.fillStyle = '#c8570f';
    ctx.beginPath();
    ctx.ellipse(-size * 0.48, 0, size * 0.28, size * 0.8, 0, 0, Math.PI * 2);
    ctx.ellipse(size * 0.48, 0, size * 0.28, size * 0.8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#3f7d20';
    ctx.lineWidth = Math.max(1.2, size * 0.2);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, -size * 0.78);
    ctx.lineTo(size * 0.1, -size * 1.28);
    ctx.stroke();

    // Only the bigger ones are lanterns; below that a face is three dark
    // smudges.
    if (size < 8) return;
    ctx.fillStyle = '#ffd166';
    ctx.beginPath();
    ctx.moveTo(-size * 0.5, -size * 0.15);
    ctx.lineTo(-size * 0.18, -size * 0.15);
    ctx.lineTo(-size * 0.34, -size * 0.5);
    ctx.moveTo(size * 0.5, -size * 0.15);
    ctx.lineTo(size * 0.18, -size * 0.15);
    ctx.lineTo(size * 0.34, -size * 0.5);
    ctx.moveTo(-size * 0.45, size * 0.25);
    ctx.lineTo(size * 0.45, size * 0.25);
    ctx.lineTo(size * 0.25, size * 0.55);
    ctx.lineTo(-size * 0.25, size * 0.55);
    ctx.fill();
}

function drawBat(ctx, particle) {
    const size = particle.size;
    // The wings beat rather than the whole bat turning, so the flap is a
    // curve's control point moving up and down.
    const flap = Math.sin(particle.phase * 3) * size * 0.7;
    ctx.fillStyle = '#4a3566';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(-size * 0.7, -flap - size * 0.2, -size * 1.6, flap * 0.4);
    ctx.quadraticCurveTo(-size * 0.9, size * 0.25, 0, size * 0.35);
    ctx.quadraticCurveTo(size * 0.9, size * 0.25, size * 1.6, flap * 0.4);
    ctx.quadraticCurveTo(size * 0.7, -flap - size * 0.2, 0, 0);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(0, size * 0.1, size * 0.3, size * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();
    // Ears, which are what tells it from a moth at this size.
    ctx.beginPath();
    ctx.moveTo(-size * 0.26, -size * 0.2);
    ctx.lineTo(-size * 0.1, -size * 0.62);
    ctx.lineTo(0, -size * 0.22);
    ctx.lineTo(size * 0.1, -size * 0.62);
    ctx.lineTo(size * 0.26, -size * 0.2);
    ctx.fill();
}

/* ============================================================
   The layer
   ============================================================ */

let canvas = null;
let context = null;
let particles = [];
let season = null;
let frame = 0;
let lastTime = 0;
let viewport = { width: 0, height: 0 };

const reducedMotion = window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : { matches: false, addEventListener: () => {} };

function currentSeasonName() {
    const name = document.documentElement.getAttribute('data-cover-season');
    return SEASONS[name] ? name : null;
}

function sizeCanvas() {
    if (!canvas) return;
    // A canvas has two sizes: the box it occupies and the pixels it holds. On a
    // phone those differ by the device ratio, and a canvas given only the first
    // draws everything twice as coarse as the page around it.
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    viewport = { width: window.innerWidth, height: window.innerHeight };
    canvas.width = Math.round(viewport.width * ratio);
    canvas.height = Math.round(viewport.height * ratio);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
}

function fill(fromTop) {
    const count = Math.min(MAX_PARTICLES,
        Math.round(viewport.width * viewport.height * DENSITY));
    particles = [];
    for (let i = 0; i < count; i++) particles.push(spawn(season, viewport.width, viewport.height, fromTop));
}

function step(time) {
    frame = requestAnimationFrame(step);
    const delta = Math.min((time - lastTime) / 1000, MAX_FRAME);
    lastTime = time;
    if (delta <= 0) return;

    context.clearRect(0, 0, viewport.width, viewport.height);
    const seconds = time / 1000;

    for (const particle of particles) {
        particle.y += particle.fall * delta;
        particle.phase += delta;
        particle.angle += particle.spin * delta;
        // Sideways it is a wave rather than a line: everything falling straight
        // down at its own speed reads as rain.
        const drift = Math.sin(seconds * particle.swayRate + particle.phase) * particle.sway;
        const x = particle.x + drift + season.wind * (particle.y / viewport.height);

        if (particle.y - particle.size > viewport.height) {
            Object.assign(particle, spawn(season, viewport.width, viewport.height, true));
            continue;
        }

        context.save();
        context.globalAlpha = particle.alpha;
        context.translate(x, particle.y);
        context.rotate(particle.angle);
        particle.kind.draw(context, particle);
        context.restore();
    }
}

/* ============================================================
   Starting and stopping
   ============================================================ */

function start(name) {
    season = SEASONS[name];

    if (!canvas) {
        canvas = document.createElement('canvas');
        canvas.className = 'season-layer';
        canvas.setAttribute('aria-hidden', 'true');
        context = canvas.getContext('2d');
        document.body.appendChild(canvas);
        window.addEventListener('resize', onResize);
    }

    canvas.dataset.season = name;
    sizeCanvas();
    fill(false);
    lastTime = performance.now();
    if (!frame) frame = requestAnimationFrame(step);
}

function stop() {
    cancelAnimationFrame(frame);
    frame = 0;
    particles = [];
    if (context) context.clearRect(0, 0, viewport.width, viewport.height);
    if (canvas) canvas.remove();
    canvas = context = null;
    window.removeEventListener('resize', onResize);
}

let resizeFrame = 0;

function onResize() {
    // Resizing fires per pixel dragged; the canvas is re-cut once per frame.
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => {
        sizeCanvas();
        fill(false);
    });
}

function sync() {
    const name = currentSeasonName();
    if (!name || reducedMotion.matches) {
        if (canvas) stop();
        return;
    }
    if (canvas && canvas.dataset.season === name) return;
    if (canvas) stop();
    start(name);
}

/**
 * Watch what is being decorated for, and put the decoration up or take it down.
 *
 * Called once from main.js. Everything after that is the page telling it: the
 * season changing on the root element, the tab going away, and the visitor's
 * motion preference changing under it.
 */
export function initSeasonEffects() {
    sync();

    if (typeof MutationObserver === 'function') {
        new MutationObserver(sync).observe(document.documentElement, {
            attributes: true, attributeFilter: ['data-cover-season']
        });
    }

    // A background tab still gets its frames throttled rather than stopped, so
    // the loop is ended outright and picked up where it left off.
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            cancelAnimationFrame(frame);
            frame = 0;
        } else if (canvas) {
            lastTime = performance.now();
            frame = requestAnimationFrame(step);
        }
    });

    if (reducedMotion.addEventListener) reducedMotion.addEventListener('change', sync);
}
