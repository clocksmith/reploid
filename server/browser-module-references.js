/** Literal dependency and asset references shared by source rewriting and checks.
 * Computed imports retain their expression for the owned-loader exception check.
 * Ordinary data strings are never dependency references. Parse errors propagate.
 */
import { parse } from 'acorn';

const literal = node => {
  if (node?.type === 'Literal' && typeof node.value === 'string') return {
    value: node.value, start: node.start + 1, end: node.end - 1
  };
  if (node?.type === 'TemplateLiteral' && !node.expressions.length) return {
    value: node.quasis[0].value.cooked, start: node.quasis[0].start, end: node.quasis[0].end
  };
  return null;
};
const importMetaUrl = node => node?.type === 'MemberExpression'
  && node.object?.type === 'MetaProperty' && node.object.meta.name === 'import'
  && node.object.property.name === 'meta'
  && (node.computed ? node.property?.value === 'url' : node.property?.name === 'url');

export function browserModuleReferences(code) {
  const tree = parse(code, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true });
  const references = [];
  const add = (source, kind, dynamic = false) => {
    const reference = literal(source);
    references.push({ ...reference, value: reference?.value ?? null,
      expression: code.slice(source.start, source.end), kind, dynamic });
  };
  const visit = node => {
    if (!node || typeof node !== 'object') return;
    if (['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration', 'ImportExpression'].includes(node.type) && node.source) {
      add(node.source, 'module', node.type === 'ImportExpression');
    }
    if (node.type === 'NewExpression' && node.callee?.name === 'URL'
      && importMetaUrl(node.arguments[1]) && node.arguments[0]) {
      add(node.arguments[0], 'asset', !literal(node.arguments[0]));
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value?.type) visit(value);
    }
  };
  visit(tree);
  return references;
}
