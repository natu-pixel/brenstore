import { useEffect, useRef } from 'react';

/**
 * Brenstore mascot: a friendly little robot with a shopping-cart head.
 * Original SVG artwork. Layers move on mouse parallax via the
 * --mx / --my / --prox CSS variables updated (with smoothing) below.
 */
export default function Avatar() {
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;

    let targetX = 0;
    let targetY = 0;
    let x = 0;
    let y = 0;
    let targetProx = 0;
    let prox = 0;
    let raf = 0;

    const onMove = (e: MouseEvent) => {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      // normalised -1 .. 1, measured from the avatar centre (extra sensitivity)
      targetX = Math.max(-1, Math.min(1, (e.clientX - cx) / (window.innerWidth / 3)));
      targetY = Math.max(-1, Math.min(1, (e.clientY - cy) / (window.innerHeight / 3)));
      // proximity 0..1 — how close the cursor is to the avatar
      const dist = Math.hypot(e.clientX - cx, e.clientY - cy);
      targetProx = Math.max(0, 1 - dist / (r.width * 1.1));
    };

    const onLeave = () => {
      targetX = 0;
      targetY = 0;
      targetProx = 0;
    };

    const tick = () => {
      x += (targetX - x) * 0.14;
      y += (targetY - y) * 0.14;
      prox += (targetProx - prox) * 0.06;
      el.style.setProperty('--mx', x.toFixed(4));
      el.style.setProperty('--my', y.toFixed(4));
      el.style.setProperty('--prox', prox.toFixed(4));
      raf = requestAnimationFrame(tick);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseout', onLeave);
    raf = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseout', onLeave);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div className="avatar-wrap" ref={wrapRef} aria-hidden="true">
      <div className="avatar-halo" />

      {/* deep parallax layer: floating particles */}
      <svg className="avatar-layer avatar-particles" viewBox="0 0 520 560">
        <g fill="#3B82F6">
          <circle cx="70" cy="120" r="4" opacity="0.35" />
          <circle cx="450" cy="90" r="6" opacity="0.25" />
          <circle cx="480" cy="260" r="3" opacity="0.4" />
          <circle cx="40" cy="330" r="5" opacity="0.3" />
          <circle cx="120" cy="60" r="3" opacity="0.45" />
          <circle cx="410" cy="420" r="4" opacity="0.3" />
          <circle cx="60" cy="470" r="3" opacity="0.35" />
        </g>
        <g stroke="#93C5FD" strokeWidth="1.5" fill="none" opacity="0.5">
          <path d="M430 150 l14 0 M437 143 l0 14" />
          <path d="M80 240 l12 0 M86 234 l0 12" />
          <path d="M460 360 l12 0 M466 354 l0 12" />
        </g>
      </svg>

      {/* rotating orbit ring + satellite */}
      <svg className="avatar-layer avatar-orbit-layer" viewBox="0 0 520 560">
        <g className="avatar-orbit">
          <circle
            cx="260"
            cy="290"
            r="225"
            fill="none"
            stroke="#93C5FD"
            strokeWidth="1.5"
            strokeDasharray="3 14"
            opacity="0.7"
          />
          <circle cx="485" cy="290" r="6" fill="#2563EB" opacity="0.85" />
          <circle cx="485" cy="290" r="11" fill="none" stroke="#60A5FA" strokeWidth="1.5" opacity="0.5" />
        </g>
      </svg>

      {/* the robot */}
      <svg className="avatar-layer avatar-figure" viewBox="0 0 520 560">
        <defs>
          <linearGradient id="metalGrad" x1="0.2" y1="0" x2="0.8" y2="1">
            <stop offset="0" stopColor="#F2F5FA" />
            <stop offset="0.55" stopColor="#D5DCE8" />
            <stop offset="1" stopColor="#AAB6C9" />
          </linearGradient>
          <linearGradient id="metalDark" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#C6CFDD" />
            <stop offset="1" stopColor="#98A5BB" />
          </linearGradient>
          <linearGradient id="screenGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#141B2E" />
            <stop offset="1" stopColor="#080C18" />
          </linearGradient>
          <radialGradient id="eyeCore" cx="0.5" cy="0.5" r="0.7">
            <stop offset="0" stopColor="#E0F2FE" />
            <stop offset="0.45" stopColor="#7DD3FC" />
            <stop offset="1" stopColor="#2563EB" />
          </radialGradient>
          <filter id="softGlow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="8" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <clipPath id="screenClip">
            <rect x="185" y="150" width="170" height="76" rx="16" />
          </clipPath>
        </defs>

        {/* ground shadow */}
        <ellipse cx="260" cy="512" rx="120" ry="16" fill="#0F172A" opacity="0.12" />

        {/* ===== body ===== */}
        <g className="avatar-body">
          {/* legs */}
          <rect x="216" y="398" width="34" height="66" rx="16" fill="url(#metalDark)" />
          <rect x="270" y="398" width="34" height="66" rx="16" fill="url(#metalDark)" />
          <ellipse cx="233" cy="486" rx="30" ry="16" fill="url(#metalGrad)" />
          <ellipse cx="287" cy="486" rx="30" ry="16" fill="url(#metalGrad)" />

          {/* torso */}
          <rect x="187" y="288" width="146" height="122" rx="42" fill="url(#metalGrad)" />
          {/* chest panel */}
          <rect x="222" y="316" width="76" height="52" rx="14" fill="url(#screenGrad)" />
          <circle cx="260" cy="342" r="9" fill="#38BDF8" filter="url(#softGlow)">
            <animate attributeName="opacity" values="1;0.35;1" dur="2.4s" repeatCount="indefinite" />
          </circle>

          {/* left arm — waves on hover */}
          <g className="avatar-arm">
            <rect x="148" y="296" width="30" height="72" rx="15" fill="url(#metalDark)" />
            <circle cx="163" cy="378" r="17" fill="url(#metalGrad)" />
          </g>
          {/* right arm */}
          <rect x="342" y="296" width="30" height="72" rx="15" fill="url(#metalDark)" />
          <circle cx="357" cy="378" r="17" fill="url(#metalGrad)" />

          {/* neck */}
          <rect x="242" y="258" width="36" height="34" rx="10" fill="url(#metalDark)" />
        </g>

        {/* ===== shopping-cart head ===== */}
        <g className="avatar-head">
          {/* cart handle */}
          <path
            d="M152 150 L108 100"
            stroke="url(#metalDark)"
            strokeWidth="12"
            strokeLinecap="round"
          />
          <path d="M92 92 L124 92" stroke="url(#metalDark)" strokeWidth="14" strokeLinecap="round" />

          {/* basket (the head) */}
          <path
            d="M150 128
               Q150 118 160 118
               L380 118
               Q390 118 390 128
               L372 236
               Q370 248 358 248
               L182 248
               Q170 248 168 236 Z"
            fill="url(#metalGrad)"
          />
          {/* basket grid hint under the screen */}
          <g stroke="#98A5BB" strokeWidth="3" opacity="0.7">
            <path d="M196 234 l4 -8 M228 234 l3 -8 M260 234 l0 -8 M292 234 l-3 -8 M324 234 l-4 -8 M344 234 l-4 -8" />
          </g>

          {/* screen face */}
          <rect x="185" y="150" width="170" height="76" rx="16" fill="url(#screenGrad)" />
          <rect x="185" y="150" width="170" height="76" rx="16" fill="none" stroke="#0F172A" strokeWidth="3" opacity="0.5" />

          {/* eyes + smile drift toward the cursor and blink */}
          <g className="avatar-eyes" filter="url(#softGlow)">
            <g className="avatar-blink">
              <ellipse cx="228" cy="184" rx="13" ry="15" fill="url(#eyeCore)" />
              <ellipse cx="312" cy="184" rx="13" ry="15" fill="url(#eyeCore)" />
            </g>
            <path
              d="M248 208 Q270 220 292 208"
              stroke="#7DD3FC"
              strokeWidth="5"
              strokeLinecap="round"
              fill="none"
            />
          </g>

          {/* scan line sweeping across the screen */}
          <g clipPath="url(#screenClip)">
            <rect
              className="avatar-scanline"
              x="175"
              y="146"
              width="22"
              height="84"
              fill="#E0F2FE"
              opacity="0.35"
            />
          </g>

          {/* cart wheels as little ears */}
          <g>
            <circle cx="196" cy="262" r="12" fill="#1E2433" />
            <circle cx="196" cy="262" r="5" fill="#AAB6C9" />
            <circle cx="324" cy="262" r="12" fill="#1E2433" />
            <circle cx="324" cy="262" r="5" fill="#AAB6C9" />
          </g>

          {/* antenna */}
          <path d="M260 118 L260 96" stroke="url(#metalDark)" strokeWidth="8" strokeLinecap="round" />
          <circle cx="260" cy="88" r="9" fill="#38BDF8" filter="url(#softGlow)">
            <animate attributeName="r" values="9;7;9" dur="2s" repeatCount="indefinite" />
          </circle>
        </g>
      </svg>

      {/* greeting bubble on hover */}
      <div className="avatar-bubble">
        <strong>Hi, I'm Bren 👋</strong>
        <span>Your shopping buddy</span>
      </div>
    </div>
  );
}
