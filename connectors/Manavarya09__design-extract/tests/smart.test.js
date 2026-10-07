import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { refineWithSmart, resolveSmartProviderConfig } from '../src/classifiers/smart.js';

describe('resolveSmartProviderConfig', () => {
  it('prefers Anthropic when present', () => {
    const config = resolveSmartProviderConfig({
      ANTHROPIC_API_KEY: 'anthropic-key',
      ATLASCLOUD_API_KEY: 'atlas-key',
      OPENAI_API_KEY: 'openai-key',
    });

    assert.deepEqual(config, {
      provider: 'anthropic',
      apiKey: 'anthropic-key',
      model: 'claude-haiku-4-5-20251001',
    });
  });

  it('resolves Atlas Cloud with default base URL and model', () => {
    const config = resolveSmartProviderConfig({
      ATLASCLOUD_API_KEY: 'atlas-key',
    });

    assert.deepEqual(config, {
      provider: 'atlascloud',
      apiKey: 'atlas-key',
      baseUrl: 'https://api.atlascloud.ai/v1',
      model: 'deepseek-ai/deepseek-v4-pro',
    });
  });

  it('accepts Atlas Cloud alias env vars', () => {
    const config = resolveSmartProviderConfig({
      ATLAS_CLOUD_API_KEY: 'atlas-key',
      ATLAS_CLOUD_API_BASE: 'https://atlas.example.com/v1/',
      ATLAS_CLOUD_MODEL: 'deepseek-ai/deepseek-v4-flash',
    });

    assert.deepEqual(config, {
      provider: 'atlascloud',
      apiKey: 'atlas-key',
      baseUrl: 'https://atlas.example.com/v1',
      model: 'deepseek-ai/deepseek-v4-flash',
    });
  });

  it('resolves OpenAI-compatible base URL overrides for OpenAI', () => {
    const config = resolveSmartProviderConfig({
      OPENAI_API_KEY: 'openai-key',
      OPENAI_BASE_URL: 'https://proxy.example.com/v1/',
      DESIGNLANG_MODEL: 'gpt-4.1-mini',
    });

    assert.deepEqual(config, {
      provider: 'openai',
      apiKey: 'openai-key',
      baseUrl: 'https://proxy.example.com/v1',
      model: 'gpt-4.1-mini',
    });
  });
});

describe('refineWithSmart', () => {
  it('returns a helpful reason when no provider is configured', async () => {
    const original = {
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
      ATLASCLOUD_API_KEY: process.env.ATLASCLOUD_API_KEY,
      ATLAS_CLOUD_API_KEY: process.env.ATLAS_CLOUD_API_KEY,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    };

    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ATLASCLOUD_API_KEY;
    delete process.env.ATLAS_CLOUD_API_KEY;
    delete process.env.OPENAI_API_KEY;

    try {
      const result = await refineWithSmart({
        enabled: true,
        rawData: {},
        design: {},
        pageIntent: {},
        sectionRoles: {},
        materialLanguage: {},
        componentLibrary: {},
      });

      assert.equal(result.applied, false);
      assert.match(result.reason, /ATLASCLOUD_API_KEY/);
    } finally {
      for (const [key, value] of Object.entries(original)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});
