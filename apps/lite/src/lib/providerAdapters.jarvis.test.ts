import assert from 'node:assert/strict';
import { JarvisAdapter, normalizeProviderName } from './providerAdapters.js';

const originalFetch = globalThis.fetch;
try {
  let request: { url?: string; init?: RequestInit } = {};
  globalThis.fetch = async (url, init) => {
    request = { url: String(url), init };
    return new Response([
      JSON.stringify({ tipo: 'inicio', conversaId: 'conv-1' }),
      JSON.stringify({ tipo: 'delta', texto: 'Olá, ' }),
      JSON.stringify({ tipo: 'delta', texto: 'Jean.' }),
      JSON.stringify({ tipo: 'fim' }),
      '',
    ].join('\n'), { status: 200, headers: { 'content-type': 'application/x-ndjson' } });
  };

  const texto = await new JarvisAdapter().chat({
    messages: [{ role: 'user', content: 'oi' }],
    model: 'jarvis-router',
    maxTokens: 100,
    apiKey: 'segredo',
    username: 'jean',
    baseUrl: 'https://jarvis.example',
  });
  assert.equal(texto, 'Olá, Jean.');
  assert.equal(request.url, 'https://jarvis.example/api/chat');
  assert.equal((request.init?.headers as Record<string, string>).Authorization, `Basic ${Buffer.from('jean:segredo').toString('base64')}`);
  assert.deepEqual(JSON.parse(String(request.init?.body)), { mensagem: 'oi' });
  assert.equal(normalizeProviderName('Jarvis local'), 'jarvis');
  console.log('✓ adaptador JARVIS: NDJSON, URL e Basic Auth');
} finally {
  globalThis.fetch = originalFetch;
}
