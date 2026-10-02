import { useId } from 'react';

const leftLens = 'M241 123C228 94 199 82 158 83C115 82 88 103 77 135C63 175 71 217 102 238C128 255 170 254 204 238C234 221 248 188 249 158C250 144 247 132 241 123Z';
const rightLens = 'M333 121C349 91 382 82 418 82C457 82 485 104 495 137C506 174 496 212 469 233C443 253 399 253 365 235C339 220 325 191 324 159C323 143 327 130 333 121Z';

export default function AvatarGlasses() {
  const id = useId();
  return <svg className="hero-avatar-glasses" viewBox="0 0 543 636" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id={`${id}-frame`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#252a30" /><stop offset="0.4" stopColor="#101317" /><stop offset="1" stopColor="#07090c" />
      </linearGradient>
      <linearGradient id={`${id}-lens`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#ffffff" stopOpacity="0.08" /><stop offset="1" stopColor="#dbeaff" stopOpacity="0.01" />
      </linearGradient>
    </defs>
    <g fill="none" stroke={`url(#${id}-frame)`} strokeWidth="11" strokeLinecap="round" strokeLinejoin="round">
      <path d="M78 136C66 137 57 139 45 140L47 152L69 157M495 136L527 137L524 151L502 157" />
      <path d="M247 133C271 119 304 119 327 132" strokeWidth="13" />
      <path d={leftLens} fill={`url(#${id}-lens)`} />
      <path d={rightLens} fill={`url(#${id}-lens)`} />
    </g>
    <g fill="none" stroke="#a8b4c4" strokeWidth="2" strokeLinecap="round" opacity="0.38">
      <path d="M91 128C103 102 130 90 161 90M346 115C365 94 390 88 418 89M257 129C276 123 299 123 317 129" />
    </g>
  </svg>;
}
