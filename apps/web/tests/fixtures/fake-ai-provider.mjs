/**
 * A stand-in for Google AI Studio, for the ONE AI acceptance scenarios.
 *
 * `lib/ai/provider.ts` honours AI_GOOGLE_BASE_URL outside production, so the
 * app's real transport, real credential resolution and real tool loop run —
 * only the far end is here. MODE picks what the vendor does:
 *
 *   ok        a well-formed answer, no tool calls
 *   bad-key   401, the body a real rejection carries (quotes the key back)
 *   no-model  404
 *   mismatch  400
 *   outage    503
 *   hang      never answers, to exercise the client timeout
 *   tools     the real two-round shape: round 1 asks for getFollowUps(overdue),
 *             round 2 answers with the tool result it was handed, verbatim, so
 *             a test can assert what the model was actually allowed to see
 *
 * Started with: node tests/fixtures/fake-ai-provider.mjs <port> <mode>
 */
import { createServer } from 'node:http';

const port = Number(process.argv[2] || 8099);
const mode = process.argv[3] || 'ok';

const BODIES = {
  'bad-key': [
    401,
    {
      error: {
        code: 401,
        status: 'UNAUTHENTICATED',
        message: 'API key not valid. Key AIzaSyFAKE-DO-NOT-USE was rejected.',
      },
    },
  ],
  'no-model': [
    404,
    {
      error: {
        code: 404,
        status: 'NOT_FOUND',
        message: 'models/gemini-retired-1.0 is not found for API version v1beta.',
      },
    },
  ],
  mismatch: [
    400,
    { error: { code: 400, status: 'INVALID_ARGUMENT', message: 'API key not valid. Please pass a valid API key.' } },
  ],
  outage: [503, { error: { code: 503, status: 'UNAVAILABLE', message: 'The model is overloaded.' } }],
};

let seen = 0;

createServer((req, res) => {
  seen += 1;
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    console.log(`[fake-provider] #${seen} ${req.method} ${req.url.split('?')[0]} mode=${mode} bytes=${body.length}`);
    if (mode === 'hang') return; // never answers
    if (mode === 'tools') {
      // Round 1 (no functionResponse in the request yet): ask for the tool.
      // Round 2: echo the tool payload back as the answer, so the assertion is
      // about the records the server handed the model, not about wording.
      const handed = [];
      try {
        for (const c of JSON.parse(body).contents ?? [])
          for (const p of c.parts ?? [])
            if (p.functionResponse) handed.push(JSON.stringify(p.functionResponse.response ?? p.functionResponse));
      } catch {}
      res.writeHead(200, { 'content-type': 'application/json' });
      if (handed.length === 0)
        return res.end(
          JSON.stringify({
            candidates: [
              { content: { parts: [{ functionCall: { name: 'getFollowUps', args: { due: 'overdue' } } }] } },
            ],
            usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 10, totalTokenCount: 110 },
          }),
        );
      return res.end(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: `GROUNDED-IN: ${handed.join(' | ')}` }] } }],
          usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 40, totalTokenCount: 240 },
        }),
      );
    }
    if (BODIES[mode]) {
      const [status, payload] = BODIES[mode];
      res.writeHead(status, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(payload));
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [{ text: 'ACCEPTANCE-FAKE-PROVIDER: this answer came from the local stand-in, not a vendor.' }],
            },
          },
        ],
        usageMetadata: { promptTokenCount: 123, candidatesTokenCount: 17, totalTokenCount: 140 },
      }),
    );
  });
}).listen(port, '127.0.0.1', () => console.log(`[fake-provider] listening on ${port} mode=${mode}`));
