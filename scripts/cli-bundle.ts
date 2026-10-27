import type { BunPlugin } from "bun";

export const CLI_COMPILE = { autoloadBunfig: false, autoloadDotenv: false } as const;

const AJV_PROVIDER = /[\\/]@modelcontextprotocol[\\/]sdk[\\/]dist[\\/](?:esm|cjs)[\\/]validation[\\/]ajv-provider\.js$/;

export const NO_SCHEMA_VALIDATOR = "kiwi's MCP server asks clients for no structured input (elicitation), so it bundles no JSON Schema validator";

export const VALIDATORS = ["ajv", "ajv-formats", "fast-uri"] as const;

export function validatorsIn(sources: string[]): string[] {
  return VALIDATORS.filter((pkg) => sources.some((source) => source.includes(`node_modules/${pkg}/`)));
}

export function mcpValidatorStub(): BunPlugin {
  return {
    name: "stub-mcp-ajv",
    setup(build) {
      build.onLoad({ filter: AJV_PROVIDER }, () => ({
        contents: `export class AjvJsonSchemaValidator { getValidator() { throw new Error(${JSON.stringify(NO_SCHEMA_VALIDATOR)}); } }`,
        loader: "js",
      }));
    },
  };
}
