// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CONFIG_RULES } from '../src/script/config';
import { postgresColumns } from './helpers';

// One naming rule for everything on the wire: event names and table columns are snake_case (SQL
// folds case, so camelCase columns would need quoting forever); property names inside the JSON (the
// envelope, every built-in event's props, the script-tag config) are camelCase, as JavaScript reads them.
const SNAKE = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;
const CAMEL = /^[a-z][a-zA-Z0-9]*$/;
const breaking = (names: Iterable<string>, rule: RegExp) => [...names].filter((name) => !rule.test(name));
const readJson = (path: string) => JSON.parse(readFileSync(path, 'utf8'));

/** Every name under a `properties` keyword anywhere in a JSON Schema, nested objects and $defs included. */
function propertyNames(schema: unknown, found = new Set<string>()): Set<string> {
  if (typeof schema !== 'object' || schema === null) return found;
  for (const [key, value] of Object.entries(schema)) {
    if (key !== 'properties') propertyNames(value, found);
    else
      for (const [name, property] of Object.entries(value as object)) {
        found.add(name);
        propertyNames(property, found);
      }
  }
  return found;
}

/** Event names passed as a literal to track() or the core's capture() anywhere in src/. */
function trackedNames(): Set<string> {
  const names = new Set<string>();
  for (const file of readdirSync('src', { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.ts'))) {
    for (const [, name] of readFileSync(`src/${file}`, 'utf8').matchAll(/\b(?:track|capture)\(\s*'([^']+)'/g)) names.add(name);
  }
  return names;
}

/** The plugin names the script tag's plugins option takes: the registry keys in the full build. */
function scriptPluginNames(): string[] {
  const registry = readFileSync('src/script/full.ts', 'utf8').match(/boot\(\{([^}]*)\}\)/)![1];
  return registry.split(',').map((entry) => entry.split(':')[0].trim()).filter(Boolean);
}

const eventSchema = readJson('schema/event.v1.json');
const builtInNames: string[] = eventSchema.allOf.map((rule: { if: { properties: { name: { const: string } } } }) => rule.if.properties.name.const);

describe('naming rule', () => {
  it('event names are snake_case: every BuiltInEvents key and every name a plugin or the core tracks', () => {
    const tracked = trackedNames();
    // The scan must see the names it exists to check, or an empty scan would pass.
    expect([...tracked]).toEqual(expect.arrayContaining(['pageview', 'identify', 'engagement', 'form_progress']));
    expect(builtInNames.length).toBeGreaterThan(0);
    expect(breaking([...builtInNames, ...tracked], SNAKE)).toEqual([]);
  });

  it('every property name in schema/event.v1.json is camelCase: the envelope and every event’s props, at any depth', () => {
    const names = propertyNames(eventSchema);
    expect([...names]).toEqual(expect.arrayContaining(['viewId', 'userAgent', 'activeMs', 'timeToViewMs']));
    expect(breaking(names, CAMEL)).toEqual([]);
  });

  it('every column in schema/row.v1.json and schema/postgres.sql is snake_case', () => {
    const rowColumns = Object.keys(readJson('schema/row.v1.json').properties);
    const sqlColumns = postgresColumns();
    expect(rowColumns).toContain('page_view_id');
    expect(sqlColumns).toContain('received_at');
    expect(breaking([...rowColumns, ...sqlColumns], SNAKE)).toEqual([]);
  });

  it('every key of the script-tag config is camelCase, plugin names included', () => {
    const plugins = scriptPluginNames();
    expect(plugins).toEqual(expect.arrayContaining(['pageviews', 'redact']));
    expect(breaking([...Object.keys(CONFIG_RULES), ...plugins], CAMEL)).toEqual([]);
  });
});
