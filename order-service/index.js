// ===========================================================================
//  ORDER SERVICE  --  a plain HTTP API for humans/browsers, which internally
//  calls INVENTORY SERVICE over gRPC. This is the realistic microservice
//  shape: REST at the edge, gRPC between services.
//
//    curl  --HTTP-->  order-service  --gRPC-->  inventory-service
// ===========================================================================
// Same rule as inventory-service: this must run before './inventory-client'
// pulls in '@grpc/grpc-js'.  OTEL_ENABLED=1 npm start
if (process.env.OTEL_ENABLED === '1') require('./tracing');

const http = require('node:http');
const inv = require('./inventory-client');

const PORT = process.env.PORT || 3000;
const log = (...a) => console.log('[order]', ...a);

// Translate a gRPC status code into an HTTP status code. Every gateway that
// fronts gRPC has to do this mapping somewhere.
const GRPC_TO_HTTP = {
  [inv.grpc.status.NOT_FOUND]: 404,
  [inv.grpc.status.INVALID_ARGUMENT]: 400,
  [inv.grpc.status.ALREADY_EXISTS]: 409,
  [inv.grpc.status.PERMISSION_DENIED]: 403,
  [inv.grpc.status.UNAUTHENTICATED]: 401,
  [inv.grpc.status.DEADLINE_EXCEEDED]: 504,
  [inv.grpc.status.UNAVAILABLE]: 503,
};

const send = (res, status, body) => {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(payload);
};

const fail = (res, err) => {
  const status = GRPC_TO_HTTP[err.code] || 500;
  log('upstream error:', err.code, err.details || err.message);
  send(res, status, {
    error: err.details || err.message,
    grpcCode: err.code,
    grpcStatus: Object.keys(inv.grpc.status).find((k) => inv.grpc.status[k] === err.code),
  });
};

const readJson = (req) =>
  new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { reject(new Error('body is not valid JSON')); }
    });
    req.on('error', reject);
  });

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const route = `${req.method} ${url.pathname}`;
  log(route);

  try {
    // GET /products?category=COMPUTING&minStock=1
    // -> SERVER STREAMING gRPC call, drained into a JSON array
    if (req.method === 'GET' && url.pathname === '/products') {
      const products = await inv.listProductsAll({
        category: url.searchParams.get('category') || 'CATEGORY_UNSPECIFIED',
        minStock: Number(url.searchParams.get('minStock') || 0),
      });
      return send(res, 200, { count: products.length, products });
    }

    // GET /products/P1001  -> UNARY gRPC call
    const match = url.pathname.match(/^\/products\/([\w-]+)$/);
    if (req.method === 'GET' && match) {
      const product = await inv.getProduct(match[1]);
      return send(res, 200, product);
    }

    // POST /orders  { "items": [ { "productId": "P1002", "quantity": 2 } ] }
    // -> UNARY validation calls, then one CLIENT STREAMING call
    if (req.method === 'POST' && url.pathname === '/orders') {
      const body = await readJson(req);
      const items = Array.isArray(body.items) ? body.items : [];

      if (items.length === 0) {
        return send(res, 400, { error: 'body must be { "items": [{ "productId", "quantity" }] }' });
      }

      // Validate each line with a unary call before committing the order.
      for (const item of items) {
        if (!item.productId || !Number.isInteger(item.quantity) || item.quantity <= 0) {
          return send(res, 400, { error: 'each item needs a productId and a positive integer quantity' });
        }
        await inv.getProduct(item.productId);   // throws NOT_FOUND -> 404
      }

      const summary = await inv.recordSales(items);
      return send(res, summary.failed.length ? 207 : 201, {
        orderId: `ORD-${Date.now()}`,
        ...summary,
      });
    }

    // GET /watch?ids=P1001,P1004  -> BIDI STREAMING, surfaced as SSE.
    // Open this in a browser tab to watch updates arrive live.
    if (req.method === 'GET' && url.pathname === '/watch') {
      const ids = (url.searchParams.get('ids') || '').split(',').map((s) => s.trim()).filter(Boolean);
      if (!ids.length) return send(res, 400, { error: 'pass ?ids=P1001,P1004' });

      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });

      const call = inv.watchStock();
      call.on('data', (u) => res.write(`data: ${JSON.stringify(u)}\n\n`));
      call.on('error', (e) => { res.write(`event: error\ndata: ${JSON.stringify({ message: e.details || e.message })}\n\n`); res.end(); });
      call.on('end', () => res.end());

      for (const id of ids) call.write({ productId: id });

      // Browser tab closed -> cancel the gRPC call so the server stops working.
      req.on('close', () => { call.cancel(); log('/watch client disconnected, gRPC call cancelled'); });
      return;
    }

    send(res, 404, {
      error: 'no such route',
      routes: [
        'GET  /products?category=&minStock=',
        'GET  /products/:id',
        'POST /orders',
        'GET  /watch?ids=P1001,P1004',
      ],
    });
  } catch (err) {
    if (typeof err.code === 'number') return fail(res, err);   // gRPC error
    send(res, 400, { error: err.message });
  }
});

server.listen(PORT, () => {
  log(`HTTP API on http://localhost:${PORT}`);
  log(`talking gRPC to ${process.env.INVENTORY_ADDR || 'localhost:50051'}`);
});

process.on('SIGINT', () => { inv.close(); server.close(() => process.exit(0)); });
