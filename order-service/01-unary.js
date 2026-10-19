// ===========================================================================
//  RUN ME ALONE to see just the UNARY call: one request -> one response.
//    node 01-unary.js
// ===========================================================================
const inv = require('./inventory-client');

async function main() {
  console.log('--- calling GetProduct("P1001") ---');
  const product = await inv.getProduct('P1001');
  console.log('response received:');
  console.log(product);

  console.log('\n--- calling GetProduct("DOES-NOT-EXIST") ---');
  try {
    await inv.getProduct('DOES-NOT-EXIST');
  } catch (err) {
    console.log('server returned a gRPC error:');
    console.log('  code   :', err.code, `(${inv.grpc.status[err.code]})`);
    console.log('  details:', err.details);
  }
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
