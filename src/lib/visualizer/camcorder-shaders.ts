/**
 * Camcorder filter — the EXACT GLSL of effect.app's "Backrooms" preset,
 * captured verbatim (WebGLRenderingContext.shaderSource hook while their
 * editor compiled ?effect=backrooms) and shipped unmodified.
 *
 * Backrooms is a three-layer preset stack; every layer's shader is here:
 *
 *   1. VHS          — the analog tape pipeline: YIQ encode/decode through a
 *                     PAL-style quadrature carrier (per-line phase jitter,
 *                     PAL line alternation, gaussian chroma taps), an
 *                     internal lo-fi resample grid (the "resolution" dial,
 *                     default 420px wide), frame-quantized vertical jumps
 *                     at 29.97 fps, tape-wave wobble, crease tears with
 *                     sparkle, bottom tracking noise, AC flicker, chroma
 *                     grain, sharpening and a YIQ color shift. All noise
 *                     is hash-based — fully deterministic.
 *   2. Color grading — Oklab zone grading: the pixel's log2 exposure picks
 *                     five zone weights (black/shadow/light/highlight/
 *                     specular) through smoothstep pivots; each zone pushes
 *                     exposure (stops), an Oklab a/b tint and saturation.
 *                     The Backrooms preset's zone values are baked in
 *                     camcorder-filter.ts — exactly what their preset ships.
 *   3. Gaussian blur — two kernel passes (horizontal then vertical) with a
 *                     smooth ease falloff, radius = strength x 2.6412 x
 *                     exp(+/-aspect), then a composite that mixes the
 *                     blurred frame back over the graded frame at the
 *                     "blur mix" opacity (Normal blend).
 *
 * The render order matches their layer stack: VHS -> color grading ->
 * gaussian blur. The window helpers (win*) are shipped as captured and fed
 * an identity window (offset 0, size = canvas), which is exactly how their
 * engine renders a full-frame layer.
 */

export const CAMCORDER_VERT = `#version 300 es
                    in vec2 aPos;
                    in vec2 aUV;

                    out vec2 vUV0;

                    void main(void) {
                        vUV0 = aUV;
                        gl_Position = vec4(aPos, 0.0, 1.0);
                    }
                `

export const CAMCORDER_VHS_FRAG = `#version 300 es
                        precision highp float;

                        
            uniform vec2 iResolution;
            uniform float iTime;
            uniform float iGlobalTime;
            uniform float iAspect;
            uniform int iFrame;
            uniform vec4 iMouse;

            uniform highp sampler2D iChannel0;
            uniform highp sampler2D iChannel1;
            uniform highp sampler2D iChannel2;
            uniform highp sampler2D iChannel3;
            uniform highp sampler2D iChannel4;
            uniform highp sampler2D iChannel5;
            uniform highp sampler2D iChannel6;
            uniform highp sampler2D iChannel7;

            uniform vec2 iChannelResolution0;
            uniform vec2 iChannelResolution1;
            uniform vec2 iChannelResolution2;
            uniform vec2 iChannelResolution3;
            uniform vec2 iChannelResolution4;
            uniform vec2 iChannelResolution5;
            uniform vec2 iChannelResolution6;
            uniform vec2 iChannelResolution7;
            

                        in vec2 vUV0;
                        out vec4 outFragColor;

                        void mainImage(out vec4, vec2);

                        vec4 texture2D(sampler2D tex, vec2 uv) {
                            return texture(tex, uv);
                        }

                        void main(void) {
                            outFragColor = vec4(0.0, 0.0, 0.0, 1.0);
                            mainImage(outFragColor, vUV0 * iResolution.xy);
                        }
                        // @animated



precision highp float;
precision highp int;














uniform vec2  iSrcResolution;  // full source size, px
uniform vec2  iWindowOffset;   // visible region origin, source px
uniform vec2  iWindowSize;     // visible region size, source px

bool winActive() {
    return iWindowSize.x > 0.5 && iSrcResolution.x > 0.5;
}


vec2 winSrcResolution() {
    return winActive() ? iSrcResolution : iResolution.xy;
}


vec2 winSrcCoord(vec2 fragCoord) {
    if (!winActive()) return fragCoord;
    return iWindowOffset + (fragCoord / iResolution.xy) * iWindowSize;
}


vec2 winSrcUV(vec2 fragCoord) {
    return winSrcCoord(fragCoord) / winSrcResolution();
}


float winSrcAspect() {
    vec2 r = winSrcResolution();
    return r.x / max(r.y, 1e-6);
}



















vec2 winRelScale() {
    float aspect = winSrcAspect();
    return aspect > 1.0 ? vec2(aspect, 1.0) : vec2(1.0, 1.0 / aspect);
}


vec2 winToRel(vec2 fragCoord) {
    return (winSrcUV(fragCoord) * 2.0 - 1.0) * winRelScale();
}


vec2 winFromRel(vec2 rel) {
    return (rel / winRelScale() + 1.0) * 0.5;
}


vec2 winNormToRel(vec2 n) {
    return n * winRelScale();
}








vec2 winBufUV(vec2 srcPx) {
    if (!winActive()) return srcPx / iResolution.xy;
    return (srcPx - iWindowOffset) / iWindowSize;
}


#define PI 3.14159265359
#define SAMPLES 6

uniform float internalWidth;   // label=resolution, value=320.0, min=128.0, max=1024.0, step=1.0

uniform float distortion;      // label=distortion, value=0.23, min=0.0, max=2.5, step=0.01
uniform float colorBleed;      // label=color fringing, value=2.0, min=0.0, max=2.0, step=0.01
uniform float tapeWave;        // label=wobble, value=2.0, min=0.0, max=2.0, step=0.01
uniform float tapeCrease;      // label=tape crease, value=0.50, min=0.0, max=2.0, step=0.01
uniform float tracking;        // label=tracking noise, value=2.0, min=0.0, max=2.0, step=0.01
uniform float verticalJump;    // label=vertical jump, value=0.05, min=0.0, max=2.0, step=0.01
uniform float creaseSparkle;   // label=sparkle, value=1.0, min=0.0, max=2.0, step=0.01
uniform float acBeat;          // label=flicker, value=0.06, min=0.0, max=2.0, step=0.01
uniform float chromaNoise;     // label=grain, value=0.75, min=0.0, max=2.0, step=0.01
uniform float saturation;      // label=saturation, value=2.0, min=0.0, max=2.5, step=0.01
uniform float yiqShift;        // label=color shift, value=0.1, min=0.0, max=2.0, step=0.01
uniform float colorUnderMix;   // label=color blend, value=1.0, min=0.0, max=1.0, step=0.01
uniform float lumaBandwidth;   // label=softness, value=0.5, min=0.4, max=2.0, step=0.01
uniform float chromaDelay;     // label=color delay, value=5.8, min=0.0, max=8.0, step=0.1
uniform float sharpening;      // label=sharpening, value=0.25, min=0.0, max=2.0, step=0.01

float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

float valueNoise256(vec2 uv, vec2 seed) {
    
    vec2 p = fract(uv) * 256.0;
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);

    float n00 = hash12(i + seed);
    float n10 = hash12(i + vec2(1.0, 0.0) + seed);
    float n01 = hash12(i + vec2(0.0, 1.0) + seed);
    float n11 = hash12(i + vec2(1.0, 1.0) + seed);
    return mix(mix(n00, n10, f.x), mix(n01, n11, f.x), f.y);
}

float vhsNoise(vec2 uv) {
    return valueNoise256(uv, vec2(17.0, 91.0));
}

vec3 vhsNoise3(vec2 uv, vec2 t) {
    vec2 b = uv + t;
    return vec3(
        valueNoise256(b, vec2(17.0, 91.0)),
        valueNoise256(b + vec2(0.37, 0.11), vec2(53.0, 13.0)),
        valueNoise256(b + vec2(0.79, 0.53), vec2(29.0, 71.0))
    );
}

mat2 rotate2D(float a) {
    float c = cos(a);
    float s = sin(a);
    return mat2(c, s, -s, c);
}

vec3 rgb2yiq(vec3 rgb) {
    return mat3(
        0.299, 0.596, 0.211,
        0.587, -0.274, -0.523,
        0.114, -0.322, 0.312
    ) * rgb;
}

vec3 yiq2rgb(vec3 yiq) {
    return mat3(
        1.000, 1.000, 1.000,
        0.956, -0.272, -1.106,
        0.621, -0.647, 1.703
    ) * yiq;
}

vec3 sampleSourceInternal(vec2 uv, vec2 vhsRes) {
    
    
    uv = clamp(uv, vec2(0.0), vec2(1.0));
    vec2 p = uv * vhsRes - 0.5;
    vec2 i = floor(p);
    vec2 f = fract(p);

    vec2 uv00 = clamp((i + vec2(0.5, 0.5)) / vhsRes, vec2(0.0), vec2(1.0));
    vec2 uv10 = clamp((i + vec2(1.5, 0.5)) / vhsRes, vec2(0.0), vec2(1.0));
    vec2 uv01 = clamp((i + vec2(0.5, 1.5)) / vhsRes, vec2(0.0), vec2(1.0));
    vec2 uv11 = clamp((i + vec2(1.5, 1.5)) / vhsRes, vec2(0.0), vec2(1.0));

    vec3 c00 = texture(iChannel0, winBufUV(uv00 * winSrcResolution())).rgb;
    vec3 c10 = texture(iChannel0, winBufUV(uv10 * winSrcResolution())).rgb;
    vec3 c01 = texture(iChannel0, winBufUV(uv01 * winSrcResolution())).rgb;
    vec3 c11 = texture(iChannel0, winBufUV(uv11 * winSrcResolution())).rgb;
    return mix(mix(c00, c10, f.x), mix(c01, c11, f.x), f.y);
}

float sampleLumaLPF(vec2 uv, vec2 vhsRes, float bandwidth) {
    
    float sigma = mix(2.2, 0.6, clamp((bandwidth - 0.4) / 1.6, 0.0, 1.0));
    float invTwoSigma2 = 0.5 / max(sigma * sigma, 1e-5);

    float acc = 0.0;
    float wSum = 0.0;
    for (int k = -2; k <= 2; k++) {
        float fk = float(k);
        vec2 tapUV = clamp(uv + vec2(fk, 0.0) / vhsRes, vec2(0.0), vec2(1.0));
        float y = rgb2yiq(sampleSourceInternal(tapUV, vhsRes)).x;
        float w = exp(-fk * fk * invTwoSigma2);
        acc += y * w;
        wSum += w;
    }
    return acc / max(wSum, 1e-6);
}

vec3 sampleColorUnder(vec2 uv, vec2 vhsRes) {
    
    const int TAP_RADIUS = 6;
    const float CHROMA_BANDWIDTH = 0.2;
    const float CARRIER_JITTER = 0.5;

    if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) {
        return vec3(0.10);
    }

    vec3 centerYiq = rgb2yiq(sampleSourceInternal(uv, vhsRes));
    float luma = sampleLumaLPF(uv, vhsRes, lumaBandwidth);

    
    vec2 uvChroma = clamp(uv - vec2(chromaDelay / max(vhsRes.x, 1.0), 0.0), vec2(0.0), vec2(1.0));
    float line = floor(uv.y * vhsRes.y);
    float cyclesPerLine = 40.0; 
    float linePhase = hash12(vec2(line, float(iFrame) * 0.73)) * 2.0 * PI * CARRIER_JITTER;

    
    float palAlt = (mod(line, 2.0) > 0.5) ? -1.0 : 1.0;

    float sigma = mix(9.0, 2.0, clamp((CHROMA_BANDWIDTH - 0.2) / 1.8, 0.0, 1.0));
    float invTwoSigma2 = 0.5 / max(sigma * sigma, 1e-5);

    float iAcc = 0.0;
    float qAcc = 0.0;
    float wSum = 0.0;

    for (int k = -TAP_RADIUS; k <= TAP_RADIUS; k++) {
        float fk = float(k);
        vec2 tapUV = uvChroma + vec2(fk, 0.0) / vhsRes;
        tapUV = clamp(tapUV, vec2(0.0), vec2(1.0));

        vec3 tapYiq = rgb2yiq(sampleSourceInternal(tapUV, vhsRes));
        float iSig = tapYiq.y;
        float qSig = tapYiq.z * palAlt;

        float phase = 2.0 * PI * (cyclesPerLine * tapUV.x) + linePhase;
        float c = cos(phase);
        float s = sin(phase);

        
        float encoded = iSig * c + qSig * s;
        float w = exp(-fk * fk * invTwoSigma2);
        iAcc += encoded * c * w;
        qAcc += encoded * s * w;
        wSum += w;
    }

    float iDec = (2.0 * iAcc) / max(wSum, 1e-6);
    float qDec = (2.0 * qAcc) / max(wSum, 1e-6) * palAlt;
    vec2 chroma = vec2(iDec, qDec);

    if (abs(colorBleed) > 1e-5) {
        chroma = rotate2D(colorBleed * 0.12) * chroma;
    }

    vec3 colorUnderYiq = vec3(mix(centerYiq.x, luma, 0.75), chroma.x, chroma.y);
    vec3 decoded = yiq2rgb(colorUnderYiq);
    vec3 original = sampleSourceInternal(uv, vhsRes);
    return mix(original, decoded, clamp(colorUnderMix, 0.0, 1.0));
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    float aspect = winSrcAspect();
    vec2 vhsRes = vec2(max(internalWidth, 1.0), max(internalWidth / max(aspect, 1e-5), 1.0));
    vec2 uvOut = winSrcUV(fragCoord);

    
    vec2 uv = uvOut;
    float t = iTime;

    vec2 uvn = uv;

    
    
    const float VHS_FPS = 29.97;
    float vhsFrame = floor(t * VHS_FPS);
    float framePhase = fract(t * VHS_FPS);

    float jumpEventPrev = smoothstep(0.92, 0.995, vhsNoise(vec2(floor((vhsFrame - 1.0) * 0.80), 37.0)));
    float jumpEventCurr = smoothstep(0.92, 0.995, vhsNoise(vec2(floor(vhsFrame * 0.80), 37.0)));

    float jumpSizePrev = (0.03 + 0.17 * vhsNoise(vec2(floor((vhsFrame - 1.0) * 1.70), 51.0))) * jumpEventPrev;
    float jumpSizeCurr = (0.03 + 0.17 * vhsNoise(vec2(floor(vhsFrame * 1.70), 51.0))) * jumpEventCurr;

    float jumpDriftPrev = (vhsNoise(vec2((vhsFrame - 1.0) * 0.12, 9.4)) - 0.5) * 0.02;
    float jumpDriftCurr = (vhsNoise(vec2(vhsFrame * 0.12, 9.4)) - 0.5) * 0.02;

    float jumpOffsetPrev = (jumpSizePrev + jumpDriftPrev) * verticalJump;
    float jumpOffsetCurr = (jumpSizeCurr + jumpDriftCurr) * verticalJump;
    float jumpLerp = smoothstep(0.15, 0.85, framePhase);
    uvn.y = fract(uvn.y + mix(jumpOffsetPrev, jumpOffsetCurr, jumpLerp));

    
    uvn.x += (vhsNoise(vec2(uvn.y * 0.10, t * 0.10)) - 0.5) / vhsRes.x * distortion * tapeWave;
    uvn.x += (vhsNoise(vec2(uvn.y, t * 10.0)) - 0.5) / vhsRes.x * distortion * tapeWave;

    
    float creaseSeed = vhsNoise(t * vec2(0.67, 0.59));
    float tcPhase = smoothstep(
        0.9,
        0.96,
        sin(uvn.y * 8.0 - (t + 0.14 * creaseSeed) * PI * 1.2)
    );
    float tcNoise = smoothstep(0.3, 1.0, vhsNoise(vec2(uvn.y * 4.77, t)));
    float tc = tcPhase * tcNoise * tapeCrease;
    uvn.x -= tc / vhsRes.x * 8.0 * distortion;

    
    float snPhase = smoothstep(6.0 / vhsRes.y, 0.0, uvn.y);
    uvn.y += snPhase * 0.3 * tracking;
    uvn.x += snPhase * ((vhsNoise(vec2(uv.y * 100.0, t * 10.0)) - 0.5) / vhsRes.x * 24.0 * tracking);

    vec3 col = sampleColorUnder(uvn, vhsRes);

    
    float cn = tcNoise * (0.3 + 0.7 * tcPhase) * creaseSparkle;
    if (cn > 0.29) {
        vec2 uvt = (uvn + vec2(vhsNoise(vec2(uvn.y, t)), 0.0)) * vec2(0.1, 1.0);
        float n0 = vhsNoise(uvt);
        float n1 = vhsNoise(uvt + vec2(1.0 / vhsRes.x, 0.0));
        if (n1 < n0) {
            col = mix(col, vec3(2.0, 1.0, 1.0), pow(n0, 10.0));
        }
    }

    
    float ac = smoothstep(0.4, 0.6, vhsNoise(vec2(0.0, 0.1 * (uv.y + t * 0.2))));
    col *= 1.0 + 0.1 * acBeat * ac;

    vec3 rgbNoise = vhsNoise3(uvn, t * vec2(5.97, 4.45));
    col *= 0.9 + 0.1 * mix(vec3(1.0), rgbNoise, chromaNoise);

    
    if (sharpening > 1e-5) {
        vec2 sharpStep = vec2(1.0) / max(vhsRes, vec2(1.0));
        vec3 sC = sampleSourceInternal(uvn, vhsRes);
        vec3 sL = sampleSourceInternal(uvn - vec2(sharpStep.x, 0.0), vhsRes);
        vec3 sR = sampleSourceInternal(uvn + vec2(sharpStep.x, 0.0), vhsRes);
        vec3 sU = sampleSourceInternal(uvn - vec2(0.0, sharpStep.y), vhsRes);
        vec3 sD = sampleSourceInternal(uvn + vec2(0.0, sharpStep.y), vhsRes);
        vec3 sBlur = 0.2 * (sL + sR + sU + sD + sC);
        vec3 detail = sC - sBlur;
        col = clamp(col + detail * (1.2 * sharpening), 0.0, 1.0);
    }

    
    vec3 yiq = rgb2yiq(col);
    yiq = mix(yiq, vec3(0.1, -0.1, 0.0) + vec3(0.9, 1.1, 1.5) * yiq, yiqShift);
    yiq.yz *= saturation;
    col = clamp(yiq2rgb(yiq), 0.0, 1.0);

    fragColor = vec4(col, 1.0);
}`

export const CAMCORDER_GRADE_FRAG = `#version 300 es
                        precision highp float;

                        
            uniform vec2 iResolution;
            uniform float iTime;
            uniform float iGlobalTime;
            uniform float iAspect;
            uniform int iFrame;
            uniform vec4 iMouse;

            uniform highp sampler2D iChannel0;
            uniform highp sampler2D iChannel1;
            uniform highp sampler2D iChannel2;
            uniform highp sampler2D iChannel3;
            uniform highp sampler2D iChannel4;
            uniform highp sampler2D iChannel5;
            uniform highp sampler2D iChannel6;
            uniform highp sampler2D iChannel7;

            uniform vec2 iChannelResolution0;
            uniform vec2 iChannelResolution1;
            uniform vec2 iChannelResolution2;
            uniform vec2 iChannelResolution3;
            uniform vec2 iChannelResolution4;
            uniform vec2 iChannelResolution5;
            uniform vec2 iChannelResolution6;
            uniform vec2 iChannelResolution7;
            

                        in vec2 vUV0;
                        out vec4 outFragColor;

                        void mainImage(out vec4, vec2);

                        vec4 texture2D(sampler2D tex, vec2 uv) {
                            return texture(tex, uv);
                        }

                        void main(void) {
                            outFragColor = vec4(0.0, 0.0, 0.0, 1.0);
                            mainImage(outFragColor, vUV0 * iResolution.xy);
                        }
                        






vec3 sRGBToLinear(vec3 c) {
    vec3 lo = c / 12.92;
    vec3 hi = pow((c + 0.055) / 1.055, vec3(2.4));
    return mix(lo, hi, step(0.04045, c));
}

vec3 linearTosRGB(vec3 c) {
    c = max(c, vec3(0.0));
    vec3 lo = c * 12.92;
    vec3 hi = 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055;
    return mix(lo, hi, step(0.0031308, c));
}


float luminance(vec3 col) { return dot(col, vec3(0.2126729, 0.7151522, 0.0721750)); }
float luma709(vec3 color) { return dot(color, vec3(0.2126, 0.7152, 0.0722)); }



vec3 linearToOklab(vec3 c) {
    vec3 l = vec3(
        0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b,
        0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b,
        0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b
    );
    vec3 lc = sign(l) * pow(abs(l), vec3(1.0 / 3.0));
    return vec3(
        0.2104542553 * lc.x + 0.7936177850 * lc.y - 0.0040720468 * lc.z,
        1.9779984951 * lc.x - 2.4285922050 * lc.y + 0.4505937099 * lc.z,
        0.0259040371 * lc.x + 0.7827717662 * lc.y - 0.8086757660 * lc.z
    );
}

vec3 oklabToLinear(vec3 lab) {
    vec3 lc = vec3(
        lab.x + 0.3963377774 * lab.y + 0.2158037573 * lab.z,
        lab.x - 0.1055613458 * lab.y - 0.0638541728 * lab.z,
        lab.x - 0.0894841775 * lab.y - 1.2914855480 * lab.z
    );
    vec3 l = lc * lc * lc;
    return vec3(
         4.0767416621 * l.x - 3.3077115913 * l.y + 0.2309699292 * l.z,
        -1.2684380046 * l.x + 2.6097574011 * l.y - 0.3413193965 * l.z,
        -0.0041960863 * l.x - 0.7034186147 * l.y + 1.7076147010 * l.z
    );
}




float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

float hash13(vec3 p3) {
    p3 = fract(p3 * 0.1031);
    p3 += dot(p3, p3.zyx + 31.32);
    return fract((p3.x + p3.y) * p3.z);
}

vec2 hash22(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.xx + p3.yz) * p3.zy);
}

vec2 hash23(vec3 p3) {
    p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.xx + p3.yz) * p3.zy);
}

vec3 hash33(vec3 p3) {
    p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yxz + 33.33);
    return fract((p3.xxy + p3.yxx) * p3.zyx);
}



uniform vec2 tint_global;     // label="Global tint", value=(0.0, 0.0), min=-1.0, max=1.0, step=0.01, random=0, ui=wheel
uniform float exp_global;     // label="Global Exposure", value=0.0, min=-4.0, max=4.0, step=0.01, unit=stops, random=0
uniform float sat_global;     // label="Global Saturation", value=1.0, min=0.0, max=2.0, step=0.1, random=0

//@group Black
uniform vec2 tint_black;      // label="Black tint", value=(0.0, 0.0), min=-1.0, max=1.0, step=0.001, random=0, ui=wheel
uniform float exp_black;      // label="Black Exposure", value=0.0, min=-4.0, max=4.0, step=0.01, unit=stops, random=0
uniform float sat_black;      // label="Black Saturation", value=1.0, min=0.0, max=2.0, step=0.01, random=0

//@group Shadow
uniform vec2 tint_shadow;     // label="Shadow tint", value=(0.0, 0.0), min=-1.0, max=1.0, step=0.001, random=0, ui=wheel
uniform float exp_shadow;     // label="Shadow Exposure", value=0.0, min=-4.0, max=4.0, step=0.01, unit=stops, random=0
uniform float sat_shadow;     // label="Shadow Saturation", value=1.0, min=0.0, max=2.0, step=0.01, random=0

//@group Light
uniform vec2 tint_light;      // label="Light tint", value=(0.0, 0.0), min=-1.0, max=1.0, step=0.001, random=0, ui=wheel
uniform float exp_light;      // label="Light Exposure", value=0.0, min=-4.0, max=4.0, step=0.01, unit=stops, random=0
uniform float sat_light;      // label="Light Saturation", value=1.0, min=0.0, max=2.0, step=0.01, random=0

//@group Highlight
uniform vec2 tint_highlight;  // label="Highlight tint", value=(0.0, 0.0), min=-1.0, max=1.0, step=0.001, random=0, ui=wheel
uniform float exp_highlight;  // label="Highlight Exposure", value=0.0, min=-4.0, max=4.0, step=0.01, unit=stops, random=0
uniform float sat_highlight;  // label="Highlight Saturation", value=1.0, min=0.0, max=2.0, step=0.01, random=0

//@group Specular
uniform vec2 tint_spec;       // label="Specular tint", value=(0.0, 0.0), min=-1.0, max=1.0, step=0.001, random=0, ui=wheel
uniform float exp_spec;       // label="Specular Exposure", value=0.0, min=-4.0, max=4.0, step=0.01, unit=stops, random=0
uniform float sat_spec;       // label="Specular Saturation", value=1.0, min=0.0, max=2.0, step=0.01, random=0

// @group Zones
uniform float pivot_black;    // label="Black | Shadow", value=-4.0, min=-8.0, max=-1.0, step=0.05, unit=stops
uniform float pivot_mid;      // label="Shadow | Light", value=0.0, min=-3.0, max=1.5, step=0.05, unit=stops
uniform float pivot_high;     // label="Light | Highlight", value=1.2, min=0.0, max=2.4, step=0.05, unit=stops
uniform float pivot_spec;     // label="Highlight | Specular", value=2.0, min=0.5, max=2.5, step=0.05, unit=stops
uniform float falloff;        // label="Zone Falloff", value=1.0, min=0.25, max=2.5, step=0.01, unit=stops
uniform float tint_scale;     // value=0.15, hidden
uniform float show_zones;     // label="Show zones", value=0.0, ui=switch, random=0

uniform float strength;       // label="Strength", value=1.0, min=0.0, max=1.0, step=0.01, random=0

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    vec4 src = texture(iChannel0, uv);
    vec3 lin = sRGBToLinear(src.rgb);

    
    
    float e = log2(max(luminance(lin), 1e-6) / 0.18);

    
    
    float p1 = pivot_black;
    float p2 = max(pivot_mid, p1 + 0.05);
    float p3 = max(pivot_high, p2 + 0.05);
    float p4 = max(pivot_spec, p3 + 0.05);
    float f = max(falloff, 1e-3);

    float c1 = smoothstep(p1 - f, p1 + f, e);
    float c2 = smoothstep(p2 - f, p2 + f, e);
    float c3 = smoothstep(p3 - f, p3 + f, e);
    float c4 = smoothstep(p4 - f, p4 + f, e);

    float wBlack = 1.0 - c1;
    float wShad  = c1 - c2;
    float wLight = c2 - c3;
    float wHigh  = c3 - c4;
    float wSpec  = c4;

    
    if (show_zones > 0.5) {
        vec3 zone = wBlack * vec3(0.15, 0.15, 0.5)
                  + wShad  * vec3(0.2, 0.45, 1.0)
                  + wLight * vec3(0.3, 0.9, 0.4)
                  + wHigh  * vec3(1.0, 0.8, 0.2)
                  + wSpec  * vec3(1.0, 0.25, 0.2);
        float shade = 0.25 + 0.75 * linearTosRGB(vec3(luminance(lin))).x;
        fragColor = vec4(zone * shade, src.a);
        return;
    }

    
    float stops = exp_global
        + exp_black * wBlack
        + exp_shadow * wShad
        + exp_light * wLight
        + exp_highlight * wHigh
        + exp_spec * wSpec;
    vec3 linExp = lin * exp2(stops);

    
    
    vec3 lab = linearToOklab(linExp);

    vec2 push = tint_global
        + tint_black * wBlack
        + tint_shadow * wShad
        + tint_light * wLight
        + tint_highlight * wHigh
        + tint_spec * wSpec;
    lab.yz += push * tint_scale;

    
    float sat = sat_black * wBlack
        + sat_shadow * wShad
        + sat_light * wLight
        + sat_highlight * wHigh
        + sat_spec * wSpec;
    lab.yz *= sat * sat_global;

    vec3 linCorrected = oklabToLinear(lab);

    
    
    float y = max(luminance(linCorrected), 1e-5);
    float mn = min(min(linCorrected.r, linCorrected.g), linCorrected.b);
    if (mn < 0.0) linCorrected = y + (linCorrected - y) * (y / (y - mn));
    linCorrected = clamp(linCorrected, 0.0, 1.0);

    
    lin = mix(lin, linCorrected, clamp(strength, 0.0, 1.0));

    vec3 outColor = linearTosRGB(lin);
    
    outColor += (hash12(fragCoord) - 0.5) / 255.0;

    fragColor = vec4(outColor, src.a);
}
`

export const CAMCORDER_BLUR_H_FRAG = `#version 300 es
                        precision highp float;

                        
            uniform vec2 iResolution;
            uniform float iTime;
            uniform float iGlobalTime;
            uniform float iAspect;
            uniform int iFrame;
            uniform vec4 iMouse;

            uniform highp sampler2D iChannel0;
            uniform highp sampler2D iChannel1;
            uniform highp sampler2D iChannel2;
            uniform highp sampler2D iChannel3;
            uniform highp sampler2D iChannel4;
            uniform highp sampler2D iChannel5;
            uniform highp sampler2D iChannel6;
            uniform highp sampler2D iChannel7;

            uniform vec2 iChannelResolution0;
            uniform vec2 iChannelResolution1;
            uniform vec2 iChannelResolution2;
            uniform vec2 iChannelResolution3;
            uniform vec2 iChannelResolution4;
            uniform vec2 iChannelResolution5;
            uniform vec2 iChannelResolution6;
            uniform vec2 iChannelResolution7;
            

                        in vec2 vUV0;
                        out vec4 outFragColor;

                        void mainImage(out vec4, vec2);

                        vec4 texture2D(sampler2D tex, vec2 uv) {
                            return texture(tex, uv);
                        }

                        void main(void) {
                            outFragColor = vec4(0.0, 0.0, 0.0, 1.0);
                            mainImage(outFragColor, vUV0 * iResolution.xy);
                        }
                        



// @gips_version=1 @coord=pixel @filter=off



const vec2 offset = vec2(0.0, 0.0);
const vec2 texScale = vec2(1.0, 1.0);














uniform vec2  iSrcResolution;  // full source size, px
uniform vec2  iWindowOffset;   // visible region origin, source px
uniform vec2  iWindowSize;     // visible region size, source px

bool winActive() {
    return iWindowSize.x > 0.5 && iSrcResolution.x > 0.5;
}


vec2 winSrcResolution() {
    return winActive() ? iSrcResolution : iResolution.xy;
}


vec2 winSrcCoord(vec2 fragCoord) {
    if (!winActive()) return fragCoord;
    return iWindowOffset + (fragCoord / iResolution.xy) * iWindowSize;
}


vec2 winSrcUV(vec2 fragCoord) {
    return winSrcCoord(fragCoord) / winSrcResolution();
}


float winSrcAspect() {
    vec2 r = winSrcResolution();
    return r.x / max(r.y, 1e-6);
}



















vec2 winRelScale() {
    float aspect = winSrcAspect();
    return aspect > 1.0 ? vec2(aspect, 1.0) : vec2(1.0, 1.0 / aspect);
}


vec2 winToRel(vec2 fragCoord) {
    return (winSrcUV(fragCoord) * 2.0 - 1.0) * winRelScale();
}


vec2 winFromRel(vec2 rel) {
    return (rel / winRelScale() + 1.0) * 0.5;
}


vec2 winNormToRel(vec2 n) {
    return n * winRelScale();
}








vec2 winBufUV(vec2 srcPx) {
    if (!winActive()) return srcPx / iResolution.xy;
    return (srcPx - iWindowOffset) / iWindowSize;
}


uniform float strength;   // value=14, min=.3, max=50, step=0.01
uniform float aspect;  // value=0, min=-2.0, max=2.0

vec4 pixel(in vec2 pos) {
    return textureLod(iChannel0, winBufUV(offset + pos * texScale), 0.0);
}

vec4 run_main(vec2 pos, vec2 dir, float radius) {
    vec4 color = pixel(pos);
    float wsum = 0.5;
    radius *= max(1.0, color.a);
    for (float dist = 1.0;  dist < radius;  dist += 1.0) {
        float w = 1.0 - dist / radius;
        w = 1.0 - w * w;
        w = 1.0 - w * w;
        color.rgb += w * (pixel(pos - dist * dir).rgb + pixel(pos + dist * dir).rgb);
        wsum += w;
    }
    return vec4(color.rgb / (wsum * 2.0), color.a);
}

vec4 run(vec2 pos) {
    return run_main(pos, vec2(1.0, 0.0), strength * 2.6412 * exp(aspect));
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    fragColor = run(winSrcCoord(fragCoord));
}
`

export const CAMCORDER_BLUR_V_FRAG = `#version 300 es
                        precision highp float;

                        
            uniform vec2 iResolution;
            uniform float iTime;
            uniform float iGlobalTime;
            uniform float iAspect;
            uniform int iFrame;
            uniform vec4 iMouse;

            uniform highp sampler2D iChannel0;
            uniform highp sampler2D iChannel1;
            uniform highp sampler2D iChannel2;
            uniform highp sampler2D iChannel3;
            uniform highp sampler2D iChannel4;
            uniform highp sampler2D iChannel5;
            uniform highp sampler2D iChannel6;
            uniform highp sampler2D iChannel7;

            uniform vec2 iChannelResolution0;
            uniform vec2 iChannelResolution1;
            uniform vec2 iChannelResolution2;
            uniform vec2 iChannelResolution3;
            uniform vec2 iChannelResolution4;
            uniform vec2 iChannelResolution5;
            uniform vec2 iChannelResolution6;
            uniform vec2 iChannelResolution7;
            

                        in vec2 vUV0;
                        out vec4 outFragColor;

                        void mainImage(out vec4, vec2);

                        vec4 texture2D(sampler2D tex, vec2 uv) {
                            return texture(tex, uv);
                        }

                        void main(void) {
                            outFragColor = vec4(0.0, 0.0, 0.0, 1.0);
                            mainImage(outFragColor, vUV0 * iResolution.xy);
                        }
                        



// @gips_version=1 @coord=pixel @filter=off



const vec2 offset = vec2(0.0, 0.0);
const vec2 texScale = vec2(1.0, 1.0);














uniform vec2  iSrcResolution;  // full source size, px
uniform vec2  iWindowOffset;   // visible region origin, source px
uniform vec2  iWindowSize;     // visible region size, source px

bool winActive() {
    return iWindowSize.x > 0.5 && iSrcResolution.x > 0.5;
}


vec2 winSrcResolution() {
    return winActive() ? iSrcResolution : iResolution.xy;
}


vec2 winSrcCoord(vec2 fragCoord) {
    if (!winActive()) return fragCoord;
    return iWindowOffset + (fragCoord / iResolution.xy) * iWindowSize;
}


vec2 winSrcUV(vec2 fragCoord) {
    return winSrcCoord(fragCoord) / winSrcResolution();
}


float winSrcAspect() {
    vec2 r = winSrcResolution();
    return r.x / max(r.y, 1e-6);
}



















vec2 winRelScale() {
    float aspect = winSrcAspect();
    return aspect > 1.0 ? vec2(aspect, 1.0) : vec2(1.0, 1.0 / aspect);
}


vec2 winToRel(vec2 fragCoord) {
    return (winSrcUV(fragCoord) * 2.0 - 1.0) * winRelScale();
}


vec2 winFromRel(vec2 rel) {
    return (rel / winRelScale() + 1.0) * 0.5;
}


vec2 winNormToRel(vec2 n) {
    return n * winRelScale();
}








vec2 winBufUV(vec2 srcPx) {
    if (!winActive()) return srcPx / iResolution.xy;
    return (srcPx - iWindowOffset) / iWindowSize;
}


uniform float strength;   // value=14, min=.3, max=50, step=0.01
uniform float aspect;  // value=0, min=-2.0, max=2.0

vec4 pixel(in vec2 pos) {
    return textureLod(iChannel0, winBufUV(offset + pos * texScale), 0.0);
}

vec4 run_main(vec2 pos, vec2 dir, float radius) {
    vec4 color = pixel(pos);
    float wsum = 0.5;
    radius *= max(1.0, color.a);
    for (float dist = 1.0;  dist < radius;  dist += 1.0) {
        float w = 1.0 - dist / radius;
        w = 1.0 - w * w;
        w = 1.0 - w * w;
        color.rgb += w * (pixel(pos - dist * dir).rgb + pixel(pos + dist * dir).rgb);
        wsum += w;
    }
    return vec4(color.rgb / (wsum * 2.0), color.a);
}

vec4 run(vec2 pos) {
    return run_main(pos, vec2(0.0, 1.0), strength * 2.6412 * exp(-aspect));
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    fragColor = run(winSrcCoord(fragCoord));
}
`

export const CAMCORDER_BLUR_MIX_FRAG = `#version 300 es
                        precision highp float;

                        
            uniform vec2 iResolution;
            uniform float iTime;
            uniform float iGlobalTime;
            uniform float iAspect;
            uniform int iFrame;
            uniform vec4 iMouse;

            uniform highp sampler2D iChannel0;
            uniform highp sampler2D iChannel1;
            uniform highp sampler2D iChannel2;
            uniform highp sampler2D iChannel3;
            uniform highp sampler2D iChannel4;
            uniform highp sampler2D iChannel5;
            uniform highp sampler2D iChannel6;
            uniform highp sampler2D iChannel7;

            uniform vec2 iChannelResolution0;
            uniform vec2 iChannelResolution1;
            uniform vec2 iChannelResolution2;
            uniform vec2 iChannelResolution3;
            uniform vec2 iChannelResolution4;
            uniform vec2 iChannelResolution5;
            uniform vec2 iChannelResolution6;
            uniform vec2 iChannelResolution7;
            

                        in vec2 vUV0;
                        out vec4 outFragColor;

                        void mainImage(out vec4, vec2);

                        vec4 texture2D(sampler2D tex, vec2 uv) {
                            return texture(tex, uv);
                        }

                        void main(void) {
                            outFragColor = vec4(0.0, 0.0, 0.0, 1.0);
                            mainImage(outFragColor, vUV0 * iResolution.xy);
                        }
                        



// @gips_version=1 @coord=pixel @filter=off

const vec2 offset = vec2(0.0, 0.0);
const vec2 texScale = vec2(1.0, 1.0);














uniform vec2  iSrcResolution;  // full source size, px
uniform vec2  iWindowOffset;   // visible region origin, source px
uniform vec2  iWindowSize;     // visible region size, source px

bool winActive() {
    return iWindowSize.x > 0.5 && iSrcResolution.x > 0.5;
}


vec2 winSrcResolution() {
    return winActive() ? iSrcResolution : iResolution.xy;
}


vec2 winSrcCoord(vec2 fragCoord) {
    if (!winActive()) return fragCoord;
    return iWindowOffset + (fragCoord / iResolution.xy) * iWindowSize;
}


vec2 winSrcUV(vec2 fragCoord) {
    return winSrcCoord(fragCoord) / winSrcResolution();
}


float winSrcAspect() {
    vec2 r = winSrcResolution();
    return r.x / max(r.y, 1e-6);
}



















vec2 winRelScale() {
    float aspect = winSrcAspect();
    return aspect > 1.0 ? vec2(aspect, 1.0) : vec2(1.0, 1.0 / aspect);
}


vec2 winToRel(vec2 fragCoord) {
    return (winSrcUV(fragCoord) * 2.0 - 1.0) * winRelScale();
}


vec2 winFromRel(vec2 rel) {
    return (rel / winRelScale() + 1.0) * 0.5;
}


vec2 winNormToRel(vec2 n) {
    return n * winRelScale();
}








vec2 winBufUV(vec2 srcPx) {
    if (!winActive()) return srcPx / iResolution.xy;
    return (srcPx - iWindowOffset) / iWindowSize;
}


uniform float opacity;    // label=opacity, value=1.0, min=0.0, max=1.0, step=0.01, desc=opacity of blurred layer
uniform int blendMode;    // ui=dropdown, label="Blend mode", options=[Normal:0|Multiply:1|Subtract:2|Divide:3|Lighten:4|Screen:5], value=0

vec4 pixelBlurred(in vec2 pos) {
    return textureLod(iChannel0, winBufUV(offset + pos * texScale), 0.0); 
}

vec4 pixelOriginal(in vec2 pos) {
    
    return textureLod(iChannel7, winBufUV(offset + pos * texScale), 0.0); 
}







float blendLuma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }


vec3 blendRgb2hsl(vec3 c) {
    float mx = max(c.r, max(c.g, c.b));
    float mn = min(c.r, min(c.g, c.b));
    float l = (mx + mn) * 0.5;
    float d = mx - mn;
    float h = 0.0;
    float s = 0.0;
    if (d > 1e-6) {
        s = d / (l < 0.5 ? mx + mn : 2.0 - mx - mn);
        if (mx == c.r)      h = (c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0);
        else if (mx == c.g) h = (c.b - c.r) / d + 2.0;
        else                h = (c.r - c.g) / d + 4.0;
        h *= 60.0 / 360.0;
    }
    return vec3(h, s, l);
}

vec3 blendHsl2rgb(vec3 hsl) {
    float h = hsl.x * 6.0;   
    float s = hsl.y;
    float l = hsl.z;
    float c = (1.0 - abs(2.0 * l - 1.0)) * s;
    float x = c * (1.0 - abs(mod(h, 2.0) - 1.0));
    float m = l - c * 0.5;
    vec3 rgb;
    if      (h < 1.0) rgb = vec3(c, x, 0.0);
    else if (h < 2.0) rgb = vec3(x, c, 0.0);
    else if (h < 3.0) rgb = vec3(0.0, c, x);
    else if (h < 4.0) rgb = vec3(0.0, x, c);
    else if (h < 5.0) rgb = vec3(x, 0.0, c);
    else              rgb = vec3(c, 0.0, x);
    return rgb + m;
}

vec3 blendNormal(vec3 base, vec3 src)    { return src; }
vec3 blendMultiply(vec3 base, vec3 src)  { return base * src; }
vec3 blendScreen(vec3 base, vec3 src)    { return 1.0 - (1.0 - base) * (1.0 - src); }
vec3 blendLighten(vec3 base, vec3 src)   { return max(base, src); }
vec3 blendSubtract(vec3 base, vec3 src)  { return max(base - src, 0.0); }
vec3 blendDivide(vec3 base, vec3 src) {
    return vec3(
        src.r <= 0.0 ? 1.0 : min(base.r / src.r, 1.0),
        src.g <= 0.0 ? 1.0 : min(base.g / src.g, 1.0),
        src.b <= 0.0 ? 1.0 : min(base.b / src.b, 1.0)
    );
}
vec3 blendOverlay(vec3 base, vec3 src) {
    return vec3(
        base.r < 0.5 ? 2.0*base.r*src.r : 1.0-2.0*(1.0-base.r)*(1.0-src.r),
        base.g < 0.5 ? 2.0*base.g*src.g : 1.0-2.0*(1.0-base.g)*(1.0-src.g),
        base.b < 0.5 ? 2.0*base.b*src.b : 1.0-2.0*(1.0-base.b)*(1.0-src.b)
    );
}
vec3 blendSoftLight(vec3 base, vec3 src) {
    return vec3(
        src.r < 0.5 ? 2.0*base.r*src.r + base.r*base.r*(1.0-2.0*src.r) : sqrt(base.r)*(2.0*src.r-1.0)+2.0*base.r*(1.0-src.r),
        src.g < 0.5 ? 2.0*base.g*src.g + base.g*base.g*(1.0-2.0*src.g) : sqrt(base.g)*(2.0*src.g-1.0)+2.0*base.g*(1.0-src.g),
        src.b < 0.5 ? 2.0*base.b*src.b + base.b*base.b*(1.0-2.0*src.b) : sqrt(base.b)*(2.0*src.b-1.0)+2.0*base.b*(1.0-src.b)
    );
}
vec3 blendHardLight(vec3 base, vec3 src) {
    return vec3(
        src.r < 0.5 ? 2.0*base.r*src.r : 1.0-2.0*(1.0-base.r)*(1.0-src.r),
        src.g < 0.5 ? 2.0*base.g*src.g : 1.0-2.0*(1.0-base.g)*(1.0-src.g),
        src.b < 0.5 ? 2.0*base.b*src.b : 1.0-2.0*(1.0-base.b)*(1.0-src.b)
    );
}
vec3 blendColorDodge(vec3 base, vec3 src) {
    return vec3(
        src.r >= 1.0 ? 1.0 : min(base.r / (1.0 - src.r), 1.0),
        src.g >= 1.0 ? 1.0 : min(base.g / (1.0 - src.g), 1.0),
        src.b >= 1.0 ? 1.0 : min(base.b / (1.0 - src.b), 1.0)
    );
}
vec3 blendColorBurn(vec3 base, vec3 src) {
    return vec3(
        src.r <= 0.0 ? 0.0 : max(1.0 - (1.0 - base.r) / src.r, 0.0),
        src.g <= 0.0 ? 0.0 : max(1.0 - (1.0 - base.g) / src.g, 0.0),
        src.b <= 0.0 ? 0.0 : max(1.0 - (1.0 - base.b) / src.b, 0.0)
    );
}
vec3 blendVividLight(vec3 base, vec3 src) {
    return vec3(
        src.r < 0.5 ? blendColorBurn(vec3(base.r), vec3(2.0*src.r)).r : blendColorDodge(vec3(base.r), vec3(2.0*(src.r-0.5))).r,
        src.g < 0.5 ? blendColorBurn(vec3(base.g), vec3(2.0*src.g)).g : blendColorDodge(vec3(base.g), vec3(2.0*(src.g-0.5))).g,
        src.b < 0.5 ? blendColorBurn(vec3(base.b), vec3(2.0*src.b)).b : blendColorDodge(vec3(base.b), vec3(2.0*(src.b-0.5))).b
    );
}
vec3 blendHardMix(vec3 base, vec3 src)  { return step(vec3(0.5), blendVividLight(base, src)); }
vec3 blendDarken(vec3 base, vec3 src)   { return min(base, src); }
vec3 blendDifference(vec3 base, vec3 src) { return abs(base - src); }
vec3 blendExclusion(vec3 base, vec3 src)  { return base + src - 2.0 * base * src; }
vec3 blendLinearBurn(vec3 base, vec3 src) { return max(base + src - 1.0, 0.0); }
vec3 blendLinearDodge(vec3 base, vec3 src) { return min(base + src, 1.0); }  
vec3 blendLinearLight(vec3 base, vec3 src) {
    return vec3(
        src.r < 0.5 ? blendLinearBurn(vec3(base.r), vec3(2.0*src.r)).r : blendLinearDodge(vec3(base.r), vec3(2.0*(src.r-0.5))).r,
        src.g < 0.5 ? blendLinearBurn(vec3(base.g), vec3(2.0*src.g)).g : blendLinearDodge(vec3(base.g), vec3(2.0*(src.g-0.5))).g,
        src.b < 0.5 ? blendLinearBurn(vec3(base.b), vec3(2.0*src.b)).b : blendLinearDodge(vec3(base.b), vec3(2.0*(src.b-0.5))).b
    );
}
vec3 blendPinLight(vec3 base, vec3 src) {
    return vec3(
        src.r < 0.5 ? min(base.r, 2.0*src.r) : max(base.r, 2.0*(src.r-0.5)),
        src.g < 0.5 ? min(base.g, 2.0*src.g) : max(base.g, 2.0*(src.g-0.5)),
        src.b < 0.5 ? min(base.b, 2.0*src.b) : max(base.b, 2.0*(src.b-0.5))
    );
}
vec3 blendHardMixPS(vec3 base, vec3 src) { return step(1.0 - src, base); }  




vec3 blendHueChannel(vec3 base, vec3 src) {
    vec3 bHSL = blendRgb2hsl(base);
    vec3 sHSL = blendRgb2hsl(src);
    return blendHsl2rgb(vec3(sHSL.x, bHSL.y, bHSL.z));
}
vec3 blendSaturationChannel(vec3 base, vec3 src) {
    vec3 bHSL = blendRgb2hsl(base);
    vec3 sHSL = blendRgb2hsl(src);
    return blendHsl2rgb(vec3(bHSL.x, sHSL.y, bHSL.z));
}
vec3 blendColorChannel(vec3 base, vec3 src) {
    vec3 bHSL = blendRgb2hsl(base);
    vec3 sHSL = blendRgb2hsl(src);
    return blendHsl2rgb(vec3(sHSL.x, sHSL.y, bHSL.z));
}



vec3 blendClipColor(vec3 c) {
    float l = blendLuma(c);
    float lo = min(c.r, min(c.g, c.b));
    float hi = max(c.r, max(c.g, c.b));
    if (lo < 0.0) c = l + (c - l) * l / max(l - lo, 1e-6);
    if (hi > 1.0) c = l + (c - l) * (1.0 - l) / max(hi - l, 1e-6);
    return c;
}


vec3 blendLuminosityChannel(vec3 base, vec3 src) {
    return blendClipColor(base + (blendLuma(src) - blendLuma(base)));
}


vec3 applyBlendMode(vec3 base, vec3 blend, int mode) {
    if (mode == 0) return blendNormal(base, blend);
    if (mode == 1) return blendMultiply(base, blend);
    if (mode == 2) return blendSubtract(base, blend);
    if (mode == 3) return blendDivide(base, blend);
    if (mode == 4) return blendLighten(base, blend);
    if (mode == 5) return blendScreen(base, blend);
    return blend; 
}

vec4 run(vec2 pos) {
    vec4 blurred = pixelBlurred(pos);
    vec4 original = pixelOriginal(pos);

    
    vec3 blendedColor = applyBlendMode(original.rgb, blurred.rgb, blendMode);

    
    vec3 finalColor = mix(original.rgb, blendedColor, opacity);

    
    return vec4(finalColor, original.a);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    fragColor = run(winSrcCoord(fragCoord));
}
`
