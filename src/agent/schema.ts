// SVGcinema — agent/schema
// The design agent's tools describe their arguments with a small subset of JSON Schema (the format
// model providers expect for tool definitions). This checks arguments against it before a tool runs,
// so a model's mistake comes back as a readable reason instead of a broken document.

export interface Schema {
  type?: 'object' | 'string' | 'number' | 'integer' | 'boolean' | 'array';
  description?: string;
  enum?: Array<string | number>;
  properties?: Record<string, Schema>;
  required?: string[];
  items?: Schema;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
  maxLength?: number;
  /** several allowed shapes (for values whose kind depends on the property) */
  anyOf?: Schema[];
  additionalProperties?: boolean | Schema;
}

function kindOf(v: unknown) {
  if (Array.isArray(v)) return 'array';
  if (v === null) return 'null';
  return typeof v;
}

/** The first problem with `v` against `s`, as a sentence naming the argument, or null when it fits. */
export function check(v: unknown, s: Schema, path = 'arguments'): string | null {
  if (s.anyOf) {
    for (const alt of s.anyOf) if (!check(v, alt, path)) return null;
    return `${path} has the wrong kind of value`;
  }
  if (s.enum && !s.enum.includes(v as any)) return `${path} must be one of: ${s.enum.join(', ')}`;
  const k = kindOf(v);
  switch (s.type) {
    case 'object': {
      if (k !== 'object') return `${path} must be an object`;
      const o = v as Record<string, unknown>;
      for (const r of s.required || []) if (o[r] === undefined) return `${path}.${r} is missing`;
      for (const [key, val] of Object.entries(o)) {
        const sub = s.properties && s.properties[key];
        if (sub) {
          const e = check(val, sub, `${path}.${key}`);
          if (e) return e;
        } else if (s.additionalProperties === false) return `${path}.${key} is not an argument of this tool`;
        else if (s.additionalProperties && typeof s.additionalProperties === 'object') {
          const e = check(val, s.additionalProperties, `${path}.${key}`);
          if (e) return e;
        }
      }
      return null;
    }
    case 'array': {
      if (k !== 'array') return `${path} must be a list`;
      const a = v as unknown[];
      if (s.minItems != null && a.length < s.minItems) return `${path} needs at least ${s.minItems} item(s)`;
      if (s.maxItems != null && a.length > s.maxItems) return `${path} takes at most ${s.maxItems} item(s)`;
      if (s.items)
        for (let i = 0; i < a.length; i++) {
          const e = check(a[i], s.items, `${path}[${i}]`);
          if (e) return e;
        }
      return null;
    }
    case 'string':
      if (k !== 'string') return `${path} must be text`;
      if (s.maxLength != null && (v as string).length > s.maxLength)
        return `${path} is too long (at most ${s.maxLength} characters)`;
      return null;
    case 'number':
    case 'integer':
      if (k !== 'number' || !isFinite(v as number)) return `${path} must be a number`;
      if (s.type === 'integer' && !Number.isInteger(v)) return `${path} must be a whole number`;
      if (s.minimum != null && (v as number) < s.minimum) return `${path} must be at least ${s.minimum}`;
      if (s.maximum != null && (v as number) > s.maximum) return `${path} must be at most ${s.maximum}`;
      return null;
    case 'boolean':
      return k === 'boolean' ? null : `${path} must be true or false`;
  }
  return null;
}
