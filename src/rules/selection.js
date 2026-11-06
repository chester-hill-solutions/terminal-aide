export const MAX_PROMPT_RULES = 8;
export const MAX_PROMPT_RULE_BYTES = 2000;

const TOPICS = {
  search: /\b(search(?:ing|es)?|find(?:ing)?|grep|ripgrep|zipgrep|rg|locate|looking for|scan(?:ning)?|occurrences?|contain(?:s|ing)?)\b/i,
  transfer: /\b(scp|sftp|rsync|upload(?:ing)?|download(?:ing)?|transfer(?:ring|s)?|copy(?:ing)?|send(?:ing)?|fetch(?:ing)?|sync(?:hroni[sz](?:e|ing|ation))?|mirror(?:ing)?)\b/i,
  sizes: /\b(size(?:s)?|disk|space|storage|largest|biggest|du|df|usage|footprint)\b|\bhow (?:big|large)\b/i,
  archive: /\b(archive(?:s)?|zip|unzip|tar|tarballs?|tgz|txz|tbz2?|gzip|compress(?:ed|ion|ing)?|extract(?:ing)?|unpack(?:ing)?)\b/i,
  network: /\b(network|curl|wget|https?|ping|dns|ports?|url|website|internet|sockets?)\b|\b(?:(?:public|private|external|internal) ip|ip address)\b/i,
  process: /\b(process(?:es)?|pid|ps|kill|service(?:s)?|terminat(?:e|ing)|background jobs?)\b/i,
  git: /\b(git|commit(?:s|ting)?|branch(?:es)?|rebase|merge|checkout|repository|repo|uncommitted|staged|worktrees?|stash)\b/i,
  packages: /\b(package(?:s)?|npm|pnpm|yarn|bun|pip|uv|cargo|brew|install(?:ing|ed)?|dependenc(?:y|ies)|librar(?:y|ies))\b/i,
  math: /\b(math|calculat(?:e|ing|ion|ions)|square root|sqrt|arithmetic)\b|\d+\s+(?:times|plus|minus|divided by|multiplied by)\s+\d+|\bdivide\s+\d+\s+by\s+\d+/i,
};

export function parseConditions(value) {
  const conditions = typeof value === 'string' ? value.trim().split(/[,\s]+/) : value;
  if (!Array.isArray(conditions) || !conditions.length || conditions.length > 8 ||
      conditions.some((item) => typeof item !== 'string' || !/^[a-z][a-z0-9_-]{0,31}$/i.test(item))) {
    throw new Error('Use --when with a topic or comma-separated topics, such as search,transfer.');
  }
  const result = [...new Set(conditions.map((item) => item.toLowerCase()))];
  if (result.includes('general') && result.length > 1) throw new Error('General rules cannot also have task conditions. Use --always on its own.');
  return result;
}

export function validateRules(rules) {
  if (!Array.isArray(rules) || rules.length > 50 || rules.some((rule) =>
    typeof rule !== 'string' || !rule.trim() || rule.length > 2000 || /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(rule))) {
    throw new Error('Rules must be a JSON array of at most 50 nonempty, single-line strings, each at most 2000 characters.');
  }
  return rules;
}

export function ruleText(rule) { return typeof rule === 'string' ? rule : rule.text; }

export function validateStoredRules(rules) {
  if (!Array.isArray(rules) || rules.length > 50) throw new Error('Expected an array of at most 50 rules.');
  for (const rule of rules) {
    if (typeof rule === 'string') validateRules([rule]);
    else {
      if (!rule || Array.isArray(rule) || typeof rule !== 'object' ||
          Object.keys(rule).length !== 2 || !('text' in rule) || !('when' in rule)) {
        throw new Error('A scoped rule must contain exactly text and when.');
      }
      validateRules([rule.text]);
      parseConditions(rule.when);
    }
  }
  return rules;
}

export function ruleConditions(rule) {
  if (typeof rule !== 'string') return parseConditions(rule.when);
  // Unknown preferences and negative constraints remain general rather than being guessed away.
  const normalized = rule.normalize('NFKC').replace(/[’‘ʼ]/g, "'");
  if (/\b(never|avoid|no|not|without|cannot|exclude|disallow|forbid|prohibit)\b|n't\b/i.test(normalized)) return ['general'];
  const topics = Object.entries(TOPICS).filter(([, pattern]) => pattern.test(rule)).map(([name]) => name);
  return topics.length ? topics : ['general'];
}

export function promptRuleBytes(rules) { return Buffer.byteLength(JSON.stringify(rules), 'utf8'); }

export function validatePromptRules(rules) {
  validateRules(rules);
  if (rules.length > MAX_PROMPT_RULES || promptRuleBytes(rules) > MAX_PROMPT_RULE_BYTES) {
    throw new Error('Selected rules exceed the prompt budget (8 rules / 2000 bytes). Shorten the instructions or narrow their conditions.');
  }
}

export function selectRules(entries, request, followups = []) {
  const task = [request, ...followups.map(({ answer }) => answer)].join(' ');
  const topics = Object.entries(TOPICS).filter(([, pattern]) => pattern.test(task)).map(([name]) => name);
  const words = new Set(task.toLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? []);
  const active = new Set([...topics, ...words]);
  const skipped = [];
  const unique = new Map();
  for (const entry of entries) {
    validateStoredRules([entry.rule]);
    const text = ruleText(entry.rule).trim();
    const when = ruleConditions(entry.rule);
    const general = when.includes('general');
    const candidate = { ...entry, text, when, general };
    if (!general && !when.some((topic) => active.has(topic))) {
      skipped.push({ ...candidate, reason: 'unrelated' });
      continue;
    }
    const previous = unique.get(text);
    if (previous) {
      skipped.push({ ...previous, reason: 'duplicate' });
      candidate.general ||= previous.general;
      if (candidate.general) candidate.when = ['general'];
    }
    unique.set(text, candidate);
  }
  const candidates = [...unique.values()];
  const selected = candidates.filter(({ general }) => general);
  const fits = (items) => items.length <= MAX_PROMPT_RULES && promptRuleBytes(items.map(({ text }) => text)) <= MAX_PROMPT_RULE_BYTES;
  if (!fits(selected)) {
    throw new Error('General rules exceed the prompt budget (8 rules / 2000 bytes). Shorten them or add task conditions with --rules --when <topic>. No rules were silently dropped.');
  }
  // Prefer project preferences and newer rules when the optional task budget fills.
  const specific = candidates.filter(({ general }) => !general).sort((a, b) =>
    Number(b.scope === 'project') - Number(a.scope === 'project') || b.index - a.index);
  for (const candidate of specific) {
    if (fits([...selected, candidate])) selected.push(candidate);
    else skipped.push({ ...candidate, reason: 'budget' });
  }
  selected.sort((a, b) => Number(a.scope === 'project') - Number(b.scope === 'project') || a.index - b.index);
  const rules = selected.map(({ text }) => text);
  return { rules, selected, skipped, topics, bytes: promptRuleBytes(rules) };
}
