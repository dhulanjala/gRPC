// ===========================================================================
//  OpenTelemetry bootstrap. This file MUST be required before anything else
//  requires '@grpc/grpc-js' - the gRPC instrumentation works by monkey-
//  patching that module's internals the first time it's require()'d.
//  That's why server.js's very first line is require('./tracing').
// ===========================================================================
const { NodeSDK } = require('@opentelemetry/sdk-node');
const { SimpleSpanProcessor } = require('@opentelemetry/sdk-trace-node');
const { GrpcInstrumentation } = require('@opentelemetry/instrumentation-grpc');
const { resourceFromAttributes } = require('@opentelemetry/resources');
const { ATTR_SERVICE_NAME } = require('@opentelemetry/semantic-conventions');
const { PrettySpanExporter } = require('./pretty-span-exporter');

const sdk = new NodeSDK({
  resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: 'inventory-service' }),
  // SimpleSpanProcessor exports each span the instant it ends - great for
  // watching spans print live while learning. Production code uses
  // BatchSpanProcessor instead, which buffers and exports in batches.
  spanProcessors: [new SimpleSpanProcessor(new PrettySpanExporter('inventory'))],
  // This ONE instrumentation is what makes everything work: it wraps every
  // gRPC server handler in a span, wraps every client call in a span, and
  // automatically injects/extracts the W3C traceparent header into gRPC
  // metadata so spans on both sides of the wire share the same trace ID.
  instrumentations: [new GrpcInstrumentation()],
});

sdk.start();
console.log('[otel:inventory] tracing started');

process.on('SIGTERM', () => sdk.shutdown().catch(() => {}));
process.on('SIGINT', () => sdk.shutdown().catch(() => {}));
