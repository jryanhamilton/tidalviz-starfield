#version 300 es
// Starfield over a picture: the image is the nebula, shown whole (or filling the screen); slow noise
// nudges the gas so it churns in place; the bright core swells, brightens and blooms with the bass
// and beats. The painted stars light up in a second pass (sprites.vert / sprites.frag).
precision highp float;
#include "common.glsl"
#include "image-map.glsl"

uniform sampler2D u_image;  // top row first, mipmapped (the bloom reads a blurry mip level)
uniform float u_nebula;     // image brightness

out vec4 fragColor;

void main() {
  // Centred coordinates, y from -0.5 to 0.5, square pixels.
  vec2 p = (gl_FragCoord.xy - 0.5 * u_resolution) / u_resolution.y;
  float aspect = imageAspect();
  vec2 uv = screenToImage(p);

  // The whole picture, as painted. Where the screen's shape leaves room beyond its edges, continue
  // it as a mirror of its outer tenth (its sky, so tall bands never reflect the nebula) that blurs
  // more with distance, so the edge has no seam and the bands read as more of the same sky. The
  // blur is capped: much past mip 7.5 a level averages in the bright core and turns grey, and much
  // below it tall bands show streaks where one blurred row repeats.
  float beyond = length(max(max(-uv, uv - 1.0), 0.0) * vec2(aspect, 1.0));  // distance past the edge
  vec2 edgeUv = clamp(uv, 0.0, 1.0);
  vec2 inward = step(uv, vec2(0.0)) - step(1.0, uv);  // +1 past the top/left, -1 past the bottom/right
  vec2 mirrored = edgeUv + inward * min(abs(uv - edgeUv), 0.1);
  vec3 sharp = texture(u_image, edgeUv).rgb;
  vec3 soft = textureLod(u_image, mirrored, min(2.0 + beyond * 40.0, 7.5)).rgb * (1.0 - 0.5 * min(beyond * 2.0, 1.0));
  vec3 img = beyond > 0.0 ? soft : sharp;
  float fromCore = length((uv - u_coreUv) * vec2(aspect, 1.0));

  // The gas around the core lifts with the music (the core itself is near white already, so the
  // mid-tones are where it shows), and a blurred copy of the picture blooms around it, so the glow
  // takes the painting's own colours.
  float s = swell();
  vec3 base = img * u_nebula * (1.0 + 0.5 * s * exp(-fromCore * 2.0));
  vec3 bloom = 1.0 - exp(-textureLod(u_image, uv, 5.0).rgb * s * exp(-fromCore * 1.4) * 1.2);
  vec3 col = 1.0 - (1.0 - clamp(base, 0.0, 1.0)) * (1.0 - bloom);  // screen blend over the picture

  // Transparent, premultiplied canvas: light on black, alpha = brightest channel.
  fragColor = vec4(col, max(col.r, max(col.g, col.b)));
}
