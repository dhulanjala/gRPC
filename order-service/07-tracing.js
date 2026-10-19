// ===========================================================================
//  RUN ME to see OpenTelemetry DISTRIBUTED TRACING across both services.
//    1. In inventory-service:  OTEL_ENABLED=1 npm start
//    2. Here:                  node 07-tracing.js
//  Compare the "trace=" prefix printed in EACH terminal - client spans in
//  this terminal and server spans in the inventory-service terminal share
//  the same trace id, because grpc-js instrumentation propagates it
//  automatically through gRPC metadata (the W3C traceparent header).
// ===========================================================================
require('./tracing');   // must load before inventory-client requires grpc-js

const inv = require('./inventory-client');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log('\n--- unary call: GetProduct ---');
  await inv.getProduct('P1001');

  await sleep(300); // let the exporter flush/print before the next call

  console.log('\n--- client streaming call: RecordSales ---');
  await inv.recordSales([{ productId: 'P1002', quantity: 1 }]);

  await sleep(300);

  console.log('\n--- server streaming call: ListProducts ---');
  await inv.listProductsAll({ minStock: 1 });

  await sleep(300);
  console.log('\nNow go compare "trace=" ids between this terminal and the');
  console.log('inventory-service terminal - matching prefixes are one logical');
  console.log('request that crossed the gRPC boundary.');
}

main()
  .catch((err) => {
    if (err.code === inv.grpc.status.UNAVAILABLE) {
      console.error('\nCannot reach inventory-service. Start it with tracing on first:\n'
        + '  cd inventory-service && OTEL_ENABLED=1 npm start\n');
    } else {
      console.error(err);
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    await sleep(300);
    inv.close();
  });
