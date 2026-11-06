export const shellQuote = value => `'${value.replace(/'/g, "'\\''")}'`;

export function pathArgument(value) {
  if (['~', '$HOME', '${HOME}'].includes(value)) return '"$HOME"';
  for (const prefix of ['~/', '$HOME/', '${HOME}/']) {
    if (value.startsWith(prefix)) return `"$HOME"/${shellQuote(value.slice(prefix.length))}`;
  }
  return shellQuote(value.startsWith('-') ? `./${value}` : value);
}

export function validateParameters(value, fields, { empty = [] } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== fields.length ||
      fields.some(field => typeof value[field] !== 'string' || (!empty.includes(field) && !value[field].length) ||
        value[field].length > 1000 || /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value[field]))) {
    throw new Error('The model returned invalid proposal parameters. Nothing was run.');
  }
}
