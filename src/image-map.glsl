// Where the picture sits on screen, shared by image.frag (screen → picture) and sprites.vert
// (picture → screen) so the star glows stay on the painted stars while the picture churns and
// breathes. Needs common.glsl first. Screen points are centred, y from -0.5 (bottom) to 0.5;
// picture points are 0–1 from its top-left corner.

uniform vec2 u_imageSize;   // pixels
uniform float u_zoom;       // 1 = the image exactly fits (or fills) the screen
uniform float u_fill;       // 0 = show the whole image, 1 = fill the screen, cropping the image
uniform vec2 u_coreUv;      // the picture's bright core

float imageAspect() { return u_imageSize.x / u_imageSize.y; }

// The picture's width in screen units (the screen is 1 unit tall).
float imageWidth() {
  float screen = u_resolution.x / u_resolution.y;
  return (u_fill > 0.5 ? max(screen, imageAspect()) : min(screen, imageAspect())) * u_zoom;
}

// How much the core swells right now: on each kick with a steady beat, with the bass without one.
float swell() { return u_pulse * u_corePulse; }

// The gentle churn: how far the picture is nudged at picture point uv.
vec2 churn(vec2 uv) {
  float aspect = imageAspect();
  vec2 n = uv * vec2(aspect, 1.0) * 2.5;
  vec2 c = vec2(fbm(n + vec2(0.0, u_drift * 0.09), 3), fbm(n + vec2(5.2, 1.3) - u_drift * 0.07, 3)) - 0.5;
  return c * vec2(1.0 / aspect, 1.0) * 0.012 * (0.7 + 0.3 * min(u_mid, 2.5));
}

// The picture point drawn at screen point p: fit, then breathe toward the core, then churn.
vec2 screenToImage(vec2 p) {
  float w = imageWidth();
  vec2 uv = vec2(p.x / w, -p.y * imageAspect() / w) + 0.5;
  uv = u_coreUv + (uv - u_coreUv) * (1.0 - 0.012 * swell());
  return uv + churn(uv);
}

// Where picture point uv is drawn: the inverse of screenToImage. The churn is undone by two
// fixed-point steps (it is tiny and smooth, so that lands well within a pixel).
vec2 imageToScreen(vec2 uv) {
  vec2 q = uv - churn(uv);
  q = uv - churn(q);
  q = u_coreUv + (q - u_coreUv) / (1.0 - 0.012 * swell());
  float w = imageWidth();
  return vec2((q.x - 0.5) * w, -(q.y - 0.5) * w / imageAspect());
}
