import * as THREE from "three";
import {
  BACKDROP_FRAGMENT,
  BACKDROP_VERTEX,
  RIBBON_FRAGMENT,
  RIBBON_VERTEX,
} from "./ribbonShaders";
import {
  BACKDROP_PALETTE,
  LAYER_SPECS,
  QUALITY_PROFILES,
  QualityLevel,
  RibbonOptions,
  hexToRgb,
  wrapIndex,
} from "./ribbonTypes";

/**
 * The WebGL half of the ribbon background.
 *
 * Owns a Three.js scene of N ribbon meshes plus an optional backdrop quad, and
 * nothing else - the animation loop, quality decisions and public API live in
 * RibbonBackground. Constructing this throws if WebGL is unavailable, which is the
 * signal for the caller to fall back to Canvas 2D.
 *
 * Per-frame allocation is deliberately zero: uniforms are mutated in place, the
 * reusable scratch colour below is the only object the render path touches.
 */

/** Distance from the camera to z=0. Layer depths are offsets from that plane. */
const CAMERA_Z = 3.2;
const FOV = 45;

/** How far past the visible frustum each ribbon extends, so its ends stay offscreen. */
const OVERHANG = 1.9;

/** Maximum twist angle, in radians, of the band about its own length. */
const TWIST = 0.95;

/**
 * The master opacity at which LAYER_SPECS' own opacities apply verbatim. Raising
 * `opacity` above this scales every layer proportionally rather than flattening
 * them toward each other, so the depth ordering survives the change.
 */
const REFERENCE_OPACITY = 0.22;

interface RibbonLayer {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  geometry: THREE.PlaneGeometry;
  depth: number;
  /** Multiplier on the shared opacity, from the layer spec. */
  layerOpacity: number;
}

export class RibbonRenderer {
  readonly domElement: HTMLCanvasElement;

  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private layers: RibbonLayer[] = [];

  private backdropMesh: THREE.Mesh | null = null;
  private backdropMaterial: THREE.ShaderMaterial | null = null;

  private profile = QUALITY_PROFILES.high;
  private options: RibbonOptions;
  private width = 1;
  private height = 1;

  /** Reused so the colour cycle allocates nothing per frame. */
  private scratchTop = new THREE.Color();
  private scratchBottom = new THREE.Color();
  private scratchMix = new THREE.Color();

  /** Advanced by delta * speed * boost each frame, so a speed or boost change
   *  accelerates the motion instead of jumping its phase. */
  private ribbonTime = 0;
  /** Real elapsed seconds, for the backdrop cycle - unaffected by speed or boost. */
  private backdropTime = 0;

  /** Extra horizontal lean from pointer parallax, in world units. */
  private parallaxX = 0;
  /** Transient multipliers driven by nudge()/pulse(); both decay back to 1. */
  private boost = 1;
  private pulseAmount = 0;

  constructor(container: HTMLElement, options: RibbonOptions, level: QualityLevel) {
    this.options = options;
    this.profile = QUALITY_PROFILES[level] ?? QUALITY_PROFILES.medium;

    this.renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: this.profile.antialias,
      powerPreference: "high-performance",
      // The ribbon is never read back or composited in JS, so no need to keep it.
      preserveDrawingBuffer: false,
    });
    this.renderer.setClearColor(0x000000, 0);
    this.domElement = this.renderer.domElement;
    this.domElement.className = "ribbon-canvas";
    container.appendChild(this.domElement);

    this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100);
    this.camera.position.z = CAMERA_Z;

    this.buildBackdrop();
    this.buildLayers();
    this.resize(container.clientWidth || window.innerWidth, container.clientHeight || window.innerHeight);
  }

  // ---------------------------------------------------------------- geometry --

  /** World-space width of the frustum at a given z. Used to size each ribbon. */
  private visibleWidthAt(depth: number): number {
    const distance = CAMERA_Z - depth;
    const visibleHeight = 2 * Math.tan((FOV * Math.PI) / 360) * distance;
    return visibleHeight * (this.width / Math.max(1, this.height));
  }

  private buildLayers(): void {
    this.disposeLayers();

    const count = Math.max(1, Math.min(this.options.layers, this.profile.maxLayers, LAYER_SPECS.length));
    const baseColor = hexToRgb(this.options.color);

    for (let i = 0; i < count; i++) {
      const spec = LAYER_SPECS[i];
      const geometry = new THREE.PlaneGeometry(1, 1, this.profile.segmentsX, this.profile.segmentsY);

      const material = new THREE.ShaderMaterial({
        vertexShader: RIBBON_VERTEX,
        fragmentShader: RIBBON_FRAGMENT,
        transparent: true,
        depthWrite: false,
        // Normal blending over the dark backdrop: overlapping bands build toward
        // white without the additive blowout that makes this look like neon.
        blending: THREE.NormalBlending,
        side: THREE.DoubleSide,
        uniforms: {
          uTime: { value: 0 },
          uSpeed: { value: spec.speed },
          uAmplitude: { value: spec.amplitude },
          uFrequency: { value: spec.frequency },
          uPhase: { value: spec.phase },
          uWaveStrength: { value: this.options.waveStrength },
          uTwist: { value: TWIST },
          uThickness: { value: spec.thickness },
          uColor: { value: new THREE.Vector3(baseColor[0], baseColor[1], baseColor[2]) },
          uOpacity: { value: this.layerAlpha(spec.opacity) },
          uGlow: { value: this.glowValue() },
        },
      });

      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(0, spec.yOffset, spec.depth);
      mesh.frustumCulled = false;
      this.scene.add(mesh);

      this.layers.push({ mesh, material, geometry, depth: spec.depth, layerOpacity: spec.opacity });
    }

    this.applyLayerWidths();
  }

  private applyLayerWidths(): void {
    for (const layer of this.layers) {
      layer.mesh.scale.x = this.visibleWidthAt(layer.depth) * OVERHANG;
    }
  }

  private buildBackdrop(): void {
    if (this.options.backdrop === "none") return;

    const geometry = new THREE.PlaneGeometry(1, 1, 1, 1);
    const material = new THREE.ShaderMaterial({
      vertexShader: BACKDROP_VERTEX,
      fragmentShader: BACKDROP_FRAGMENT,
      depthWrite: false,
      uniforms: {
        uTop: { value: new THREE.Vector3(0.04, 0.08, 0.2) },
        uBottom: { value: new THREE.Vector3(0.02, 0.02, 0.06) },
      },
    });

    const mesh = new THREE.Mesh(geometry, material);
    // Behind every ribbon, and rendered first regardless of transparency sorting.
    mesh.position.z = -3;
    mesh.renderOrder = -1;
    mesh.frustumCulled = false;
    this.scene.add(mesh);

    this.backdropMesh = mesh;
    this.backdropMaterial = material;
  }

  private layerAlpha(layerOpacity: number): number {
    return layerOpacity * (this.options.opacity / REFERENCE_OPACITY);
  }

  private glowValue(): number {
    return this.options.glow && this.profile.allowGlow ? 1 : 0;
  }

  // ------------------------------------------------------------------- frame --

  /**
   * Draws one frame. Takes the elapsed seconds since the previous frame rather than
   * a frame count, so the motion is identical at 60, 90 and 120 Hz, and a paused or
   * backgrounded window resumes where it left off instead of jumping.
   */
  render(deltaSeconds: number, speed: number): void {
    // Transients decay toward rest. Frame-rate independent, so a 120 Hz display
    // and a 60 Hz one settle at the same wall-clock rate.
    const decay = Math.exp(-deltaSeconds * 2.2);
    this.boost = 1 + (this.boost - 1) * decay;
    this.pulseAmount *= decay;

    // Integrating the rate, rather than scaling a running total, is what keeps a
    // speed change smooth instead of teleporting the wave to a new phase.
    this.ribbonTime += deltaSeconds * speed * this.boost;
    this.backdropTime += deltaSeconds;

    for (const layer of this.layers) {
      const u = layer.material.uniforms;
      u.uTime.value = this.ribbonTime;
      u.uWaveStrength.value = this.options.waveStrength * (1 + this.pulseAmount * 0.55);

      if (this.parallaxX !== 0) {
        // Nearer layers lean further, which is what sells it as depth.
        const depthFactor = (layer.depth + 1.6) / 2.2;
        layer.mesh.position.x = this.parallaxX * depthFactor;
      }
    }

    this.updateBackdrop(this.backdropTime);
    this.renderer.render(this.scene, this.camera);
  }

  private updateBackdrop(time: number): void {
    if (!this.backdropMaterial) return;

    if (this.options.backdrop === "static") {
      this.scratchTop.set(this.options.backdropColors[0]);
      this.scratchBottom.set(this.options.backdropColors[1]);
    } else {
      const cycle = Math.max(2, this.options.backdropCycleSeconds);
      const position = time / cycle;
      const index = wrapIndex(position, BACKDROP_PALETTE.length);
      const next = (index + 1) % BACKDROP_PALETTE.length;
      const t = position - Math.floor(position);

      this.scratchTop.set(BACKDROP_PALETTE[index][0]);
      this.scratchTop.lerp(this.scratchMix.set(BACKDROP_PALETTE[next][0]), t);
      this.scratchBottom.set(BACKDROP_PALETTE[index][1]);
      this.scratchBottom.lerp(this.scratchMix.set(BACKDROP_PALETTE[next][1]), t);
    }

    const top = this.backdropMaterial.uniforms.uTop.value as THREE.Vector3;
    const bottom = this.backdropMaterial.uniforms.uBottom.value as THREE.Vector3;
    top.set(this.scratchTop.r, this.scratchTop.g, this.scratchTop.b);
    bottom.set(this.scratchBottom.r, this.scratchBottom.g, this.scratchBottom.b);
  }

  // ------------------------------------------------------------------ setters --

  resize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);

    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.profile.maxPixelRatio));
    this.renderer.setSize(this.width, this.height, false);

    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();

    this.applyLayerWidths();

    if (this.backdropMesh) {
      // Sized to fill the frustum at its own depth, with a margin for rounding.
      const distance = CAMERA_Z - this.backdropMesh.position.z;
      const visibleHeight = 2 * Math.tan((FOV * Math.PI) / 360) * distance;
      this.backdropMesh.scale.set(visibleHeight * this.camera.aspect * 1.05, visibleHeight * 1.05, 1);
    }
  }

  setColor(color: string): void {
    this.options.color = color;
    const [r, g, b] = hexToRgb(color);
    for (const layer of this.layers) {
      (layer.material.uniforms.uColor.value as THREE.Vector3).set(r, g, b);
    }
  }

  setOpacity(opacity: number): void {
    this.options.opacity = opacity;
    for (const layer of this.layers) {
      layer.material.uniforms.uOpacity.value = this.layerAlpha(layer.layerOpacity);
    }
  }

  setWaveStrength(strength: number): void {
    this.options.waveStrength = strength;
  }

  setGlow(glow: boolean): void {
    this.options.glow = glow;
    const value = this.glowValue();
    for (const layer of this.layers) {
      layer.material.uniforms.uGlow.value = value;
    }
  }

  setLayerCount(count: number): void {
    if (count === this.layers.length) return;
    this.options.layers = count;
    this.buildLayers();
  }

  setBackdropCycleSeconds(seconds: number): void {
    this.options.backdropCycleSeconds = seconds;
  }

  setQuality(level: QualityLevel): void {
    this.profile = QUALITY_PROFILES[level] ?? QUALITY_PROFILES.medium;
    // Antialias is fixed at context creation, so it isn't retroactive - everything
    // else (layer count, subdivisions, pixel ratio, glow) rebuilds here.
    this.buildLayers();
    this.setGlow(this.options.glow);
    this.resize(this.width, this.height);
  }

  /** 0 centred; roughly -1..1. Only called when pointer parallax is enabled. */
  setParallax(x: number): void {
    this.parallaxX = x * 0.12;
    if (x === 0) {
      for (const layer of this.layers) layer.mesh.position.x = 0;
    }
  }

  /** Brief speed-up, e.g. as the menu selection moves. */
  nudge(strength = 0.6): void {
    this.boost = 1 + strength;
  }

  /** One-off swell in wave amplitude, e.g. when a game is chosen. */
  pulse(strength = 1): void {
    this.pulseAmount = strength;
  }

  // ------------------------------------------------------------------ cleanup --

  private disposeLayers(): void {
    for (const layer of this.layers) {
      this.scene.remove(layer.mesh);
      layer.geometry.dispose();
      layer.material.dispose();
    }
    this.layers = [];
  }

  destroy(): void {
    this.disposeLayers();

    if (this.backdropMesh) {
      this.scene.remove(this.backdropMesh);
      (this.backdropMesh.geometry as THREE.PlaneGeometry).dispose();
      this.backdropMaterial?.dispose();
      this.backdropMesh = null;
      this.backdropMaterial = null;
    }

    // Frees the GL context outright; without this a rebuilt background leaks one
    // context per instance and the browser eventually drops the oldest.
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.domElement.remove();
  }
}
