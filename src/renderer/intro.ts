/**
 * The welcome sparkle: a burst of glints spreading out from the centre with a soft
 * bloom behind them, over about two seconds, as the menu fades in underneath. Played
 * when a new profile hands over to the XMB and after the boot splash - the PS5's
 * particle sweep, in spirit. Runs on its own canvas and removes itself afterwards,
 * so it costs nothing once it's done.
 */

const DURATION = 2.2;
const COUNT = 260;

interface Glint {
  angle: number;
  speed: number;
  delay: number;
  size: number;
  hue: number;
  spin: number;
}

export function playIntroSparkle(parent: HTMLElement, onDone?: () => void): void {
  const canvas = document.createElement("canvas");
  canvas.id = "intro-fx";
  parent.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    canvas.remove();
    onDone?.();
    return;
  }
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = window.innerWidth;
  const height = window.innerHeight;
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const cx = width / 2;
  const cy = height / 2;
  const reach = Math.hypot(width, height) * 0.55;
  const glints: Glint[] = [];
  for (let i = 0; i < COUNT; i++) {
    glints.push({
      angle: Math.random() * Math.PI * 2,
      speed: 0.35 + Math.random() * 0.65,
      delay: Math.random() * 0.45,
      size: 1 + Math.random() * 3,
      hue: 200 + Math.random() * 60,
      spin: (Math.random() - 0.5) * 1.5,
    });
  }

  const start = performance.now();
  const frame = (now: number) => {
    const t = (now - start) / 1000;
    ctx.clearRect(0, 0, width, height);
    if (t >= DURATION) {
      canvas.remove();
      onDone?.();
      return;
    }
    // Bloom: quick to appear, slow to fade.
    const bloom = t < 0.25 ? t / 0.25 : Math.max(0, 1 - (t - 0.25) / 1.4);
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, reach * (0.25 + t * 0.6));
    glow.addColorStop(0, `rgba(235, 244, 255, ${0.55 * bloom})`);
    glow.addColorStop(0.35, `rgba(150, 200, 255, ${0.22 * bloom})`);
    glow.addColorStop(1, "rgba(120, 180, 255, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);

    ctx.globalCompositeOperation = "lighter";
    for (const g of glints) {
      const life = (t - g.delay) / (DURATION - g.delay);
      if (life <= 0 || life >= 1) continue;
      // Ease out: fast at first, then coasting.
      const eased = 1 - Math.pow(1 - life, 3);
      const angle = g.angle + g.spin * life;
      const dist = eased * reach * g.speed;
      const x = cx + Math.cos(angle) * dist;
      const y = cy + Math.sin(angle) * dist * 0.75;
      const alpha = life < 0.15 ? life / 0.15 : 1 - (life - 0.15) / 0.85;
      const twinkle = 0.65 + 0.35 * Math.sin(t * 30 + g.angle * 7);
      const size = g.size * (1 - life * 0.4);
      ctx.fillStyle = `hsla(${g.hue}, 90%, 88%, ${alpha * twinkle})`;
      ctx.fillRect(x - size / 2, y - size / 2, size, size);
      if (g.size > 2.6) {
        ctx.fillStyle = `hsla(${g.hue}, 90%, 95%, ${alpha * twinkle * 0.6})`;
        ctx.fillRect(x - size * 2, y - 0.5, size * 4, 1);
        ctx.fillRect(x - 0.5, y - size * 2, 1, size * 4);
      }
    }
    ctx.globalCompositeOperation = "source-over";
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
