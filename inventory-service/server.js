// ===========================================================================
//  INVENTORY SERVICE  --  the gRPC SERVER
//  Listens on 0.0.0.0:50051 and implements the `inventory.Inventory` service.
// ===========================================================================
// OTEL must be initialized before '@grpc/grpc-js' is required anywhere,
// because it works by monkey-patching that module on first require().
// Opt-in via env var so the plain demos stay quiet by default:
//   OTEL_ENABLED=1 npm start
if (process.env.OTEL_ENABLED === '1') require('./tracing');

const path = require('path');
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');

const { products } = require('./data');

const PROTO_PATH = path.join(__dirname, '..', 'proto', 'inventory.proto');
const PORT = process.env.PORT || '50051';

// ---------------------------------------------------------------------------
// STEP 1: load the .proto at runtime ("dynamic codegen").
// The alternative is `grpc-tools` static codegen, but this is far simpler and
// is what most Node projects use.
// ---------------------------------------------------------------------------
const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: false,  // snake_case in proto -> camelCase in JS (product_id -> productId)
  longs: String,
  enums: String,    // give us 'COMPUTING' instead of the raw number 1
  defaults: true,
  oneofs: true,
});

// grpcObject mirrors the proto package structure: inventory.Inventory
const grpcObject = grpc.loadPackageDefinition(packageDefinition);
const inventoryPkg = grpcObject.inventory;

const log = (...args) => console.log('[inventory]', ...args);

// ---------------------------------------------------------------------------
// STEP 2: implement each RPC. The shape of the handler depends on the RPC type.
// ---------------------------------------------------------------------------

// --- 1. UNARY -------------------------------------------------------------
// signature: (call, callback). call.request holds the decoded message.
function getProduct(call, callback) {
  const { id } = call.request;
  log(`GetProduct(${id})`);

  const product = products.get(id);

  if (!product) {
    // This is how you return a gRPC ERROR. Do NOT throw - pass it to callback.
    // The client receives a proper status code, not a 500-shaped mess.
    return callback({
      code: grpc.status.NOT_FOUND,          // maps to HTTP 404-ish semantics
      details: `No product with id "${id}"`,
    });
  }

  // First arg null = success. Second arg = the Product message.
  callback(null, product);
}

// --- 2. SERVER STREAMING --------------------------------------------------
// signature: (call). Push with call.write(), finish with call.end().
function listProducts(call) {
  const { category, minStock } = call.request;
  log(`ListProducts(category=${category}, minStock=${minStock})`);

  const matches = [...products.values()].filter((p) => {
    const categoryOk = !category || category === 'CATEGORY_UNSPECIFIED' || p.category === category;
    const stockOk = p.stock >= (minStock || 0);
    return categoryOk && stockOk;
  });

  // Emit one message every 300ms so you can SEE it streaming rather than
  // arriving as one batch. A real service would write as rows arrive from the DB.
  let i = 0;
  const timer = setInterval(() => {
    if (i >= matches.length) {
      clearInterval(timer);
      call.end();                     // <- closes the stream cleanly
      log(`ListProducts: streamed ${matches.length} product(s)`);
      return;
    }
    call.write(matches[i++]);         // <- one message on the wire
  }, 300);

  // If the client hangs up early, stop the timer or we leak it.
  call.on('cancelled', () => {
    clearInterval(timer);
    log('ListProducts: client cancelled');
  });
}

// --- 3. CLIENT STREAMING --------------------------------------------------
// signature: (call, callback). Read with call.on('data'), reply once on 'end'.
function recordSales(call, callback) {
  log('RecordSales: stream opened');

  const summary = { itemsSold: 0, lineCount: 0, totalAmount: 0, failed: [] };

  call.on('data', (saleItem) => {
    const { productId, quantity } = saleItem;
    const product = products.get(productId);

    summary.lineCount += 1;

    if (!product || product.stock < quantity) {
      summary.failed.push(productId);
      log(`  x ${productId} rejected (stock=${product ? product.stock : 'n/a'}, want=${quantity})`);
      return;
    }

    product.stock -= quantity;                       // mutate our "database"
    summary.itemsSold += quantity;
    summary.totalAmount += product.price * quantity;
    log(`  + ${productId} x${quantity} -> stock now ${product.stock}`);
  });

  call.on('end', () => {
    summary.totalAmount = Number(summary.totalAmount.toFixed(2));
    log('RecordSales: stream ended ->', summary);
    callback(null, summary);                         // the single response
  });

  call.on('error', (err) => log('RecordSales error:', err.message));
}

// --- 4. BIDIRECTIONAL STREAMING -------------------------------------------
// signature: (call). Read and write independently on the same call.
function watchStock(call) {
  log('WatchStock: stream opened');
  const watched = new Set();

  // Every second, push the current stock of everything the client asked for.
  const timer = setInterval(() => {
    for (const id of watched) {
      const p = products.get(id);
      if (!p) continue;
      call.write({
        productId: p.id,
        name: p.name,
        stock: p.stock,
        observedAt: new Date().toISOString(),
      });
    }
  }, 1000);

  const stop = () => clearInterval(timer);

  call.on('data', (query) => {
    log(`WatchStock: now watching ${query.productId}`);
    watched.add(query.productId);

    // Respond immediately too, so the client isn't waiting a full second.
    const p = products.get(query.productId);
    call.write(
      p
        ? { productId: p.id, name: p.name, stock: p.stock, observedAt: new Date().toISOString() }
        : { productId: query.productId, name: '(unknown product)', stock: -1, observedAt: new Date().toISOString() }
    );
  });

  call.on('end', () => { stop(); call.end(); log('WatchStock: client closed its side'); });
  call.on('cancelled', () => { stop(); log('WatchStock: cancelled'); });
  call.on('error', (err) => { stop(); log('WatchStock error:', err.message); });
}

// ---------------------------------------------------------------------------
// STEP 3: wire the implementations to the service definition and serve.
// ---------------------------------------------------------------------------
function main() {
  const server = new grpc.Server();

  server.addService(inventoryPkg.Inventory.service, {
    getProduct,
    listProducts,
    recordSales,
    watchStock,
  });

  server.bindAsync(
    `0.0.0.0:${PORT}`,
    // Insecure = plaintext h2c. Fine for localhost/learning; use TLS in prod
    // (grpc.ServerCredentials.createSsl(...)).
    grpc.ServerCredentials.createInsecure(),
    (err, port) => {
      if (err) {
        console.error('[inventory] failed to bind:', err.message);
        process.exit(1);
      }
      log(`gRPC server listening on 0.0.0.0:${port}`);
    }
  );

  // Graceful shutdown: let in-flight RPCs finish.
  const shutdown = () => {
    log('shutting down...');
    server.tryShutdown(() => process.exit(0));
    setTimeout(() => { server.forceShutdown(); process.exit(0); }, 3000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
