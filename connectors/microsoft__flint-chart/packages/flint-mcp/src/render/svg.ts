// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { resvgFontOption } from './fonts.js';
import type { RenderFormat, RenderResult, RenderBackend } from './types.js';

export interface SvgToResultOptions {
  backend: RenderBackend;
  format: RenderFormat;
  scale: number;
  background: string;
  width: number;
  height: number;
}

/**
 * Turn an SVG string into a {@link RenderResult}. For `svg` output the markup is
 * returned verbatim; for `png` it is rasterized with `@resvg/resvg-js` using the
 * bundled fonts at the requested device `scale`.
 */
export async function svgToResult(
  svg: string,
  opts: SvgToResultOptions,
): Promise<Omit<RenderResult, 'warnings'>> {
  const { backend, format, scale, background, width, height } = opts;

  if (format === 'svg') {
    return {
      backend,
      format,
      mimeType: 'image/svg+xml',
      svg,
      width,
      height,
    };
  }

  const { Resvg } = await import('@resvg/resvg-js');
  const resvg = new Resvg(svg, {
    background,
    font: resvgFontOption(),
    fitTo: scale === 1 ? { mode: 'original' } : { mode: 'zoom', value: scale },
  });
  const buffer = Buffer.from(resvg.render().asPng());
  return {
    backend,
    format,
    mimeType: 'image/png',
    buffer,
    base64: buffer.toString('base64'),
    width,
    height,
  };
}
