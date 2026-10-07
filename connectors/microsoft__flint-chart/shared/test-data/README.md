# Shared Test Fixtures

This directory contains JSON test fixtures shared between `packages/flint-js` and `packages/flint-py`.

Each fixture is a directory named `<chart_type>__<NN>__<description>` containing:

- `input.json` — The `ChartAssemblyInput` (chart type, data, encodings, semantic types)
- `expected.json` — Expected Vega-Lite output spec
- `meta.json` — Test metadata (title, description, tags)

## Usage

**Python** (`packages/flint-py`):
```python
from pathlib import Path
FIXTURES_ROOT = Path(__file__).resolve().parent / "../../shared/test-data"
```

**JavaScript** (`packages/flint-js`):
```ts
import { readFileSync } from 'fs';
import { join } from 'path';
const FIXTURES_ROOT = join(__dirname, '../../../shared/test-data');
```

## Generating Fixtures

Use `packages/flint-py/tools/gen_fixtures.py` to regenerate fixtures from the JS test-data.
