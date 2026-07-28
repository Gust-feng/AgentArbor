/**
 * Sidebar scene — a full-height monoline ink drawing behind the whole rail.
 *
 * 意境: 山雾远岫 + 水月孤舟. Deliberately minimal — one large moon high in an
 * open sky, a single distant misty ridge, and (kept from before) still water
 * with the moon's broken reflection and a lone boat. Most of the canvas is
 * negative space so the nav reads cleanly on top.
 *
 * Layering, faint to strong:
 *   · a soft ink-wash tone (moon halo + sky/water glow) for depth (SVG gradients)
 *   · a faint distant-mountain wash (ink fading downward)
 *   · the monoline strokes themselves — one accent hue (moon + reflection).
 */

const INK = 'rgba(45,40,34,'

export function SidebarAnimation({ collapsed }: { collapsed: boolean }) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        pointerEvents: 'none',
        // Hidden while collapsed; on expand it fades + rises in, delayed so it
        // appears only after the rail has finished widening.
        opacity: collapsed ? 0 : 1,
        transform: collapsed ? 'translateY(-8px)' : 'translateY(0)',
        transition: collapsed
          ? 'opacity 140ms ease, transform 140ms ease'
          : 'opacity 420ms ease 200ms, transform 520ms cubic-bezier(0.22,1,0.36,1) 200ms',
      }}
    >
      {/* ── upper scene: moonlit sky · one distant ridge ── */}
      <svg
        width="236"
        height="210"
        viewBox="0 0 236 210"
        fill="none"
        aria-hidden
        style={{ position: 'absolute', left: 0, top: 0, display: 'block' }}
      >
        <defs>
          {/* ink-wash tones */}
          <radialGradient id="aa-moonglow" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0%" stopColor="var(--aa-accent)" stopOpacity="0.09" />
            <stop offset="55%" stopColor="var(--aa-accent)" stopOpacity="0.03" />
            <stop offset="100%" stopColor="var(--aa-accent)" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="aa-ridgewash" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(45,40,34,1)" stopOpacity="0.05" />
            <stop offset="100%" stopColor="rgba(45,40,34,1)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* soft moon halo — the ink-wash glow */}
        <circle cx="52" cy="36" r="30" fill="url(#aa-moonglow)" />

        {/* 远岫 wash — faint body of mass beneath the nearest ridge, fully
            contained above the nav band so it never touches a label */}
        <path
          d="M0 107 C 30 103 46 96 66 95 C 88 96 150 101 236 103 L236 120 L0 120 Z"
          fill="url(#aa-ridgewash)"
        />

        {/* the moon — one clear, delicate focal point */}
        <circle cx="52" cy="36" r="14" stroke="var(--aa-accent)" strokeOpacity="0.5" strokeWidth="1" />
        {/* a single thread of cloud drifting across it */}
        <path d="M28 42 Q52 39 82 42" stroke={INK + '0.1)'} strokeWidth="0.9" strokeLinecap="round" />

        {/* two distant birds — a breath of life high in the sky */}
        <path d="M100 37 Q104 32 108 37 Q112 32 116 37" stroke={INK + '0.22)'} strokeWidth="0.9" strokeLinecap="round" fill="none" />
        <path d="M122 44 Q125 40 128 44 Q131 40 134 44" stroke={INK + '0.16)'} strokeWidth="0.9" strokeLinecap="round" fill="none" />

        {/* 远岫叠嶂 — three receding ridges. Depth is pushed harder now: the far
            range is nearly flat and barely-there, the near range undulates and
            reads solid, so the sky feels deep rather than layered-flat. */}
        {/* far + mid ranges are broken behind the tree (x≈50–84) so the distant
            lines read as occluded by the near knoll + pine, not scarred through it */}
        <path
          d="M0 72 C 24 70 40 71 50 71"
          stroke={INK + '0.06)'} strokeWidth="0.9" strokeLinecap="round"
        />
        <path
          d="M84 70 C 140 68 200 69 236 69"
          stroke={INK + '0.06)'} strokeWidth="0.9" strokeLinecap="round"
        />
        <path
          d="M0 86 C 26 82 42 84 52 85"
          stroke={INK + '0.13)'} strokeWidth="1" strokeLinecap="round"
        />
        <path
          d="M84 83 C 132 79 192 79 236 77"
          stroke={INK + '0.13)'} strokeWidth="1" strokeLinecap="round"
        />
        {/* near range — a small knoll rises at x≈65 for the pine to stand on */}
        <path
          d="M0 107 C 30 103 46 96 66 95 C 88 96 150 101 236 103"
          stroke={INK + '0.28)'} strokeWidth="1.1" strokeLinecap="round"
        />

        {/* a lone pine on the near crest — literati / umbrella-pine reading:
            a bare, gently curved trunk (exposed, not hidden by foliage), a wide
            FLAT canopy floating at the top, and one lower side tuft. Foliage is
            filled soft mass (reads far better than strokes at this size); the
            trunk stays a line. Sky shows between canopy and tuft — negative space
            is deliberate. */}
        {/* trunk foot meets the mound crest at (66,95) — planted, not floating */}
        <path d="M66 95 C 67.2 88 65.6 81 67.4 70" stroke={INK + '0.4)'} strokeWidth="1.1" strokeLinecap="round" fill="none" />
        <path d="M66.3 85 C 63 84.6 60.5 84.8 58 84" stroke={INK + '0.32)'} strokeWidth="0.9" strokeLinecap="round" fill="none" />
        {/* lower side tuft */}
        <path d="M50 85 C 50.6 81.5 53.6 80 57 80.4 C 61 80.9 63 82.6 63 84.6 C 58 85.7 53 85.7 50 85 Z" fill={INK + '0.24)'} />
        {/* wide flat canopy, gently lobed top */}
        <path d="M52 71 C 54 66 58 64 62 65 C 64 62.4 70 62.4 72 65 C 76 64 80 66 83 71 C 74 72.6 61 72.6 52 71 Z" fill={INK + '0.3)'} />

        {/* faint 皴 texture on the near ridge slopes */}
        <path d="M40 106 L42 112" stroke={INK + '0.08)'} strokeWidth="0.8" strokeLinecap="round" />
        <path d="M100 104 L102 110" stroke={INK + '0.08)'} strokeWidth="0.8" strokeLinecap="round" />
      </svg>

      {/* ── lower scene: still water · reflection · lone boat (unchanged) ── */}
      <svg
        width="236"
        height="150"
        viewBox="0 0 236 150"
        fill="none"
        aria-hidden
        style={{ position: 'absolute', left: 0, bottom: 48, display: 'block' }}
      >
        <defs>
          <linearGradient id="aa-waterwash" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(45,40,34,1)" stopOpacity="0" />
            <stop offset="100%" stopColor="rgba(45,40,34,1)" stopOpacity="0.05" />
          </linearGradient>
        </defs>
        {/* faint water wash for depth */}
        <rect x="0" y="30" width="236" height="120" fill="url(#aa-waterwash)" />

        {/* ripples */}
        <path d="M8 40 Q60 36 118 40 Q176 44 228 40" stroke={INK + '0.15)'} strokeWidth="1" strokeLinecap="round" />
        <path d="M12 60 Q64 57 120 60 Q176 63 224 60" stroke={INK + '0.12)'} strokeWidth="1" strokeLinecap="round" />
        <path d="M8 82 Q64 78 120 82 Q178 86 228 82" stroke={INK + '0.1)'} strokeWidth="1" strokeLinecap="round" />
        <path d="M16 104 Q68 101 120 104 Q172 107 220 104" stroke={INK + '0.08)'} strokeWidth="1" strokeLinecap="round" />

        {/* moon's broken reflection, under its sky position (x≈60) */}
        <path d="M52 40 L68 40" stroke="var(--aa-accent)" strokeOpacity="0.32" strokeWidth="1.1" strokeLinecap="round" />
        <path d="M50 60 L70 60" stroke="var(--aa-accent)" strokeOpacity="0.24" strokeWidth="1.1" strokeLinecap="round" />
        <path d="M55 82 L65 82" stroke="var(--aa-accent)" strokeOpacity="0.18" strokeWidth="1.1" strokeLinecap="round" />

        {/* a single small boat, off to the right for tension */}
        <path d="M140 41 Q152 48 164 41" stroke={INK + '0.4)'} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M152 41 L152 31" stroke={INK + '0.4)'} strokeWidth="1.2" strokeLinecap="round" />
        <path d="M146 35 Q152 32 158 35" stroke={INK + '0.34)'} strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    </div>
  )
}
