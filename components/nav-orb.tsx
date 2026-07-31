"use client";

import { useEffect, useRef, useState } from "react";

const LINKS = [
  { label: "Portfolio", href: "#portfolio" },
  { label: "Process", href: "#process" },
  { label: "Contact", href: "#contact" },
];

/**
 * Floating waffle nav trigger.
 *
 * Doubles as the cover plate for the sparkle watermark baked into the footage
 * at (1159, 598) of the 1280x720 source. Position and diameter come from the
 * `--wm-*` custom properties in globals.css, which track the video's object-fit
 * cover scale, so the orb stays locked to the watermark at any viewport size.
 */
export default function NavOrb() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };

    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  return (
    // No entrance animation here on purpose: the orb is the watermark's cover
    // plate, so it must be opaque and in position from the very first paint.
    <div ref={rootRef} className="nav-orb absolute z-30">
      {/* Menu panel — expands from the orb's corner. */}
      <div
        id="site-menu"
        inert={!open}
        className={`absolute right-0 bottom-[calc(100%+0.75rem)] w-56 origin-bottom-right rounded-[1.25rem] border border-bone/12 bg-ink/85 p-2 backdrop-blur-2xl transition-[opacity,transform] duration-300 ease-[cubic-bezier(0.22,0.68,0.24,1)] ${
          open
            ? "translate-y-0 scale-100 opacity-100"
            : "pointer-events-none translate-y-2 scale-95 opacity-0"
        }`}
        style={{ boxShadow: "0 24px 60px -12px rgb(0 0 0 / 0.7)" }}
      >
        <nav aria-label="Primary">
          <ul>
            {LINKS.map((link, i) => (
              <li key={link.label}>
                <a
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className="group flex items-baseline gap-3 rounded-[0.85rem] px-3 py-2.5 transition-colors duration-200 hover:bg-bone/6"
                >
                  <span className="font-display text-[0.6rem] text-brass/70 italic tabular-nums">
                    0{i + 1}
                  </span>
                  <span className="text-[0.7rem] font-medium tracking-[0.2em] text-bone/80 uppercase transition-colors duration-200 group-hover:text-bone">
                    {link.label}
                  </span>
                  <span
                    aria-hidden="true"
                    className="ml-auto translate-x-0 text-brass opacity-0 transition-all duration-300 group-hover:translate-x-1 group-hover:opacity-100"
                  >
                    →
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </div>

      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls="site-menu"
        aria-label={open ? "Close menu" : "Open menu"}
        onClick={() => setOpen((v) => !v)}
        className="group relative grid h-full w-full place-items-center rounded-full border border-bone/18 transition-[transform,border-color] duration-500 ease-[cubic-bezier(0.22,0.68,0.24,1)] hover:scale-[1.04] hover:border-bone/35 active:scale-100"
        style={{
          // Opaque enough to fully mask the ~Y230 sparkle underneath while still
          // reading as glass; the blur only softens the seam against the video.
          background:
            "radial-gradient(120% 120% at 30% 25%, rgb(30 37 47 / 0.94) 0%, rgb(11 14 19 / 0.93) 60%, rgb(11 14 19 / 0.95) 100%)",
          backdropFilter: "blur(14px) saturate(1.15)",
          WebkitBackdropFilter: "blur(14px) saturate(1.15)",
          boxShadow:
            "0 18px 40px -10px rgb(0 0 0 / 0.65), inset 0 1px 0 0 rgb(242 236 226 / 0.09)",
        }}
      >
        <span
          aria-hidden="true"
          className={`grid grid-cols-3 gap-[0.3em] text-[1rem] transition-transform duration-500 ease-[cubic-bezier(0.22,0.68,0.24,1)] ${
            open ? "rotate-45 scale-[0.58]" : "rotate-0 scale-100"
          }`}
        >
          {Array.from({ length: 9 }).map((_, i) => (
            <span
              key={i}
              className={`h-[0.19em] w-[0.19em] rounded-full transition-colors duration-500 ${
                open ? "bg-brass" : "bg-bone/72 group-hover:bg-bone"
              }`}
            />
          ))}
        </span>
      </button>
    </div>
  );
}
