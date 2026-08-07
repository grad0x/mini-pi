import type { ToolParameterSchema } from "./tool.js";

export type ToolArgumentValidation =
  | { valid: true; args: Record<string, unknown> }
  | { valid: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateToolArguments(
  schema: ToolParameterSchema,
  input: unknown,
): ToolArgumentValidation {
  if (!isRecord(input)) {
    return { valid: false, error: "arguments must be an object" };
  }

  for (const name of schema.required ?? []) {
    if (!(name in input)) {
      return { valid: false, error: `missing required argument: ${name}` };
    }
  }

  for (const [name, value] of Object.entries(input)) {
    const property = schema.properties[name];
    if (!property) {
      if (schema.additionalProperties === false) {
        return { valid: false, error: `unexpected argument: ${name}` };
      }
      continue;
    }

    if (typeof value !== property.type) {
      return {
        valid: false,
        error: `argument ${name} must be a ${property.type}`,
      };
    }
  }

  return { valid: true, args: input };
}
