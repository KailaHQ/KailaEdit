export const VERTEX_SHADER = `#version 300 es
in vec2 a_position;
out vec2 v_uv;

void main() {
  v_uv = (a_position + 1.0) * 0.5;
  v_uv.y = 1.0 - v_uv.y;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`

export const FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp sampler3D;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_image;
uniform sampler3D u_lut;
uniform float u_intensity;
uniform float u_lut_size;
uniform bool u_lut_enabled;

uniform bool u_chroma_enabled;
uniform vec3 u_chroma_color;
uniform float u_chroma_similarity;
uniform float u_chroma_smoothness;
uniform float u_chroma_spill;
uniform float u_chroma_clean;
uniform float u_chroma_feather;

uniform bool u_matte_enabled;
uniform sampler2D u_matte;
// Alpha band from matteAlphaBand() in core — everything below lo is background.
uniform float u_matte_lo;
uniform float u_matte_hi;
// Blur radius for featherEdge, in matte pixels, from matteFeatherSigma() in core.
uniform float u_matte_sigma;
// One matte texel in UV, so the blur above can be expressed in pixels.
uniform vec2 u_matte_texel;

uniform bool u_custom_matte_enabled;
uniform bool u_custom_matte_from_empty;
uniform sampler2D u_custom_matte;
// Where a point of THIS frame lies on the picture the matte was made on (rows of an affine
// map). On a shot where the camera moves the matte follows it; on a still it is the identity.
uniform vec3 u_custom_matte_row0;
uniform vec3 u_custom_matte_row1;

vec2 customMatteAt(vec2 uv) {
  vec2 r = vec2(
    dot(u_custom_matte_row0.xy, uv) + u_custom_matte_row0.z,
    dot(u_custom_matte_row1.xy, uv) + u_custom_matte_row1.z
  );
  // Past the picture the matte was made on there is nothing painted.
  if (r.x < 0.0 || r.y < 0.0 || r.x > 1.0 || r.y > 1.0) return vec2(0.0);
  return texture(u_custom_matte, r).rg;
}

uniform bool u_stroke_enabled;
uniform int u_stroke_style;
uniform vec3 u_stroke_color;
uniform float u_stroke_width;
uniform float u_stroke_opacity;
uniform vec2 u_stroke_offset;
uniform float u_stroke_glow;
uniform float u_stroke_roughness;
uniform float u_stroke_gap;
uniform float u_stroke_seed;
uniform vec2 u_resolution;

// The matte alpha at uv, with featherEdge softening and cleanEdge tightening applied.
//
// Mirrors the export filtergraph: blur first (gblur), then the alpha remap (lut). Both
// numbers come from core/src/matte-edge.ts so the two cannot drift apart again.
//
// The blur is a 5x5 Gaussian sampled in units of sigma rather than in texels: taps at
// 0, +/-1 and +/-2 sigma with weights exp(-d*d/2). That spans the +/-2 sigma where the
// bulk of a Gaussian lives and gives an effective sigma of 0.96 of the real one, so it
// tracks ffmpeg's gblur to within a few percent at any slider position, at a fixed 25
// fetches instead of the 61 per axis a literal kernel would need at the top of the range.
float matteAlphaAt(vec2 uv) {
  float a;
  if (u_matte_sigma > 0.0) {
    // One tap-step IS one sigma, so the kernel scales with the slider.
    vec2 sigmaStep = u_matte_texel * u_matte_sigma;
    float total = 0.0;
    float wsum = 0.0;
    for (int y = -2; y <= 2; y++) {
      for (int x = -2; x <= 2; x++) {
        vec2 off = vec2(float(x), float(y)) * sigmaStep;
        float d2 = float(x * x + y * y);
        float w = exp(-d2 * 0.5);
        total += texture(u_matte, uv + off).r * w;
        wsum += w;
      }
    }
    a = total / max(1e-6, wsum);
  } else {
    a = texture(u_matte, uv).r;
  }

  float span = max(1e-6, u_matte_hi - u_matte_lo);
  return clamp((a - u_matte_lo) / span, 0.0, 1.0);
}

void main() {
  vec4 color = texture(u_image, v_uv);

  if (u_lut_enabled) {
    vec3 scale = (u_lut_size - 1.0) / u_lut_size * color.rgb + 0.5 / u_lut_size;
    vec3 graded = texture(u_lut, scale).rgb;
    color.rgb = mix(color.rgb, graded, u_intensity);
  }

  if (u_chroma_enabled) {
    vec3 diffVec = abs(color.rgb - u_chroma_color);
    float diff = max(diffVec.r, max(diffVec.g, diffVec.b));
    float sim = u_chroma_similarity;
    float blend = max(0.0001, u_chroma_smoothness);
    float alphaFactor;
    if (diff > sim) {
      alphaFactor = 1.0;
    } else if (diff > (sim - blend)) {
      alphaFactor = (diff - (sim - blend)) / blend;
    } else {
      alphaFactor = 0.0;
    }

    if (u_chroma_clean > 0.0 || u_chroma_feather > 0.0) {
      float edge0 = clamp(u_chroma_clean, 0.0, 0.999);
      float edge1 = clamp(1.0 - u_chroma_feather, edge0 + 0.001, 1.0);
      alphaFactor = smoothstep(edge0, edge1, alphaFactor);
    }

    color.a *= alphaFactor;

    if (u_chroma_spill > 0.0) {
      if (u_chroma_color.g > u_chroma_color.r && u_chroma_color.g > u_chroma_color.b) {
        float maxOther = max(color.r, color.b);
        if (color.g > maxOther) {
          color.g = mix(color.g, maxOther, u_chroma_spill);
        }
      } else if (u_chroma_color.b > u_chroma_color.r && u_chroma_color.b > u_chroma_color.g) {
        float maxOther = max(color.r, color.g);
        if (color.b > maxOther) {
          color.b = mix(color.b, maxOther, u_chroma_spill);
        }
      }
    }
  }

  if (u_matte_enabled) {
    color.a *= matteAlphaAt(v_uv);
  }

  if (u_custom_matte_enabled) {
    vec2 customMod = customMatteAt(v_uv);
    // Painting with no automatic matte underneath is a cutout: only what is painted stays.
    float customBase = u_custom_matte_from_empty ? 0.0 : color.a;
    color.a = clamp(customBase + customMod.r - customMod.g, 0.0, 1.0);
  }

  float subjectAlpha = color.a;

  // A subjectAlpha above 0.999 short-circuits the whole stroke block, and the result is
  // identical by construction: the compositing below is
  //   finalAlpha = subjectAlpha + strokeAlpha * (1 - subjectAlpha)
  //   mixedRgb   = (rgb * subjectAlpha + strokeColor * strokeAlpha * (1 - subjectAlpha)) / finalAlpha
  if (u_stroke_enabled && u_stroke_style > 0 && u_stroke_width > 0.0 && subjectAlpha < 0.999) {
    float minDim = min(u_resolution.x, u_resolution.y);
    vec2 strokeUvW = vec2(u_stroke_width * minDim / max(1.0, u_resolution.x), u_stroke_width * minDim / max(1.0, u_resolution.y));

    vec2 centerUv = v_uv;
    if (u_stroke_style == 3) { // offset
      centerUv -= vec2(u_stroke_offset.x * minDim / max(1.0, u_resolution.x), u_stroke_offset.y * minDim / max(1.0, u_resolution.y));
    }

    float strokeAlpha = 0.0;
    float closestDist = 1.0;
    bool hitForeground = false;

    // 12 sampling directions with 3 concentric rings (total 36 taps)
    for (int ring = 1; ring <= 3; ring++) {
      float rFrac = float(ring) / 3.0;
      for (int tap = 0; tap < 12; tap++) {
        float angle = float(tap) * 0.52359877559; // 2 * PI / 12
        vec2 dir = vec2(cos(angle), sin(angle));

        if (u_stroke_style == 2) { // straight (Chebyshev box)
          dir = clamp(dir * 1.414, vec2(-1.0), vec2(1.0));
        }

        if (u_stroke_style == 5) { // hand-drawn procedural noise
          float n = sin(angle * 3.0 + u_stroke_seed) * 0.35 * u_stroke_roughness;
          dir *= (1.0 + n);
        } else if (u_stroke_style == 6) { // paper torn-edge noise
          float n = sin(angle * 2.0 + u_stroke_seed) * 0.25 * u_stroke_roughness;
          dir *= (1.15 + n);
        }

        vec2 samplePos = centerUv + dir * strokeUvW * rFrac;
        if (samplePos.x >= 0.0 && samplePos.x <= 1.0 && samplePos.y >= 0.0 && samplePos.y <= 1.0) {
          float sA = 0.0;
          if (u_matte_enabled) {
            sA = matteAlphaAt(samplePos);
          } else if (u_chroma_enabled) {
            vec3 sRgb = texture(u_image, samplePos).rgb;
            vec3 sDiffVec = abs(sRgb - u_chroma_color);
            float sDiff = max(sDiffVec.r, max(sDiffVec.g, sDiffVec.b));
            float sSim = u_chroma_similarity;
            float sBlend = max(0.0001, u_chroma_smoothness);
            if (sDiff > sSim) {
              sA = 1.0;
            } else if (sDiff > (sSim - sBlend)) {
              sA = (sDiff - (sSim - sBlend)) / blend;
            } else {
              sA = 0.0;
            }
            if (u_chroma_clean > 0.0 || u_chroma_feather > 0.0) {
              float edge0 = clamp(u_chroma_clean, 0.0, 0.999);
              float edge1 = clamp(1.0 - u_chroma_feather, edge0 + 0.001, 1.0);
              sA = smoothstep(edge0, edge1, sA);
            }
          } else {
            sA = texture(u_image, samplePos).a;
          }

          if (u_custom_matte_enabled) {
            vec2 cMod = customMatteAt(samplePos);
            sA = clamp((u_custom_matte_from_empty ? 0.0 : sA) + cMod.r - cMod.g, 0.0, 1.0);
          }

          if (sA > 0.5) {
            hitForeground = true;
            closestDist = min(closestDist, rFrac);
          }
        }
      }
    }

    if (hitForeground) {
      strokeAlpha = 1.0;

      if (u_stroke_style == 4) { // dotted
        float angle = atan(v_uv.y - 0.5, v_uv.x - 0.5);
        float freq = max(4.0, 40.0 * (1.0 - u_stroke_gap * 0.008));
        float dotMod = cos(angle * freq);
        strokeAlpha = smoothstep(0.0, 0.4, dotMod);
      } else if (u_stroke_style == 6) { // paper
        float grain = 1.0 + sin(gl_FragCoord.x * 0.5 + gl_FragCoord.y * 0.5) * 0.08;
        strokeAlpha *= grain;
      }
    }

    if (u_stroke_style == 7) { // luminescence glow
      float glowDist = closestDist;
      float glowRange = 1.0 + u_stroke_glow * 0.02;
      strokeAlpha = max(strokeAlpha, exp(-glowDist * 2.5) * clamp(1.0 - (glowDist / glowRange), 0.0, 1.0));
    }

    strokeAlpha *= u_stroke_opacity;

    // Stroke is drawn underneath the subject using Porter-Duff Over
    float finalAlpha = clamp(subjectAlpha + strokeAlpha * (1.0 - subjectAlpha), 0.0, 1.0);
    vec3 mixedRgb = (color.rgb * subjectAlpha + u_stroke_color * strokeAlpha * (1.0 - subjectAlpha)) / max(0.0001, finalAlpha);
    color = vec4(mixedRgb, finalAlpha);
  }

  fragColor = color;
}
`

export function hexToRgb01(hex: string): [number, number, number] {
  const clean = hex.replace(/^#/, '')
  const r = parseInt(clean.substring(0, 2) || '0', 16) / 255
  const g = parseInt(clean.substring(2, 4) || '0', 16) / 255
  const b = parseInt(clean.substring(4, 6) || '0', 16) / 255
  return [r, g, b]
}
