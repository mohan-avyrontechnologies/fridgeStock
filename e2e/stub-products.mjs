/* global process, URL, console */
// A stand-in for Open Food Facts, so the end-to-end tests never reach the internet.
// Answers the one request the app makes: GET /api/v2/product/<barcode>.json
import http from 'node:http';

const PORT = Number(process.env.STUB_PRODUCTS_PORT ?? 4101);

const PRODUCTS = {
  // A real-looking EAN-13 (valid check digit).
  4006381333931: {
    product_name: 'Whole milk',
    brands: 'Acme Dairy, Other',
    product_quantity: '1000',
    product_quantity_unit: 'ml',
  },
};

http
  .createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
    res.setHeader('Content-Type', 'application/json');
    if (url.pathname === '/health') return res.end('{"ok":true}');
    const match = /^\/api\/v2\/product\/(\d+)\.json$/.exec(url.pathname);
    const product = match ? PRODUCTS[match[1]] : undefined;
    res.end(JSON.stringify(product ? { status: 1, product } : { status: 0 }));
  })
  .listen(PORT, () => console.log(`Stand-in product database on ${PORT}`));
