// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { ChartAssemblyInput, ChartWarning } from 'flint-chart';
import { assembleForBackend, stripPrivateKeys } from '../render/assemble.js';
import type { DataSourceOptions } from '../render/data-source.js';
import type { RenderBackend } from '../render/types.js';

export interface CompileResult {
  backend: RenderBackend;
  chartType: string;
  /** Render-ready backend-native spec (Flint's private `_`-keys removed). */
  spec: any;
  /** Warnings emitted during assembly. */
  warnings: ChartWarning[];
  /** Computed layout size from Flint's stretch model, if available. */
  computedSize?: { width: number; height: number };
}

/**
 * Compile a {@link ChartAssemblyInput} to a backend-native spec without
 * rendering. Pure JS — no native dependencies are loaded.
 */
export function compileChart(
  input: ChartAssemblyInput,
  backend: RenderBackend,
  options: DataSourceOptions = {},
): CompileResult {
  const { spec, warnings, width, height } = assembleForBackend(backend, input, options);
  stripPrivateKeys(spec);
  return {
    backend,
    chartType: input.chart_spec.chartType,
    spec,
    warnings,
    computedSize:
      typeof width === 'number' && typeof height === 'number'
        ? { width, height }
        : undefined,
  };
}
