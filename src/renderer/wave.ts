// PS3 XMB-style animated wave background rendered with a fullscreen WebGL fragment shader.
// Cycles smoothly through an 8-color palette over time.

const VERTEX_SRC = `
attribute vec2 aPos;
void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

const FRAGMENT_SRC = `
precision highp float;
uniform float uTime;
uniform vec2 uResolution;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform vec3 uColorC;

float waveField(vec2 uv, float t) {
  float v = 0.0;
  v += sin(uv.x * 3.1 + t * 0.35 + sin(uv.y * 2.0 - t * 0.22) * 1.6);
  v += sin(uv.x * 5.3 - t * 0.5 + uv.y * 3.1) * 0.55;
  v += sin(uv.y * 7.5 + t * 0.17 + uv.x * 1.2) * 0.4;
  v += sin((uv.x + uv.y) * 4.4 - t * 0.28) * 0.3;
  return v;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution.xy;
  vec2 p = uv * vec2(2.4, 1.5);

  float w1 = waveField(p, uTime);
  float w2 = waveField(p * 1.6 + 4.0, uTime * 0.8 + 10.0);

  float bandsA = smoothstep(-0.25, 1.0, sin(w1 * 2.6 + uv.y * 7.0 - uTime * 0.45));
  float bandsB = smoothstep(-0.1, 1.0, sin(w2 * 3.2 - uv.y * 5.0 + uTime * 0.3));

  vec3 base = mix(uColorA, uColorB, uv.y);
  vec3 highlight = uColorC * bandsB * 0.5;

  vec3 col = base * (0.32 + bandsA * 0.62) + highlight * bandsA;

  float vig = smoothstep(1.15, 0.25, length(uv - vec2(0.5, 0.45)));
  col *= mix(0.55, 1.0, vig);

  gl_FragColor = vec4(col, 1.0);
}
`;

// 8-color palette (PS3-esque saturated hues), as linear-ish 0..1 RGB.
const PALETTE: [number, number, number][] = [
  [0.06, 0.25, 0.55], // blue
  [0.08, 0.42, 0.28], // green
  [0.55, 0.12, 0.5], // magenta
  [0.55, 0.3, 0.05], // amber
  [0.15, 0.5, 0.5], // teal
  [0.45, 0.08, 0.12], // red
  [0.35, 0.1, 0.55], // violet
  [0.08, 0.35, 0.55], // cyan-blue
];

function lerp3(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function compileShader(gl: WebGLRenderingContext, type: number, src: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compile error: ${info}`);
  }
  return shader;
}

export class WaveBackground {
  private gl: WebGLRenderingContext;
  private program: WebGLProgram;
  private startTime = performance.now();
  private cycleSeconds = 18;
  private uTime: WebGLUniformLocation;
  private uResolution: WebGLUniformLocation;
  private uColorA: WebGLUniformLocation;
  private uColorB: WebGLUniformLocation;
  private uColorC: WebGLUniformLocation;
  private raf = 0;

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl", { antialias: false, powerPreference: "high-performance" });
    if (!gl) throw new Error("WebGL not supported");
    this.gl = gl;

    const vs = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SRC);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SRC);
    const program = gl.createProgram()!;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`Program link error: ${gl.getProgramInfoLog(program)}`);
    }
    this.program = program;
    gl.useProgram(program);

    const quad = new Float32Array([-1, -1, 3, -1, -1, 3]);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(program, "aPos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    this.uTime = gl.getUniformLocation(program, "uTime")!;
    this.uResolution = gl.getUniformLocation(program, "uResolution")!;
    this.uColorA = gl.getUniformLocation(program, "uColorA")!;
    this.uColorB = gl.getUniformLocation(program, "uColorB")!;
    this.uColorC = gl.getUniformLocation(program, "uColorC")!;

    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  setCycleSeconds(seconds: number): void {
    this.cycleSeconds = Math.max(2, seconds);
  }

  private resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.floor(window.innerWidth * dpr);
    this.canvas.height = Math.floor(window.innerHeight * dpr);
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  start(): void {
    const loop = () => {
      this.render();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
  }

  private render(): void {
    const { gl } = this;
    const t = (performance.now() - this.startTime) / 1000;

    const cyclePos = t / this.cycleSeconds;
    const idx = Math.floor(cyclePos) % PALETTE.length;
    const nextIdx = (idx + 1) % PALETTE.length;
    const frac = cyclePos - Math.floor(cyclePos);

    const colorA = lerp3(PALETTE[idx], PALETTE[nextIdx], frac);
    const colorBIdx = (idx + 3) % PALETTE.length;
    const colorBNextIdx = (colorBIdx + 1) % PALETTE.length;
    const colorB = lerp3(PALETTE[colorBIdx], PALETTE[colorBNextIdx], frac);
    const brightC = colorA.map((c) => Math.min(1, c * 1.8 + 0.15)) as [number, number, number];

    gl.uniform1f(this.uTime, t);
    gl.uniform2f(this.uResolution, this.canvas.width, this.canvas.height);
    gl.uniform3f(this.uColorA, colorA[0], colorA[1], colorA[2]);
    gl.uniform3f(this.uColorB, colorB[0], colorB[1], colorB[2]);
    gl.uniform3f(this.uColorC, brightC[0], brightC[1], brightC[2]);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
