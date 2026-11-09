// Resolves the renderer's @core/ alias so its plain-JS modules can be tested with node
const root = new URL('../../src/renderer/core/', import.meta.url);
export async function resolve(specifier, context, next) {
  if (specifier.startsWith('@core/')) return next(new URL(`${specifier.slice(6)}.js`, root).href, context);
  return next(specifier, context);
}
