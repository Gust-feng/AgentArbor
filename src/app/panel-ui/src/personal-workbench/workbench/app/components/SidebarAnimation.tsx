/**
 * Theme-specific line art behind the rail. Light keeps the original landscape;
 * dark uses a separate paper-distillation study so theme changes do not become palette
 * swaps of the same illustration. Both scenes reserve the navigation band.
 */

const INK = 'rgba(45,40,34,'
const NIGHT_INK = 'rgba(236,235,243,'

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
      <div
        className="aa-sidebar-animation__scene aa-sidebar-animation__scene--light"
        style={{ position: 'absolute', inset: 0 }}
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

      <div
        className="aa-sidebar-animation__scene aa-sidebar-animation__scene--dark"
        style={{ position: 'absolute', inset: 0 }}
      >
        <svg
          width="236"
          height="226"
          viewBox="0 0 236 226"
          fill="none"
          aria-hidden
          style={{ position: 'absolute', left: 0, top: 0, display: 'block' }}
        >
          <defs>
            <linearGradient id="aa-sidebar-night-paper" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#36333b" stopOpacity="0.34" />
              <stop offset="1" stopColor="#242329" stopOpacity="0.025" />
            </linearGradient>
          </defs>

          {/* Only a soft atmospheric wash remains behind the navigation. */}
          <path
            d="M236 0 L132 0 C152 36 141 64 112 88 C144 112 138 148 104 176 C130 194 152 210 164 226 L236 226 Z"
            fill="url(#aa-sidebar-night-paper)"
          />
          <path
            d="M0 104 C48 92 92 100 136 96 C176 92 208 98 236 92"
            stroke={NIGHT_INK + '0.18)'}
            strokeLinecap="round"
            strokeWidth="0.9"
          />
          <path
            d="M0 122 C52 112 96 120 142 114 C182 110 210 116 236 110"
            stroke={NIGHT_INK + '0.12)'}
            strokeLinecap="round"
            strokeWidth="0.9"
          />
          <path
            d="M34 46 L77 42 M42 54 L98 50"
            stroke={NIGHT_INK + '0.1)'}
            strokeLinecap="round"
            strokeWidth="0.8"
          />
        </svg>

        <svg
          width="236"
          height="190"
          viewBox="0 0 236 190"
          fill="none"
          aria-hidden
          style={{ position: 'absolute', left: 0, bottom: 42, display: 'block' }}
        >
          <path
            d="M0 76 C52 66 100 74 145 68 C180 64 208 70 236 63 L236 112 C190 119 154 112 112 118 C68 124 31 114 0 125 Z"
            fill="#34323a"
            fillOpacity="0.2"
          />
          <path
            d="M0 144 C48 134 90 144 132 138 C172 132 205 141 236 132"
            stroke={NIGHT_INK + '0.16)'}
            strokeLinecap="round"
            strokeWidth="0.9"
          />
          <path
            d="M8 164 C54 155 96 164 138 158 C175 153 207 161 228 155"
            stroke={NIGHT_INK + '0.1)'}
            strokeLinecap="round"
            strokeWidth="0.9"
          />
          <path
            d="M12 183 C52 176 96 185 134 178 C169 172 202 181 224 174"
            stroke={NIGHT_INK + '0.08)'}
            strokeLinecap="round"
            strokeWidth="0.9"
          />
        </svg>
      </div>
    </div>
  )
}
