import type { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { API_SCOPES } from '../apiKeys.js';
import { ENDPOINTS } from './endpoints.js';
import { errorSchema } from './schemas.js';

/**
 * /api/v1/openapi.json — generated from the endpoint list and its zod
 * schemas (API Plan 1, decision 8), so it cannot describe a route, field or
 * scope the API does not have.
 *
 * OpenAPI 3.1, whose schemas are plain JSON Schema: zod-to-json-schema's
 * output is used as it comes, without its `$schema` line.
 */

type Json = Record<string, unknown>;

function schemaOf(s: z.ZodTypeAny): Json {
  const out = zodToJsonSchema(s, {
    $refStrategy: 'none',
    // What is SENT: a comma-separated filter is a string on the wire, whatever it becomes.
    effectStrategy: 'input',
    pipeStrategy: 'input',
  }) as Json;
  delete out.$schema;
  return out;
}

const ERRORS: Record<string, string> = {
  '400': 'The request is not valid (`invalid_request`, `invalid_cursor`, …).',
  '401': 'No working key: `missing_key`, `invalid_key`, `key_in_url`, `key_revoked`, `key_expired`, `creator_inactive` or `api_disabled`.',
  '403': 'The key lacks a scope (`insufficient_scope`), or its creator lacks the permission in the app.',
  '404': 'Not found, or not something the key’s creator can see.',
  '429': 'Rate limited (`rate_limited`): 120 a minute, 20 a second. Wait the `Retry-After` seconds.',
};

export function openApiDocument(serverUrl: string): Json {
  const paths: Record<string, Json> = {};
  const errorRef = { $ref: '#/components/schemas/Error' };

  for (const ep of ENDPOINTS) {
    const path = ep.path.replace(/:(\w+)/g, '{$1}');
    const params: Json[] = [...ep.path.matchAll(/:(\w+)/g)].map((m) => ({
      name: m[1],
      in: 'path',
      required: true,
      schema: { type: 'string' },
    }));
    if (ep.query) {
      for (const [name, field] of Object.entries(ep.query.shape as Record<string, z.ZodTypeAny>)) {
        const schema = schemaOf(field);
        const description = typeof schema.description === 'string' ? schema.description : undefined;
        delete schema.description;
        params.push({
          name,
          in: 'query',
          required: !field.isOptional() && schema.default === undefined,
          ...(description ? { description } : {}),
          schema,
        });
      }
    }

    const scopes = ep.scopes.length ? ep.scopes.join(' or ') : 'any working key';
    const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);
    // "/leads/:id/touches" → postLeadsByIdTouches
    const operationId =
      ep.method +
      ep.path
        .split('/')
        .filter(Boolean)
        .map((seg) => (seg.startsWith(':') ? `By${cap(seg.slice(1))}` : seg.split('-').map(cap).join('')))
        .join('');
    const operation: Json = {
      operationId,
      tags: [ep.tag],
      summary: ep.summary,
      description: [ep.description, `Scope: ${scopes}.`].filter(Boolean).join('\n\n'),
      'x-scopes': ep.scopes,
      ...(params.length ? { parameters: params } : {}),
      ...(ep.body
        ? { requestBody: { required: true, content: { 'application/json': { schema: schemaOf(ep.body) } } } }
        : {}),
      responses: {
        [String(ep.status)]: {
          description: ep.status === 201 ? 'Created' : 'OK',
          content: { 'application/json': { schema: schemaOf(ep.response) } },
        },
        ...Object.fromEntries(
          Object.entries(ERRORS).map(([code, description]) => [
            code,
            { description, content: { 'application/json': { schema: errorRef } } },
          ]),
        ),
      },
    };
    if (ep.method === 'post') {
      operation.parameters = [
        ...((operation.parameters as Json[]) ?? []),
        {
          name: 'Idempotency-Key',
          in: 'header',
          required: false,
          description: 'Any unique string, like a UUID. The same key within 24 hours gets the first answer back instead of doing it twice.',
          schema: { type: 'string', maxLength: 255 },
        },
      ];
    }
    paths[path] = { ...(paths[path] ?? {}), [ep.method]: operation };
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'Flowzen API',
      version: '1.0.0',
      description: [
        'Read and update Flowzen from automation tools and AI agents. Make a key in Settings → API.',
        'Send it as `Authorization: Bearer fz_live_…` — never in the address. A key acts as the person who made it, narrowed to its scopes: it never sees or does more than they can.',
        'Lists answer `{ data, nextCursor }`; pass `?cursor=` for the next page. `?updatedSince=` and `?createdSince=` return what changed, oldest first, for polling.',
        'Errors answer `{ error: { code, message, details? } }`.',
        `Scopes: ${API_SCOPES.map((s) => `\`${s.key}\``).join(', ')}.`,
        'For AI agents, the same is offered over MCP at /api/mcp.',
      ].join('\n\n'),
    },
    servers: [{ url: serverUrl }],
    security: [{ bearerAuth: [] }],
    tags: [...new Set(ENDPOINTS.map((e) => e.tag))].map((name) => ({ name })),
    paths,
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', description: 'A Flowzen API key, fz_live_…' },
      },
      schemas: { Error: schemaOf(errorSchema) },
    },
  };
}
