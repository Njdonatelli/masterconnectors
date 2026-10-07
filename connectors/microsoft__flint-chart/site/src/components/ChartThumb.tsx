import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Vega-Lite-gallery-style thumbnail wrapper for the photo-wall.
 *
 * Charts render at their *designed* pixel size (which varies widely — wide
 * legends, tall calendars, square pies…). Following the Vega-Lite gallery, the
 * wrapper uses **height-based gating**: every chart is scaled to fit the tile's
 * fixed height, so its full vertical extent (title, plot, x-axis) is always
 * visible and nothing is cropped from the bottom. The width then falls out
 * naturally — a few discrete categories sit centred with side margin, while a
 * long/high-cardinality chart overflows the tile horizontally and is cropped.
 * At rest the left edge of an overflowing chart is shown; on hover it slowly
 * pans right to reveal the cropped tail (more bars, the legend…).
 *
 * The fit (scale + rest offset) applies instantly so entering the page never
 * animates; only the hover pan is transitioned.
 */
export function ChartThumb({
  height,
  hovered = false,
  contain = false,
  children,
}: {
  /** Fixed height of the bounding box in px. Width fills the container. */
  height: number;
  /** Drives the hover pan-to-reveal (owned by the parent card). */
  hovered?: boolean;
  /**
   * Fit the *whole* chart inside the tile (scale by the smaller of the width and
   * height ratios) and centre it, instead of height-gating + cropping the width.
   * Used for faceted small-multiples so the entire panel grid stays visible —
   * the viewer sees it's a multi-panel chart to open, not one cropped subplot.
   */
  contain?: boolean;
  children: ReactNode;
}) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState({ scale: 1, restX: 0, restY: 0, panX: 0, panY: 0 });

  useLayoutEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;

    const measure = () => {
      const natW = inner.offsetWidth;
      const natH = inner.offsetHeight;
      if (!natW || !natH) return;
      const boxW = outer.clientWidth;
      const boxH = height;

      if (contain) {
        // Contain-fit: scale so the whole chart fits within the tile in both
        // dimensions, centred, never upscaled. No hover pan — everything is
        // already visible. A small inset keeps the grid from touching the edges
        // so it reads as a deliberately shrunk small-multiples preview.
        const inset = 8;
        const fitScale = Math.min((boxW - inset) / natW, (boxH - inset) / natH, 1);
        if (!Number.isFinite(fitScale) || fitScale <= 0) return;
        const contentW = natW * fitScale;
        const contentH = natH * fitScale;
        const restX = (boxW - contentW) / 2;
        const restY = (boxH - contentH) / 2;
        setFit((prev) => {
          const next = { scale: fitScale, restX, restY, panX: 0, panY: 0 };
          const same = (Object.keys(next) as (keyof typeof next)[]).every(
            (k) => Math.abs(prev[k] - next[k]) < 0.5,
          );
          return same ? prev : next;
        });
        return;
      }

      // Height-based gating: scale the chart to fit the tile height exactly so
      // the whole chart stays visible. Never upscale past the designed size
      // (so a chart shorter than the tile sits centred rather than blowing up
      // blurry). The width then overflows horizontally when the chart is long.
      const scale = Math.min(boxH / natH, 1);
      if (!Number.isFinite(scale) || scale <= 0) return;

      const contentW = natW * scale;
      const contentH = natH * scale;
      const overflowX = Math.max(contentW - boxW, 0);
      const overflowY = Math.max(contentH - boxH, 0);
      // Overflowing width: rest at the left, pan to the right edge on hover.
      // Narrower than the tile: centre it. Height fits, so it's centred too.
      const restX = overflowX > 0 ? 0 : (boxW - contentW) / 2;
      const restY = overflowY > 0 ? 0 : (boxH - contentH) / 2;
      const panX = overflowX > 0 ? -overflowX / scale : 0;
      const panY = overflowY > 0 ? -overflowY / scale : 0;

      setFit((prev) => {
        const next = { scale, restX, restY, panX, panY };
        const same = (Object.keys(next) as (keyof typeof next)[]).every(
          (k) => Math.abs(prev[k] - next[k]) < 0.5,
        );
        return same ? prev : next;
      });
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(inner);
    ro.observe(outer);
    return () => ro.disconnect();
  }, [height, contain]);

  return (
    <div
      ref={outerRef}
      style={{
        position: 'relative',
        width: '100%',
        height,
        overflow: 'hidden',
      }}
    >
      {/* Fit (scale + rest position) applies instantly — no entry animation. */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          transform: `translate(${fit.restX}px, ${fit.restY}px) scale(${fit.scale})`,
          transformOrigin: '0 0',
        }}
      >
        {/* Only the hover pan animates. */}
        <div
          ref={innerRef}
          style={{
            transform: hovered ? `translate(${fit.panX}px, ${fit.panY}px)` : 'none',
            transformOrigin: '0 0',
            transition: 'transform 900ms ease-in-out',
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
