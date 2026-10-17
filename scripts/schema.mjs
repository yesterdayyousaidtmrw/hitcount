// Generates schema/event.v1.json, schema/row.v1.json and docs/openapi.json from the TypeScript types
// (src/types.ts, src/events.ts, src/sinks/row.ts), so the docs move with the code.
// --check writes nothing and exits 1 when a generated file is out of date.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createGenerator } from 'ts-json-schema-generator';

const CHECK = process.argv.includes('--check');
const EXAMPLES = 'docs/examples.json';

const generator = createGenerator({
  path: 'src/index.ts',
  tsconfig: 'tsconfig.json',
  type: '*',
  expose: 'export',
  topRef: true,
  jsDoc: 'extended',
  skipTypeCheck: true,
  // Plugins may add fields to events; only the row schema is closed.
  additionalProperties: true,
});

// The generator emits draft-07; OpenAPI 3.1 speaks 2020-12, where definitions are $defs.
function generate(type) {
  const { $ref, definitions } = JSON.parse(
    JSON.stringify(generator.createSchema(type)).replaceAll('#/definitions/', '#/$defs/'),
  );
  const { [$ref.split('/').pop()]: root, ...defs } = definitions;
  return { root, defs };
}

function eventSchema() {
  const event = generate('AnalyEvent');
  const builtIns = generate('BuiltInEvents');
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'urn:analy:schema:event:v1',
    title: 'analy event v1',
    ...event.root,
    // Each built-in event name pins the shape of props.
    allOf: Object.entries(builtIns.root.properties).map(([name, props]) => ({
      if: { properties: { name: { const: name } }, required: ['name'] },
      then: { properties: { props } },
    })),
    $defs: { ...event.defs, ...builtIns.defs },
  };
}

function rowSchema() {
  const row = generate('EventRow');
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'urn:analy:schema:row:v1',
    title: 'analy event row v1',
    ...row.root,
    additionalProperties: false,
    $defs: row.defs,
  };
}

// Real events captured by the harness (npm run harness), one per name, become the spec's examples.
function examples() {
  if (!existsSync(EXAMPLES)) return {};
  const byName = JSON.parse(readFileSync(EXAMPLES, 'utf8'));
  return Object.fromEntries(
    Object.entries(byName).map(([name, event]) => [name, { summary: `${name}, captured in a real browser`, value: [event] }]),
  );
}

function openapi(event, row) {
  const batchExamples = examples();
  return {
    openapi: '3.1.0',
    info: {
      title: 'analy collector API',
      version: '1.0.0',
      summary: 'What an endpoint receives from the analy script.',
      description: [
        'analy runs in the browser and hosts no API of its own. This spec describes the requests its sinks',
        'send, so you can build, generate or validate a collector for them. It is generated from the source',
        'types by scripts/schema.mjs on every build.',
        '',
        '- `POST /collect` is whatever URL you give the `http()` sink (`data-endpoint` on the script tag).',
        "- `POST /rest/v1/{table}` is what the `supabase()` sink sends to Supabase's REST API.",
        '',
        'Delivery is at least once. A batch that fails with a network error, 408, 429 or 5xx is kept and sent',
        'again 2s, 10s, 30s, then every 2 minutes, up to `maxRetries` times (default 5), and is saved with',
        'the ids when the page is hidden so the next page retries it. Any other 4xx drops the batch. So the',
        'same event can arrive twice: every event has a unique `id`; make inserts idempotent on it.',
      ].join('\n'),
      license: { name: 'MIT', identifier: 'MIT' },
    },
    jsonSchemaDialect: 'https://json-schema.org/draft/2020-12/schema',
    servers: [
      {
        url: 'https://{host}',
        description: 'Your collector',
        variables: { host: { default: 'collect.your-site', description: 'Wherever you host the collector.' } },
      },
    ],
    tags: [
      { name: 'collect', description: 'The http() sink' },
      { name: 'supabase', description: 'The supabase() sink' },
    ],
    paths: {
      '/collect': {
        post: {
          tags: ['collect'],
          operationId: 'collectEvents',
          summary: 'Receive a batch of events',
          // Browsers call it directly with no credentials: it is a public endpoint by design.
          security: [],
          description: [
            'One request per batch: up to `batchSize` events (default 10), sent when the batch fills, after',
            '`flushIntervalMs` (default 5000) or when the page is hidden.',
            '',
            'Without custom headers the body is `text/plain`, which is CORS-safelisted: no preflight, and',
            '`navigator.sendBeacon` can deliver it while the page unloads. Parse the body as JSON whatever the',
            'content type says. With `http(url, { headers })` the body is `application/json` and the browser',
            'sends a CORS preflight first. A `format()` option replaces the body with your own shape.',
            '',
            'With `http(url, { compress: true })` (`data-compress` on the script tag) the body may be gzip, with',
            'the content type unchanged: a body whose first two bytes are `1f 8b` is gzip, anything else is plain',
            'JSON. Batches sent while the page unloads are never compressed. `readBatch(request)` from',
            '`hitcount/server` handles both and returns the parsed batch.',
          ].join('\n'),
          requestBody: {
            required: true,
            content: {
              'text/plain': {
                schema: { type: 'string', contentMediaType: 'application/json', contentSchema: { $ref: '#/components/schemas/Batch' } },
              },
              'application/json': {
                schema: { $ref: '#/components/schemas/Batch' },
                ...(Object.keys(batchExamples).length ? { examples: batchExamples } : {}),
              },
            },
          },
          responses: {
            204: { description: 'Stored. Any 2xx works; the body is ignored.' },
            400: { description: "Malformed batch. Reported to the script's onError; the batch is dropped, not retried." },
            default: {
              description:
                "408, 429 and 5xx are retried with backoff and reported to the script's onError only once the retries run out. Any other non-2xx is reported at once and the batch is dropped.",
            },
          },
        },
      },
      '/rest/v1/{table}': {
        post: {
          tags: ['supabase'],
          operationId: 'insertEventRows',
          summary: 'Insert flat event rows into Supabase',
          description:
            'Sent by `supabase({ url, key, table })`. Each event is flattened by `toRow()` into a row of the table in `schema/postgres.sql`, whose row-level security lets the public key insert and nothing else.',
          security: [{ supabaseKey: [] }],
          parameters: [
            { name: 'table', in: 'path', required: true, schema: { type: 'string', default: 'analy_events' } },
            { name: 'prefer', in: 'header', required: true, schema: { const: 'return=minimal' } },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': { schema: { type: 'array', minItems: 1, items: { $ref: '#/components/schemas/EventRow' } } },
            },
          },
          responses: {
            201: { description: 'Rows inserted.' },
            400: { description: "Rows did not match the table. Reported to the script's onError; the batch is dropped, not retried." },
            default: {
              description:
                "PostgREST error. 408, 429 and 5xx are retried with backoff, as for /collect; any other is reported to the script's onError and the batch is dropped.",
            },
          },
        },
      },
    },
    components: {
      securitySchemes: {
        supabaseKey: {
          type: 'apiKey',
          in: 'header',
          name: 'apikey',
          description: 'Supabase anon or publishable key. Legacy JWT anon keys are also sent as `Authorization: Bearer <key>`.',
        },
      },
      schemas: componentSchemas(event, row),
    },
  };
}

// One self-contained spec: every $defs entry becomes a component, so viewers and code generators
// never have to resolve a second file.
function componentSchemas(event, row) {
  const strip = ({ $schema, $id, $defs, ...schema }) => schema;
  const schemas = {
    ...event.$defs,
    ...row.$defs,
    AnalyEvent: strip(event),
    EventRow: strip(row),
    Batch: { type: 'array', minItems: 1, items: { $ref: '#/$defs/AnalyEvent' } },
  };
  return JSON.parse(JSON.stringify(schemas).replaceAll('#/$defs/', '#/components/schemas/'));
}

const event = eventSchema();
const row = rowSchema();
const outputs = {
  'schema/event.v1.json': event,
  'schema/row.v1.json': row,
  'docs/openapi.json': openapi(event, row),
};

const stale = [];
for (const [file, value] of Object.entries(outputs)) {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  if (existsSync(file) && readFileSync(file, 'utf8') === text) continue;
  if (CHECK) stale.push(file);
  else {
    writeFileSync(file, text);
    console.log(`wrote ${file}`);
  }
}
if (stale.length) {
  console.error(`out of date, run npm run docs: ${stale.join(', ')}`);
  process.exit(1);
}
