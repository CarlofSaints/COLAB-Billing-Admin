import { SUB_BRANDS } from "@/lib/brands";

/**
 * The Team Hub wallpaper.
 *
 * Drawn entirely in SVG and CSS rather than shipped as an image: nothing to
 * host, nothing to block, it stays crisp at any size and it costs about a
 * kilobyte. It also means the palette is the real one — every colour here is a
 * sub-company's brand colour from `brands.ts`, the same five that make up the
 * dots under the COLAB wordmark. Change a brand colour and the wallpaper
 * follows.
 *
 * The brief was "light and subtle but fun" — sticker-wall energy without the
 * noise. So: a few soft colour blooms, then a scattered, rotated confetti of
 * marks at very low alpha. Everything sits under 12% opacity, because the
 * cards on top carry real information and have to stay easy to read.
 *
 * Fixed to the viewport, so it behaves like wallpaper and doesn't scroll with
 * the content. `aria-hidden` and `pointer-events-none` — it's decoration and
 * must never take a click or reach a screen reader.
 */

const [AM, IRAM, OJ, AD, CAT] = [
  SUB_BRANDS["atomic marketing"].color, // red
  SUB_BRANDS["iram"].color, // green
  SUB_BRANDS["outerjoin"].color, // orange
  SUB_BRANDS["atomic digital"].color, // cyan
  SUB_BRANDS["catalyst sell-out"].color, // purple
];

/** One tile of scattered marks, repeated across the page. */
function StickerTile() {
  return (
    <>
      {/* Rings */}
      <circle cx="52" cy="46" r="17" fill="none" stroke={AD} strokeWidth="5" />
      <circle cx="262" cy="118" r="11" fill="none" stroke={AM} strokeWidth="4" />
      <circle cx="150" cy="292" r="22" fill="none" stroke={CAT} strokeWidth="4" />

      {/* Solid dots — the wordmark's dots, scattered */}
      <circle cx="196" cy="42" r="7" fill={IRAM} />
      <circle cx="96" cy="168" r="5" fill={OJ} />
      <circle cx="300" cy="238" r="8" fill={AD} />
      <circle cx="28" cy="256" r="6" fill={AM} />
      <circle cx="232" cy="330" r="5" fill={IRAM} />

      {/* Squiggles — a hand-drawn wobble, not a smooth wave */}
      <path
        d="M112 92c14-16 28 12 42-4s26 10 40-6"
        fill="none"
        stroke={OJ}
        strokeWidth="5"
        strokeLinecap="round"
      />
      <path
        d="M18 330c16-14 30 10 46-6"
        fill="none"
        stroke={CAT}
        strokeWidth="4.5"
        strokeLinecap="round"
      />
      <path
        d="M244 196c12-12 24 8 36-4"
        fill="none"
        stroke={IRAM}
        strokeWidth="4.5"
        strokeLinecap="round"
      />

      {/* Crosses / sparkles */}
      <g stroke={AM} strokeWidth="4.5" strokeLinecap="round">
        <path d="M172 148l16 16M188 148l-16 16" />
      </g>
      <g stroke={AD} strokeWidth="4.5" strokeLinecap="round">
        <path d="M62 214l14 14M76 214l-14 14" />
      </g>

      {/* Four-point stars */}
      <path
        d="M320 40c3 12 6 15 18 18-12 3-15 6-18 18-3-12-6-15-18-18 12-3 15-6 18-18z"
        fill={CAT}
      />
      <path
        d="M124 236c2 9 4 11 13 13-9 2-11 4-13 13-2-9-4-11-13-13 9-2 11-4 13-13z"
        fill={OJ}
      />

      {/* Rounded squares, tilted like stuck-on stickers */}
      <rect
        x="270"
        y="284"
        width="28"
        height="28"
        rx="8"
        fill="none"
        stroke={OJ}
        strokeWidth="4"
        transform="rotate(14 284 298)"
      />
      <rect
        x="196"
        y="248"
        width="20"
        height="20"
        rx="6"
        fill={AM}
        transform="rotate(-12 206 258)"
      />
      <rect
        x="14"
        y="120"
        width="24"
        height="24"
        rx="7"
        fill="none"
        stroke={IRAM}
        strokeWidth="4"
        transform="rotate(-18 26 132)"
      />

      {/* Triangles */}
      <path d="M330 160l14 24h-28z" fill={IRAM} />
      <path d="M84 300l11 19H73z" fill={AD} />

      {/* A speech bubble — the sticker-wall staple */}
      <path
        d="M212 78h44a8 8 0 0 1 8 8v22a8 8 0 0 1-8 8h-16l-10 12v-12h-18a8 8 0 0 1-8-8V86a8 8 0 0 1 8-8z"
        fill="none"
        stroke={CAT}
        strokeWidth="4"
      />

      {/* Dashes / motion marks */}
      <g stroke={AD} strokeWidth="5" strokeLinecap="round">
        <path d="M140 20h22M148 34h22" />
      </g>
      <g stroke={AM} strokeWidth="5" strokeLinecap="round">
        <path d="M292 348h22M300 362h22" />
      </g>
    </>
  );
}

export function HubWallpaper() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      {/* Soft brand blooms. Big, blurred and faint — they give the page warmth
          without ever competing with a card sitting on top. */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: [
            `radial-gradient(60rem 40rem at 12% -8%, ${AD}1f, transparent 60%)`,
            `radial-gradient(50rem 36rem at 92% 6%, ${AM}1a, transparent 62%)`,
            `radial-gradient(46rem 34rem at 78% 92%, ${IRAM}1f, transparent 60%)`,
            `radial-gradient(42rem 30rem at 6% 88%, ${OJ}1a, transparent 62%)`,
            `radial-gradient(38rem 28rem at 48% 46%, ${CAT}14, transparent 65%)`,
          ].join(","),
        }}
      />

      {/* The confetti layer. Two tiles at different scales and offsets so the
          repeat doesn't read as a grid — one obvious seam and the whole thing
          looks like wallpaper in the bad sense. */}
      <svg className="absolute inset-0 h-full w-full" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <pattern
            id="colab-stickers-a"
            width="380"
            height="380"
            patternUnits="userSpaceOnUse"
          >
            <StickerTile />
          </pattern>
          <pattern
            id="colab-stickers-b"
            width="300"
            height="300"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(18) translate(70 40) scale(0.7)"
          >
            <StickerTile />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#colab-stickers-a)" opacity="0.11" />
        <rect width="100%" height="100%" fill="url(#colab-stickers-b)" opacity="0.07" />
      </svg>
    </div>
  );
}
