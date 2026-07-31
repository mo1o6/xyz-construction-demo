"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import NavOrb from "@/components/nav-orb";

/** useLayoutEffect warns during SSR; this keeps the layout timing on the client. */
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

const VIDEO_SRC = "/timelapse.mp4";
const NOMINAL_DURATION = 10;

/**
 * Prologue: timeline units spent revealing the veil before the video starts.
 *
 * The runway is 660svh, of which 560svh is pinned. 60svh of that (~420px at a
 * 700px viewport) is the prologue and 500svh drives the video, so the prologue
 * is added on top of chapter 01's window rather than taken out of it.
 * 10 video-seconds / 500svh × 60svh = 1.2 timeline units.
 */
const PROLOGUE = 1.2;

/**
 * Chapter windows in *video seconds*.
 *
 * Re-measured from a 40-frame contact sheet at 0.25s intervals rather than the
 * original coarse read, because the cards were labelling the wrong footage:
 *   pour first visible 1.35s (window said 2.2) · first wall panel 4.10s
 *   (said 4.4) · roof structure 6.7s (said 6.8) · scaffolding struck and
 *   landscaping in by 9.20s (said 8.6, so "Handover" showed over a scaffolded
 *   house). Worst case the old windows were 0.85s out. Boundaries confirmed by
 *   extracting the frame at each card's fade-in point.
 *
 * These boundaries do double duty: they are also the easing segments, so the
 * per-chapter deceleration now settles on real stage changes.
 */
const CHAPTERS = [
  {
    index: "01",
    title: "Ground & Steel",
    body: "Footings squared, rebar tied to the drawing.",
    from: 0,
    to: 1.35,
  },
  {
    index: "02",
    title: "The Pour",
    body: "One slab, placed and floated in a single morning.",
    from: 1.35,
    to: 4.05,
  },
  {
    index: "03",
    title: "Frame",
    body: "Every stud, header and beam set by hand.",
    from: 4.05,
    to: 6.7,
  },
  {
    index: "04",
    title: "Enclosure",
    body: "Roof down, glass in, weather out.",
    from: 6.7,
    to: 9.18,
  },
  {
    index: "05",
    title: "Handover",
    body: "First night in the house.",
    from: 9.18,
    to: 10,
  },
];

/**
 * Card position per chapter, as a fraction of the stage box (card top-left).
 *
 * Mean gradient magnitude across four sampled frames per chapter for each
 * candidate slot, luminance as a tiebreak, a penalty against reusing the
 * previous chapter's slot, and a hard penalty for covering a protected region.
 * Candidates exclude top-left (wordmark chip) and bottom-right (nav orb).
 *
 * Re-derived after the chapter windows were corrected, since the windows decide
 * which frames each chapter is sampled against. Busyness for the chosen slot,
 * lower is emptier:
 *   01 left-bottom 22.1 · 02 center-top 15.1 · 03 right-top 16.9
 *   04 center-bottom 17.5 · 05 left-bottom 17.7
 *
 * Chapter 03 takes right-top over its nominal best (left-bottom, 16.2) — a 4%
 * busyness gap, inside sampling noise — because otherwise three of the five
 * chapters land in the same corner.
 *
 * Chapter 05 is the reveal shot, so the finished house — measured at
 * (290,170)-(1120,490) in source px — is a protected region. Every chosen slot
 * covers 0% of it.
 *
 * Chapter 01's anchor is duplicated in CSS (.chapter-card) so first paint is
 * correct before any JS runs.
 */
const CARD_ANCHORS = [
  { x: 0.07, y: 0.64 }, // 01 — left-bottom
  { x: 0.353, y: 0.045 }, // 02 — center-top
  { x: 0.636, y: 0.045 }, // 03 — right-top
  { x: 0.353, y: 0.64 }, // 04 — center-bottom
  { x: 0.07, y: 0.64 }, // 05 — left-bottom (clear of the house)
];

const CARD_MARGIN = 24;

/**
 * Per-chapter settle ease.
 *
 * A pure quadratic in-out has zero slope at both endpoints, which makes the
 * footage dead-stop at every chapter boundary — measured at 0.07 video-sec per
 * 1000px against 5.4 mid-segment, a ~50x swing that reads as a stall rather
 * than a settle. Blending it 45/55 with linear keeps a floor under the boundary
 * speed: slope runs 0.45x average at the edges to 1.55x at mid-segment, a 3.4x
 * range. Monotonic increasing, so video time never steps backwards.
 */
const settleEase = (p: number) => {
  const quad = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
  return 0.45 * p + 0.55 * quad;
};

/** settleEase is monotonic, so bisection inverts it safely. */
const settleEaseInverse = (target: number) => {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i += 1) {
    const mid = (lo + hi) / 2;
    if (settleEase(mid) < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
};

/**
 * Convert a *video* timestamp to its timeline position.
 *
 * Card cue points have to be authored in video seconds and converted through
 * this, not written as timeline positions directly: the easing means timeline
 * position and video time only coincide at segment boundaries, so a cue placed
 * by timeline maths drifts against the footage everywhere in between.
 */
const timelineAtVideoTime = (videoTime: number) => {
  let index = CHAPTERS.findIndex(
    (c) => videoTime >= c.from && videoTime <= c.to,
  );
  if (index === -1) index = videoTime < CHAPTERS[0].from ? 0 : CHAPTERS.length - 1;
  const chapter = CHAPTERS[index];
  const { start, end } = chapterTimelineRange(index);
  const span = chapter.to - chapter.from;
  if (span <= 0) return start;
  const clamped = Math.min(Math.max(videoTime, chapter.from), chapter.to);
  const p = settleEaseInverse((clamped - chapter.from) / span);
  return start + p * (end - start);
};

/**
 * Overlap between the veil fade and the start of playback, in timeline units.
 *
 * Without it the two phases butt up against each other: the video sits frozen
 * for the whole prologue and only starts moving at the exact instant the veil
 * hits zero, which reads as two mechanical stages rather than one handoff. At
 * 0.3 (25% of PROLOGUE) playback starts while the veil is still ~25% opaque and
 * has advanced ~0.16s of footage by the time the veil clears — moving, but not
 * visibly racing.
 */
const HANDOFF = 0.3;

/**
 * Timeline span a chapter's video tween occupies. Chapter 01 starts early by
 * HANDOFF; every other chapter starts where the previous one ended, so the
 * segments stay contiguous and video time never jumps.
 */
const chapterTimelineRange = (i: number) => ({
  start: i === 0 ? PROLOGUE - HANDOFF : PROLOGUE + CHAPTERS[i].from,
  end: PROLOGUE + CHAPTERS[i].to,
});

/** Card fade lengths, expressed in video seconds so they read against footage. */
const CARD_FADE_IN = 0.35;
const CARD_FADE_OUT = 0.45;
/** Half-width of the card's positional move, centred on a chapter boundary. */
const CARD_MOVE_HALF = 0.15;

export default function ScrollExperience() {
  const rootRef = useRef<HTMLDivElement>(null);
  const runwayRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const closingRef = useRef<HTMLElement>(null);
  const builtRef = useRef(false);

  useIsomorphicLayoutEffect(() => {
    const video = videoRef.current;
    const runway = runwayRef.current;
    const stage = stageRef.current;
    if (!video || !runway || !stage) return;

    gsap.registerPlugin(ScrollTrigger);
    // Mobile browsers fire resize when the URL bar collapses; refreshing pins
    // mid-scrub on that would visibly jump the video.
    ScrollTrigger.config({ ignoreMobileResize: true });

    // --- Scroll restoration -------------------------------------------------
    // Next.js restores scroll on reload, which would drop the user mid-scrub
    // with the pin not yet initialised. Force every entry to start at the top.
    const previousRestoration = history.scrollRestoration;
    const assertManual = () => {
      if ("scrollRestoration" in history) history.scrollRestoration = "manual";
    };
    const pinToTop = () => window.scrollTo(0, 0);

    assertManual();
    pinToTop();

    // scrollRestoration is a property of the *history entry*, and the App Router
    // calls history.replaceState during hydration — which silently reverts it to
    // "auto". Asserting once is not enough, so re-assert across the hydration
    // window. Verified: without this, a reload at scrollY 1400 restores to 1400.
    const settleTimers = [0, 120, 400, 1000].map((delay) =>
      window.setTimeout(assertManual, delay),
    );

    const onLoad = () => {
      assertManual();
      pinToTop();
      ScrollTrigger.refresh();
    };
    window.addEventListener("load", onLoad);

    // Belt and braces: zero the offset Chrome would persist, so even if
    // scrollRestoration gets flipped back to "auto" there is nothing to restore.
    // pagehide is used rather than beforeunload because it does not disqualify
    // the page from bfcache.
    const onPageHide = () => window.scrollTo(0, 0);
    window.addEventListener("pagehide", onPageHide);

    const onPageShow = (event: PageTransitionEvent) => {
      // bfcache restore hands back the old scroll position and a live DOM.
      if (event.persisted) {
        assertManual();
        pinToTop();
        ScrollTrigger.refresh();
      }
    };
    window.addEventListener("pageshow", onPageShow);

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let ctx: gsap.Context | null = null;
    let fallbackTimer: number | undefined;

    /**
     * iOS Safari ignores preload="auto" and will not buffer until playback is
     * attempted. A muted, inline play() immediately followed by pause() forces
     * a real load without the user seeing a frame of playback.
     */
    const forceLoad = () => {
      try {
        video.muted = true;
        video.playsInline = true;
        const played = video.play();
        if (played && typeof played.then === "function") {
          played
            .then(() => {
              video.pause();
              video.currentTime = 0;
            })
            .catch(() => {
              /* autoplay refused — the readiness gate still resolves below */
            });
        }
      } catch {
        /* no-op */
      }
    };

    const build = () => {
      if (builtRef.current) return;
      builtRef.current = true;
      window.clearTimeout(fallbackTimer);

      // The scrub now owns the veil, so retire the no-JS failsafe.
      const veil = rootRef.current?.querySelector<HTMLElement>(".intro-veil");
      if (veil) veil.style.animation = "none";

      video.pause();

      const duration =
        Number.isFinite(video.duration) && video.duration > 0
          ? video.duration
          : NOMINAL_DURATION;

      if (reduced) {
        // No pin, no scrub — park on the finished house and let the CSS
        // reduced-motion rules lay the chapters out as a static list.
        video.currentTime = Math.max(0, duration - 0.1);
        return;
      }

      ctx = gsap.context(() => {
        const timeline = gsap.timeline({
          defaults: { ease: "none" },
          scrollTrigger: {
            trigger: runway,
            start: "top top",
            // The runway already supplies the scroll distance, so the pin must
            // not add its own spacer on top of it.
            end: "bottom bottom",
            pin: stage,
            pinSpacing: false,
            scrub: 0.5,
            anticipatePin: 1,
            invalidateOnRefresh: true,
          },
        });

        // --- Prologue -------------------------------------------------------
        // scrollY 0 → veil fully opaque; end of the prologue → fully clear.
        // Being a scrubbed tween rather than a one-shot animation, scrolling
        // back to the top restores the black.
        timeline.fromTo(
          ".intro-veil",
          { opacity: 1 },
          { opacity: 0, duration: PROLOGUE },
          0,
        );

        // The video tween starts at PROLOGUE, so currentTime is pinned at 0 for
        // the whole reveal and the footage only begins once the veil is clear.
        //
        // --- Per-chapter easing ---------------------------------------------
        // One tween per chapter segment instead of a single linear sweep. Each
        // segment still occupies its own share of the scroll distance, but time
        // eases in and out within it, so playback settles either side of a
        // boundary and each chapter gets a moment to land. See settleEase for
        // why this is a blended ease rather than a stock power1.inOut.
        CHAPTERS.forEach((chapter, i) => {
          const target = Math.min(chapter.to, duration);
          if (target - chapter.from <= 0) return;
          const { start, end } = chapterTimelineRange(i);
          timeline.fromTo(
            video,
            { currentTime: chapter.from },
            {
              currentTime: target,
              duration: end - start,
              ease: settleEase,
            },
            start,
          );
        });

        timeline.fromTo(
          ".scrub-progress",
          { scaleX: 0 },
          { scaleX: 1, duration: duration + PROLOGUE },
          0,
        );
        timeline.to(
          ".scroll-cue",
          { autoAlpha: 0, duration: 0.5 },
          PROLOGUE + 0.15,
        );

        // Card travel. Deltas are measured from the CSS base position (chapter
        // 01's anchor) using offsetLeft/offsetTop, which are transform-free, so
        // repeated refreshes never compound. Function-based values re-evaluate
        // on ScrollTrigger refresh via invalidateOnRefresh.
        const card = cardRef.current;
        const cardDelta = (i: number, axis: "x" | "y") => {
          if (!card) return 0;
          const stageBox = stage.getBoundingClientRect();
          // Below the md breakpoint the card is near full width, so horizontal
          // travel has nowhere to go — only the vertical anchor varies.
          if (axis === "x" && stageBox.width < 768) return 0;
          const anchor = CARD_ANCHORS[i];
          if (axis === "x") {
            const limit = Math.max(
              CARD_MARGIN,
              stageBox.width - card.offsetWidth - CARD_MARGIN,
            );
            const target = Math.min(
              Math.max(anchor.x * stageBox.width, CARD_MARGIN),
              limit,
            );
            return target - card.offsetLeft;
          }
          const limit = Math.max(
            CARD_MARGIN,
            stageBox.height - card.offsetHeight - CARD_MARGIN,
          );
          const target = Math.min(
            Math.max(anchor.y * stageBox.height, CARD_MARGIN),
            limit,
          );
          return target - card.offsetTop;
        };

        // Seat chapter 01's clamped position at timeline 0 so it participates
        // in refresh recalculation instead of relying on the CSS base alone.
        timeline.to(
          card,
          { x: () => cardDelta(0, "x"), y: () => cardDelta(0, "y"), duration: 0 },
          0,
        );

        // Every cue below is authored in video seconds and converted through
        // timelineAtVideoTime, so a card is on screen exactly while its stage
        // is on screen regardless of what the easing does to scroll pacing.
        gsap.utils.toArray<HTMLElement>(".chapter").forEach((el, i) => {
          const { from, to } = CHAPTERS[i];

          // Move the card across the boundary between stages, centred on it.
          if (i > 0) {
            const moveFrom = timelineAtVideoTime(
              Math.max(0, from - CARD_MOVE_HALF),
            );
            const moveTo = timelineAtVideoTime(
              Math.min(duration, from + CARD_MOVE_HALF),
            );
            timeline.to(
              card,
              {
                x: () => cardDelta(i, "x"),
                y: () => cardDelta(i, "y"),
                duration: Math.max(moveTo - moveFrom, 0.01),
                ease: "power2.inOut",
              },
              moveFrom,
            );
          }

          if (i === 0) {
            // Chapter 01 is part of the first paint, not something that fades
            // in — otherwise the glass card renders empty until the user
            // scrolls. It only ever fades out.
            gsap.set(el, { autoAlpha: 1, yPercent: 0 });
          } else {
            const inStart = timelineAtVideoTime(from);
            const inEnd = timelineAtVideoTime(
              Math.min(to, from + CARD_FADE_IN),
            );
            timeline.fromTo(
              el,
              { autoAlpha: 0, yPercent: 6 },
              {
                autoAlpha: 1,
                yPercent: 0,
                duration: Math.max(inEnd - inStart, 0.01),
              },
              inStart,
            );
          }

          // The last chapter never fades out. Every earlier fade-out is covered
          // by the next card fading in behind it, but there is no chapter 06 —
          // fading 05 would leave the glass panel on screen with nothing in it
          // until the pin releases. Holding it at full opacity means the card
          // is either populated or gone with the stage, never hollow.
          if (i < CHAPTERS.length - 1) {
            const outStart = timelineAtVideoTime(
              Math.max(from, to - CARD_FADE_OUT),
            );
            const outEnd = timelineAtVideoTime(to);
            timeline.to(
              el,
              {
                autoAlpha: 0,
                yPercent: -4,
                duration: Math.max(outEnd - outStart, 0.01),
              },
              outStart,
            );
          }
        });

        // Closing section reveal — triggered, not scrubbed.
        gsap.from(".closing-item", {
          autoAlpha: 0,
          y: 30,
          duration: 0.9,
          stagger: 0.11,
          ease: "power2.out",
          scrollTrigger: {
            trigger: closingRef.current,
            start: "top 72%",
            once: true,
          },
        });
      }, rootRef);

      ScrollTrigger.refresh();
    };

    // --- Readiness gate -----------------------------------------------------
    // Never assume the video is loaded: check current state, listen on two
    // different events, and keep a timer so a stalled network still builds.
    const onLoadedData = () => {
      if (video.readyState >= 2) build();
    };

    video.addEventListener("loadeddata", onLoadedData);
    video.addEventListener("canplaythrough", build);

    fallbackTimer = window.setTimeout(() => {
      if (video.readyState < 2) forceLoad();
      build();
    }, 2500);

    forceLoad();
    if (video.readyState >= 2) build();

    return () => {
      window.clearTimeout(fallbackTimer);
      settleTimers.forEach(window.clearTimeout);
      window.removeEventListener("load", onLoad);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
      video.removeEventListener("loadeddata", onLoadedData);
      video.removeEventListener("canplaythrough", build);
      ctx?.revert();
      if ("scrollRestoration" in history) {
        history.scrollRestoration = previousRestoration ?? "auto";
      }
      builtRef.current = false;
    };
  }, []);

  return (
    <div ref={rootRef}>
      {/* Scroll runway: 660svh of travel, 560svh pinned — 60svh of prologue
          (veil reveal, video held at 0) plus 500svh of video scrub. */}
      <section ref={runwayRef} className="runway relative h-[660svh]">
        <div
          ref={stageRef}
          className="stage relative h-[100svh] w-full overflow-hidden bg-ink"
        >
          {/* Mild unsharp mask. This cannot restore resolution the 720p source
              never had — it only sharpens edge transitions that survived the
              encode, so the kernel is kept low enough to avoid halos. */}
          <svg
            aria-hidden="true"
            focusable="false"
            className="pointer-events-none absolute h-0 w-0"
          >
            <filter
              id="hero-clarity"
              x="0"
              y="0"
              width="100%"
              height="100%"
              colorInterpolationFilters="sRGB"
            >
              <feConvolveMatrix
                order="3"
                kernelMatrix="0 -0.16 0 -0.16 1.64 -0.16 0 -0.16 0"
                divisor="1"
                preserveAlpha="true"
              />
            </filter>
          </svg>

          <video
            ref={videoRef}
            className="absolute inset-0 h-full w-full object-cover object-[100%_100%]"
            style={{
              filter: 'url("#hero-clarity") contrast(1.1) saturate(1.12)',
            }}
            src={VIDEO_SRC}
            poster="/hero-poster.jpg"
            muted
            playsInline
            preload="auto"
            disablePictureInPicture
            aria-hidden="true"
            tabIndex={-1}
          />

          <div aria-hidden="true" className="absolute inset-0 grain" />

          {/* Wordmark — glass chip, same material as the chapter card */}
          <header className="absolute top-0 left-0 z-20 p-[clamp(1.5rem,3.5vw,3rem)]">
            <span className="glass glass-chip copy-on-glass flex items-baseline gap-[0.45em]">
              <span className="font-display text-[1.05rem] leading-none font-semibold tracking-[0.06em] text-bone">
                XYZ
              </span>
              <span className="eyebrow leading-none text-bone/70">
                Construction
              </span>
            </span>
          </header>

          {/* Chapter captions — stacked in one grid cell, cross-faded by scrub.
              The glass card is a sibling of the stack rather than part of each
              chapter, so its size stays constant while the copy swaps and only
              its position travels between chapters. */}
          <div className="absolute inset-0 z-20">
            <div
              ref={cardRef}
              className="chapter-card absolute p-[clamp(1.5rem,2.6vw,2.5rem)]"
            >
              <div aria-hidden="true" className="glass glass-card absolute inset-0" />
              <div className="chapter-stack relative grid">
                {CHAPTERS.map((chapter) => (
                  <div key={chapter.index} className="chapter copy-on-glass">
                    <div className="flex items-center gap-4">
                      <span
                        aria-hidden="true"
                        className="h-px w-[clamp(1.5rem,4vw,3.25rem)] bg-brass/80"
                      />
                      {/* Bone rather than brass: at 10px, brass cannot reach
                          4.5:1 over a backdrop light enough to read as glass.
                          The brass accent survives in the hairline above. */}
                      <span className="eyebrow text-bone/85">
                        Chapter {chapter.index}
                      </span>
                    </div>
                    <h2 className="chapter-title mt-[clamp(0.85rem,1.8vw,1.4rem)] text-bone">
                      {chapter.title}
                    </h2>
                    <p className="mt-[clamp(0.75rem,1.4vw,1.15rem)] max-w-[32ch] text-[clamp(0.875rem,1.05vw,1.0625rem)] leading-relaxed font-light text-bone/85">
                      {chapter.body}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Scroll cue */}
          <div className="scroll-cue absolute bottom-[clamp(1.75rem,4vh,3rem)] left-[clamp(1.5rem,6vw,7rem)] z-20">
            <span className="glass glass-chip copy-on-glass flex items-center gap-3">
              <span className="eyebrow text-bone/70">Scroll</span>
              <span
                aria-hidden="true"
                className="h-px w-10 origin-left bg-bone/45"
              />
            </span>
          </div>

          {/* Scrub progress */}
          <div
            aria-hidden="true"
            className="absolute inset-x-0 bottom-0 z-20 h-px bg-bone/10"
          >
            <div className="scrub-progress h-full origin-left bg-brass/80" />
          </div>

          {/* Nav orb lives inside the stage so it tracks the video box exactly */}
          <NavOrb />

          {/* Opening veil — opacity is scrubbed by the prologue segment, so it
              re-darkens if the user scrolls back to the very top.

              The credit is a *child* of the veil rather than a separately
              animated element: it therefore inherits the veil's opacity from
              the one prologue tween, so the two can never drift apart and the
              credit reappears on scroll-back-up exactly as the veil does.
              aria-hidden covers it here; the footer carries the linked,
              screen-reader-visible version of the same credit. */}
          <div aria-hidden="true" className="intro-veil absolute inset-0 z-50">
            <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
              <span className="eyebrow text-bone/60">Site &amp; Development</span>
              <span className="veil-credit mt-[clamp(0.7rem,1.5vw,1.15rem)] text-bone/95">
                Clyntel Web Services
              </span>
            </div>

            {/* Non-verbal scroll hint. It lives inside the veil, so it inherits
                the same scroll-tied opacity and clears exactly as the veil does
                — no second trigger, no text label. */}
            <div className="scroll-hint absolute inset-x-0 bottom-[clamp(2rem,6vh,3.25rem)] flex justify-center">
              <svg
                width="26"
                height="34"
                viewBox="0 0 26 34"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-bone/90"
              >
                <path d="M13 2 v18" />
                <path d="M5 21 l8 8 8-8" />
              </svg>
            </div>
          </div>
        </div>
      </section>

      {/* Closing moment */}
      <section
        ref={closingRef}
        id="contact"
        className="relative flex min-h-[100svh] flex-col justify-center overflow-hidden bg-ink px-[clamp(1.5rem,6vw,7rem)] py-[clamp(4rem,12vh,9rem)]"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(120% 80% at 78% 42%, rgb(211 169 107 / 0.13) 0%, rgb(211 169 107 / 0.04) 38%, transparent 68%)",
          }}
        />
        <div aria-hidden="true" className="absolute inset-0 grain" />

        <div className="relative">
          <div className="closing-item flex items-center gap-4">
            <span
              aria-hidden="true"
              className="h-px w-[clamp(1.5rem,4vw,3.25rem)] bg-brass/70"
            />
            <p className="eyebrow text-brass">Ten months · One address</p>
          </div>

          <h1 className="display mt-[clamp(1rem,2.2vw,1.75rem)] text-bone">
            <span className="closing-item block">Where Vision</span>
            <span className="closing-item block">Becomes</span>
            <span className="closing-item block italic text-sand">
              Structure
            </span>
          </h1>

          <p className="closing-item mt-[clamp(1.25rem,2.4vw,2rem)] max-w-[34ch] text-[clamp(0.875rem,1.05vw,1.0625rem)] leading-relaxed font-light text-bone/78">
            Ground-up luxury residences, engineered from first pour to final
            light.
          </p>

          <div className="closing-item mt-[clamp(1.75rem,3vw,2.5rem)]">
            <a
              href="#contact"
              className="group inline-flex items-center gap-2.5 rounded-full bg-bone py-[0.7rem] pr-[0.95rem] pl-[1.35rem] text-[0.7rem] font-semibold tracking-[0.16em] text-ink uppercase transition-[background-color,transform] duration-300 ease-[cubic-bezier(0.22,0.68,0.24,1)] hover:-translate-y-px hover:bg-white"
            >
              Start Your Build
              <span
                aria-hidden="true"
                className="grid h-5 w-5 place-items-center rounded-full bg-ink/8 text-[0.7rem] transition-transform duration-300 group-hover:translate-x-0.5"
              >
                →
              </span>
            </a>
          </div>

          {/* Primary studio credit — sized as a real secondary line rather than
              a caption, sitting in the open space under the CTA. The smaller
              footer credit below stays for anyone who reads that far. */}
          <p className="closing-item mt-[clamp(2.5rem,6vh,4rem)] text-[clamp(0.8125rem,1.05vw,0.9375rem)] leading-relaxed font-light text-bone/70">
            Designed &amp; built by{" "}
            <a
              href="https://clyntel.ca"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-bone underline decoration-bone/35 underline-offset-4 transition-colors duration-200 hover:decoration-bone"
            >
              Clyntel Web Services
            </a>
          </p>

          {/* Nav continuity: the orb travels with the hero, so the closing
              moment carries its own quiet set of links. */}
          <nav
            aria-label="Footer"
            className="closing-item mt-[clamp(3rem,8vh,5.5rem)] flex flex-wrap items-center gap-x-8 gap-y-3 border-t border-bone/10 pt-6"
          >
            {["Portfolio", "Process", "Contact"].map((label) => (
              <a
                key={label}
                href={`#${label.toLowerCase()}`}
                className="eyebrow text-bone/55 transition-colors duration-200 hover:text-bone"
              >
                {label}
              </a>
            ))}
            {/* Raised from bone/30: the Clyntel credit below is a real link and
                has to clear 4.5:1, so the client wordmark sits well above that
                to stay the dominant mark. Measured 10.2:1 vs the credit's
                5.4:1, at 10px vs 9px. */}
            <span className="eyebrow ml-auto text-bone/85">XYZ Construction</span>
          </nav>

          {/* bone/62 rather than the nominal ~50 the maths suggested: at 9px
              with heavy tracking, antialiasing thins the strokes enough that
              measured glyph contrast lands well under the flat-fill estimate. */}
          <p className="closing-item mt-4 text-[0.5625rem] font-medium tracking-[0.22em] text-bone/62 uppercase">
            Site by{" "}
            <a
              href="https://clyntel.ca"
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-bone/30 underline-offset-4 transition-colors duration-200 hover:text-bone hover:decoration-bone/60"
            >
              Clyntel Web Services
            </a>
          </p>
        </div>
      </section>
    </div>
  );
}
