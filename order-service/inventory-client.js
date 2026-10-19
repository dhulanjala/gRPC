// ===========================================================================
//  The gRPC CLIENT STUB, wrapped in promises so the rest of the app can
//  `await` it. grpc-js is callback/stream based out of the box.
// ===========================================================================
const path = require('path');
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');

const PROTO_PATH = path.join(__dirname, '..', 'proto', 'inventory.proto');
const TARGET = process.env.INVENTORY_ADDR || 'localhost:50051';

// Load the SAME contract the server loaded. Identical options matter:
// if the server says keepCase:false and the client says true, field names
// won't line up in your JS objects.
const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: false,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});
const { inventory } = grpc.loadPackageDefinition(packageDefinition);

// One client = one HTTP/2 connection pool. Create it ONCE and reuse it.
// Creating a client per request is the most common gRPC performance mistake.
const client = new inventory.Inventory(TARGET, grpc.credentials.createInsecure(), {
  'grpc.keepalive_time_ms': 20000,
});

// A deadline is an ABSOLUTE point in time, not a duration.
const deadline = (ms) => new Date(Date.now() + ms);

// --- 1. UNARY -> Promise --------------------------------------------------
function getProduct(id, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    client.getProduct({ id }, { deadline: deadline(timeoutMs) }, (err, product) => {
      if (err) return reject(err);   // err.code is a grpc.status number
      resolve(product);
    });
  });
}

// --- 2. SERVER STREAMING -> async iterator --------------------------------
// grpc-js streams are Node Readables, so `for await` just works.
// timeoutMs is optional here: a streaming call can legitimately run for a
// long time, so unlike the unary/client-streaming calls we don't force one
// by default - the caller decides if this particular call needs a deadline.
function listProducts({ category = 'CATEGORY_UNSPECIFIED', minStock = 0, timeoutMs } = {}) {
  const options = timeoutMs ? { deadline: deadline(timeoutMs) } : {};
  return client.listProducts({ category, minStock }, options);
}

// Convenience: drain the stream into an array.
async function listProductsAll(filter) {
  const out = [];
  for await (const product of listProducts(filter)) out.push(product);
  return out;
}

// --- 3. CLIENT STREAMING -> Promise ---------------------------------------
function recordSales(items, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const call = client.recordSales({ deadline: deadline(timeoutMs) }, (err, summary) => {
      if (err) return reject(err);
      resolve(summary);
    });

    for (const item of items) call.write(item);  // push each request message
    call.end();                                  // half-close: "I'm done sending"
  });
}

// --- 4. BIDI STREAMING -> raw duplex --------------------------------------
function watchStock() {
  return client.watchStock();   // caller does .write() / .on('data') / .end()
}

function close() {
  client.close();
}

module.exports = {
  client,
  grpc,
  getProduct,
  listProducts,
  listProductsAll,
  recordSales,
  watchStock,
  close,
};
