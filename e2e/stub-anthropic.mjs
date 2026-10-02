/* global process, console, Buffer */
// A stand-in for the Anthropic API, so the end-to-end tests exercise the real SDK and the whole
// stack without a key or the internet. It answers POST /v1/messages with canned JSON, chosen by
// what the prompt is about. A test picks the next photo answer with POST /__photo {scenario}.
import http from 'node:http';

const PORT = Number(process.env.STUB_ANTHROPIC_PORT ?? 4102);

const PHOTO = {
  // Sure of the name, nothing wrong seen.
  milk: { name: 'Milk', category: 'dairy', confidence: 0.93, warningSigns: [] },
  // Sure of the name, and a visible problem.
  mouldy: {
    name: 'Bread',
    category: 'bakery',
    confidence: 0.88,
    warningSigns: [
      { type: 'MOULD', description: 'green patches on the crust' },
      { type: 'DISCOLOURATION', description: 'dark spots near the edge' },
    ],
  },
  // Not sure what it is.
  unsure: { name: 'Something', category: 'unknown', confidence: 0.3, warningSigns: [] },
};

const RECEIPT = {
  purchaseDate: null,
  items: [
    { name: 'Milk', quantity: 2, unit: 'l', price: 2.4 },
    { name: 'Potatoes', quantity: 1, unit: 'kg', price: 3.1 },
  ],
};

let photo = 'milk';

function answerFor(request) {
  const text = JSON.stringify(request.messages ?? []);
  if (text.includes('photo of one food item')) return PHOTO[photo];
  if (text.includes('grocery receipt')) return RECEIPT;
  if (text.includes('simple home recipes')) return { recipes: [] };
  return { days: [] };
}

const readBody = (req) =>
  new Promise((resolve) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });

http
  .createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/health') return res.end('{"ok":true}');
    const body = await readBody(req);
    if (req.url === '/__photo') {
      const { scenario } = JSON.parse(body);
      if (!PHOTO[scenario]) return res.writeHead(400).end('{"error":"unknown scenario"}');
      photo = scenario;
      return res.end('{"ok":true}');
    }
    if (req.method === 'POST' && req.url?.startsWith('/v1/messages')) {
      const answer = answerFor(JSON.parse(body));
      return res.end(
        JSON.stringify({
          id: 'msg_stub',
          type: 'message',
          role: 'assistant',
          model: 'stub',
          content: [{ type: 'text', text: JSON.stringify(answer) }],
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
      );
    }
    res.writeHead(404).end('{"error":"not found"}');
  })
  .listen(PORT, () => console.log(`Stand-in AI on ${PORT}`));
