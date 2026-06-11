import React from "react";

// Inline SVG replacements for the handful of icons the app used, so we no
// longer load the ionicons web-component runtime + render-blocking CSS from a
// CDN (which also fetched each glyph over the network). Paths are the official
// ionicons v7 outline glyphs (viewBox 0 0 512 512, drawn with currentColor).
const ICONS = {
  "arrow-undo-outline": (
    <path
      d="M240 424v-96c116.4 0 159.39 33.76 208 96 0-119.23-39.57-240-208-240V88L64 256z"
      fill="none"
      stroke="currentColor"
      strokeLinejoin="round"
      strokeWidth="32"
    />
  ),
  "arrow-redo-outline": (
    <path
      d="M448 256L272 88v96C103.57 184 64 304.77 64 424c48.61-62.24 91.6-96 208-96v96z"
      fill="none"
      stroke="currentColor"
      strokeLinejoin="round"
      strokeWidth="32"
    />
  ),
  "menu-outline": (
    <path
      d="M80 160h352M80 256h352M80 352h352"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeMiterlimit="10"
      strokeWidth="32"
    />
  ),
  "search-outline": (
    <>
      <path
        d="M221.09 64a157.09 157.09 0 10157.09 157.09A157.1 157.1 0 00221.09 64z"
        fill="none"
        stroke="currentColor"
        strokeMiterlimit="10"
        strokeWidth="32"
      />
      <path
        d="M338.29 338.29L448 448"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeMiterlimit="10"
        strokeWidth="32"
      />
    </>
  ),
  "download-outline": (
    <>
      <path
        d="M336 176h40a40 40 0 0140 40v208a40 40 0 01-40 40H136a40 40 0 01-40-40V216a40 40 0 0140-40h40"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="32"
      />
      <path
        d="M176 272l80 80 80-80M256 48v288"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="32"
      />
    </>
  ),
  "create-outline": (
    <>
      <path
        d="M352 64l96 96-256 256H96v-96L352 64z"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="32"
      />
      <path
        d="M304 112l96 96"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="32"
      />
    </>
  ),
  "play-circle-outline": (
    <>
      <path
        d="M256 48C141.13 48 48 141.13 48 256s93.13 208 208 208 208-93.13 208-208S370.87 48 256 48z"
        fill="none"
        stroke="currentColor"
        strokeMiterlimit="10"
        strokeWidth="32"
      />
      <path d="M224 176l112 80-112 80V176z" fill="currentColor" />
    </>
  ),
  "map-outline": (
    <>
      <path
        d="M48 96l128-48 160 48 128-48v368l-128 48-160-48-128 48V96z"
        fill="none"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="32"
      />
      <path
        d="M176 48v368M336 96v368"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="32"
      />
    </>
  ),
  "chevron-back-outline": (
    <path
      d="M328 112L184 256l144 144"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="48"
    />
  ),
  "chevron-forward-outline": (
    <path
      d="M184 112l144 144-144 144"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="48"
    />
  ),
  "trash-outline": (
    <>
      <path
        d="M112 112l20 320c.95 18.49 14.4 32 32 32h184c17.67 0 30.87-13.51 32-32l20-320"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="32"
      />
      <path
        d="M80 112h352"
        stroke="currentColor"
        strokeLinecap="round"
        strokeMiterlimit="10"
        strokeWidth="32"
      />
      <path
        d="M192 112V72h0a23.93 23.93 0 0124-24h80a23.93 23.93 0 0124 24h0v40M256 176v224M184 176l8 224M328 176l-8 224"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="32"
      />
    </>
  ),
  "bicycle-outline": (
    <>
      <path
        d="M388 288a76 76 0 1076 76 76.24 76.24 0 00-76-76z"
        fill="none"
        stroke="currentColor"
        strokeMiterlimit="10"
        strokeWidth="32"
      />
      <path
        d="M124 288a76 76 0 1076 76 76.24 76.24 0 00-76-76z"
        fill="none"
        stroke="currentColor"
        strokeMiterlimit="10"
        strokeWidth="32"
      />
      <polyline
        points="256 360 256 274 192 232 272 144 312 216 368 216"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="32"
      />
      <path
        d="M320 136a31.89 31.89 0 0032-32.1A31.55 31.55 0 00320.2 72a32 32 0 10-.2 64z"
        fill="currentColor"
      />
    </>
  ),
  "trail-sign-outline": (
    <>
      <path
        d="M256 400v64M256 208v64M256 48v32"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="32"
      />
      <path
        d="M416 208H102.63a16 16 0 01-11.32-4.69L32 144l59.31-59.31A16 16 0 01102.63 80H416a16 16 0 0116 16v96a16 16 0 01-16 16z"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="32"
      />
      <path
        d="M96 400h313.37a16 16 0 0011.32-4.69L480 336l-59.31-59.31A16 16 0 00409.37 272H96a16 16 0 00-16 16v96a16 16 0 0016 16z"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="32"
      />
    </>
  ),
  "locate-outline": (
    <>
      <line x1="256" y1="48" x2="256" y2="96" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="32" />
      <line x1="256" y1="416" x2="256" y2="464" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="32" />
      <line x1="464" y1="256" x2="416" y2="256" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="32" />
      <line x1="96" y1="256" x2="48" y2="256" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="32" />
      <circle cx="256" cy="256" r="160" fill="none" stroke="currentColor" strokeWidth="32" />
    </>
  ),
  "car-outline": (
    <>
      <path
        d="M80 224l37.78-88.15C123.93 121.5 139.6 112 157.11 112h197.78c17.51 0 33.18 9.5 39.33 23.85L432 224"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="32"
      />
      <rect
        x="80"
        y="224"
        width="352"
        height="144"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="32"
      />
      <polyline
        points="112 368 112 400 80 400 80 368"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="32"
      />
      <polyline
        points="432 368 432 400 400 400 400 368"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="32"
      />
      <circle
        cx="144"
        cy="288"
        r="16"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="32"
      />
      <circle
        cx="368"
        cy="288"
        r="16"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="32"
      />
    </>
  ),
};

export default function Icon({ name, className, ...rest }) {
  const glyph = ICONS[name];
  if (!glyph) return null;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 512 512"
      width="1em"
      height="1em"
      className={className}
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {glyph}
    </svg>
  );
}
