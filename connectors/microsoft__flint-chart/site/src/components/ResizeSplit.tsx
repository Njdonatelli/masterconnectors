import { useCallback, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { siteTheme } from '../shared/theme';

type SplitDirection = 'horizontal' | 'vertical';

interface ResizeSplitProps {
  direction: SplitDirection;
  className?: string;
  /** Initial size of the first pane, as a percentage (0–100). */
  initialRatio?: number;
  minFirst?: number;
  minSecond?: number;
  /** Optional key to persist ratio in localStorage. */
  storageKey?: string;
  children: [ReactNode, ReactNode];
}

function readStoredRatio(key: string | undefined, fallback: number): number {
  if (!key) return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
}

function clampRatio(value: number, minFirst: number, minSecond: number) {
  return Math.min(100 - minSecond, Math.max(minFirst, value));
}

/**
 * Two-pane layout with a draggable divider between children.
 */
export function ResizeSplit({
  direction,
  className,
  initialRatio = 50,
  minFirst = 15,
  minSecond = 15,
  storageKey,
  children,
}: ResizeSplitProps) {
  const [ratio, setRatio] = useState(() =>
    clampRatio(readStoredRatio(storageKey, initialRatio), minFirst, minSecond),
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const isHorizontal = direction === 'horizontal';

  const updateRatio = useCallback(
    (clientX: number, clientY: number) => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const raw = isHorizontal
        ? ((clientX - rect.left) / rect.width) * 100
        : ((clientY - rect.top) / rect.height) * 100;
      const next = clampRatio(raw, minFirst, minSecond);
      setRatio(next);
      if (storageKey) {
        try {
          localStorage.setItem(storageKey, String(next));
        } catch {
          /* ignore quota errors */
        }
      }
    },
    [isHorizontal, minFirst, minSecond, storageKey],
  );

  const onHandleMouseDown = (event: React.MouseEvent) => {
    event.preventDefault();
    draggingRef.current = true;
    document.body.style.cursor = isHorizontal ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';

    const onMove = (ev: MouseEvent) => {
      if (!draggingRef.current) return;
      updateRatio(ev.clientX, ev.clientY);
    };

    const onUp = () => {
      draggingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const paneStyle: CSSProperties = {
    minWidth: 0,
    minHeight: 0,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  };

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        display: 'flex',
        flexDirection: isHorizontal ? 'row' : 'column',
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        overflow: 'hidden',
      }}
    >
      <div style={{ ...paneStyle, flex: `0 0 ${ratio}%` }}>{children[0]}</div>

      <div
        role="separator"
        aria-orientation={isHorizontal ? 'vertical' : 'horizontal'}
        aria-label="Resize panels"
        onMouseDown={onHandleMouseDown}
        style={{
          flex: '0 0 5px',
          cursor: isHorizontal ? 'col-resize' : 'row-resize',
          background: siteTheme.border,
          transition: 'background 0.15s',
          position: 'relative',
          zIndex: 1,
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLDivElement).style.background = siteTheme.borderMuted;
        }}
        onMouseLeave={(e) => {
          if (!draggingRef.current) {
            (e.currentTarget as HTMLDivElement).style.background = siteTheme.border;
          }
        }}
      />

      <div style={{ ...paneStyle, flex: '1 1 0' }}>{children[1]}</div>
    </div>
  );
}
