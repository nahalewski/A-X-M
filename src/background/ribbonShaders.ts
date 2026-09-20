/**
 * GLSL for the ribbon background. Original to this project - no console firmware
 * shaders are reproduced or adapted here.
 *
 * The ribbon is a subdivided plane. The vertex stage bends it along its length with
 * a few summed sine waves and twists the band around its own axis, so it reads as a
 * length of fabric catching light rather than a flat sine strip. The fragment stage
 * does the soft material: fade across the band, fade at the ends, a gentle sheen
 * where the ribbon turns edge-on, and an optional bloom through the core.
 */

export const RIBBON_VERTEX = /* glsl */ `
precision highp float;

uniform float uTime;
uniform float uSpeed;
uniform float uAmplitude;
uniform float uFrequency;
uniform float uPhase;
uniform float uWaveStrength;
uniform float uTwist;
uniform float uThickness;

varying vec2 vUv;
varying float vFacing;

void main() {
  vUv = uv;

  // Geometry is one unit long, so x runs -0.5 .. 0.5 whatever the screen width is.
  // Scaling the mesh stretches it without changing the wave, which is why resizing
  // never needs the geometry rebuilt.
  float x = position.x;
  float t = uTime * uSpeed + uPhase;
  float a = uAmplitude * uWaveStrength;

  // Three incommensurate sines: the result never visibly repeats, which is what
  // separates this from an obvious single-frequency wave.
  float centreY =
      sin(x * uFrequency         + t * 1.00) * a
    + sin(x * uFrequency * 1.93  - t * 0.63) * a * 0.45
    + sin(x * uFrequency * 0.47  + t * 0.35) * a * 0.75;

  // A smaller displacement in Z gives the band somewhere to travel through depth,
  // so crossings read as one ribbon passing behind another.
  float centreZ =
      sin(x * uFrequency * 0.71  - t * 0.48) * a * 0.55
    + sin(x * uFrequency * 1.31  + t * 0.27) * a * 0.30;

  // Rotating the cross-section about the ribbon's own length is the twist. Without
  // it the band stays face-on everywhere and looks like a painted stripe.
  float angle = sin(x * uFrequency * 0.55 - t * 0.44) * uTwist;

  // The band narrows and widens along its length so the silhouette breathes.
  float taper = 0.62 + 0.38 * sin(x * uFrequency * 0.37 + t * 0.31);
  float across = position.y * uThickness * taper;

  vec3 displaced = vec3(
    x,
    centreY + across * cos(angle),
    centreZ + across * sin(angle)
  );

  // Edge-on sections are foreshortened; the fragment stage brightens them slightly.
  vFacing = cos(angle);

  gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
}
`;

export const RIBBON_FRAGMENT = /* glsl */ `
precision highp float;

uniform vec3 uColor;
uniform float uOpacity;
uniform float uGlow;

varying vec2 vUv;
varying float vFacing;

void main() {
  // 0 at the band's centreline, 1 at either long edge.
  float across = abs(vUv.y - 0.5) * 2.0;

  // smoothstep twice: once for a soft edge, once to pull the falloff off the
  // midline so the band keeps a defined core instead of reading as a blur.
  float band = 1.0 - smoothstep(0.0, 1.0, across);
  band = pow(band, 1.35);

  // Both ends dissolve, so a ribbon that does reach the viewport edge doesn't
  // terminate on a visible straight cut.
  float ends = smoothstep(0.0, 0.18, vUv.x) * smoothstep(1.0, 0.82, vUv.x);

  // Light catching the turn. Kept narrow - a wide range here looks like chrome.
  float sheen = mix(0.74, 1.0, 1.0 - abs(vFacing));

  float alpha = band * ends * uOpacity * sheen;
  if (alpha <= 0.002) discard;

  // The bloom rides in the colour rather than the alpha, so overlapping ribbons
  // brighten where they cross without the stack turning opaque.
  float core = pow(band, 3.0);
  vec3 col = uColor * (0.84 + core * 0.46 + uGlow * core * 0.8);

  gl_FragColor = vec4(col, alpha);
}
`;

/**
 * Backdrop: a single full-frustum quad behind every ribbon. A vertical gradient
 * with a soft vignette, cheap enough to leave on permanently.
 */
export const BACKDROP_VERTEX = /* glsl */ `
precision highp float;
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const BACKDROP_FRAGMENT = /* glsl */ `
precision highp float;

uniform vec3 uTop;
uniform vec3 uBottom;

varying vec2 vUv;

void main() {
  // Weighted toward the bottom so the brighter tone sits behind the upper half,
  // where the category row lives, and the menu text below stays on near-black.
  float t = pow(clamp(vUv.y, 0.0, 1.0), 0.95);
  vec3 col = mix(uBottom, uTop, t);

  // Pulls the corners down; keeps a full-screen flat gradient from looking like
  // a wallpaper rather than a lit space.
  float vig = smoothstep(1.25, 0.3, length(vUv - vec2(0.5, 0.52)));
  col *= mix(0.72, 1.0, vig);

  gl_FragColor = vec4(col, 1.0);
}
`;
