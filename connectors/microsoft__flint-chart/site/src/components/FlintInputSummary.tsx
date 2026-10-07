import { useMemo } from 'react';
import type { TestCase } from 'flint-chart/test-data';
import { testCaseToFlintSummary } from '../shared/test-case-utils';
import { siteTheme } from '../shared/theme';

/** Compact Flint input — semantic_types and chart_spec only (no data). */
export function FlintInputSummary({ testCase }: { testCase: TestCase }) {
  const text = useMemo(
    () => JSON.stringify(testCaseToFlintSummary(testCase), null, 2),
    [testCase],
  );

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        height: '100%',
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: siteTheme.textMuted,
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          marginBottom: 6,
        }}
      >
        Flint input
      </div>
      <pre
        style={{
          margin: 0,
          padding: '10px 12px',
          flex: 1,
          overflow: 'auto',
          fontSize: 11,
          lineHeight: 1.45,
          fontFamily: siteTheme.fontMono,
          color: siteTheme.text,
          background: siteTheme.surface,
          border: `1px solid ${siteTheme.border}`,
          borderRadius: siteTheme.radius,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {text}
      </pre>
    </div>
  );
}
