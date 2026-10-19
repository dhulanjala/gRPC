// ===========================================================================
//  RUN ME ALONE to see CLIENT STREAMING: many requests -> one response.
//    node 03-client-streaming.js
// ===========================================================================
const inv = require('./inventory-client');

async function main() {
  const cart = [
    { productId: 'P1002', quantity: 3 },
    { productId: 'P1003', quantity: 1 },
    { productId: 'P1005', quantity: 2 },   // out of stock -> lands in `failed`
    { productId: 'P1001', quantity: 1 },
  ];

  console.log('--- calling RecordSales(stream) ---');
  cart.forEach((i) => console.log(`  sending ${i.productId} x${i.quantity}`));

  const summary = await inv.recordSales(cart);
  console.log('\nserver replied once, after we half-closed (call.end()):');
  console.log(summary);
}

main()
  .catch((err) => {
    if (err.code === inv.grpc.status.UNAVAILABLE) {
      console.error('\nCannot reach inventory-service. Start it first:\n  cd inventory-service && npm start\n');
    } else {
      console.error(err);
    }
    process.exitCode = 1;
  })
  .finally(() => inv.close());
