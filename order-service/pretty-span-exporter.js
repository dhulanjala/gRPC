// ===========================================================================
//  A tiny custom OTEL SpanExporter that prints ONE readable line per span,
//  instead of the default ConsoleSpanExporter's huge JSON dump.
//  Real setups export to Jaeger/Tempo/Honeycomb/etc via OTLP instead - this
//  is purely so you can *see* what's happening while learning.
// ===========================================================================
class PrettySpanExporter {
  constructor(label) {
    this.label = label;
  }

  export(spans, resultCallback) {
    for (const span of spans) {
      const ctx = span.spanContext();
      const parent = span.parentSpanContext && span.parentSpanContext.spanId ? span.parentSpanContext.spanId.slice(0, 8) : '(root)  ';
      const durationMs = hrTimeToMs(span.duration);
      const status = span.status.code === 2 ? ' ERROR' : '';

      console.log(
        `[otel:${this.label}] trace=${ctx.traceId.slice(0, 12)} `
        + `span=${ctx.spanId.slice(0, 8)} parent=${parent} `
        + `${span.name.padEnd(28)} ${durationMs.toFixed(1).padStart(6)}ms${status}`
      );

      // Attributes worth surfacing: the gRPC method + status code the
      // auto-instrumentation attaches to every span it creates.
      const attrs = span.attributes;
      if (attrs['rpc.method']) {
        console.log(
          `                 -> rpc.system=${attrs['rpc.system']} `
          + `rpc.service=${attrs['rpc.service']} rpc.method=${attrs['rpc.method']} `
          + `grpc.status_code=${attrs['rpc.grpc.status_code']}`
        );
      }
    }
    resultCallback({ code: 0 }); // ExportResultCode.SUCCESS
  }

  shutdown() {
    return Promise.resolve();
  }
}

function hrTimeToMs([seconds, nanos]) {
  return seconds * 1000 + nanos / 1e6;
}

module.exports = { PrettySpanExporter };
