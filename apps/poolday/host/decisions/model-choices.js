/**
 * The model list of the "Answer on" sheet as records: groups in their fixed order, one row per exact model and
 * adapter variant, each with its title, one status line and its serving-computer count. The same projection the
 * vanilla sheet renders (ui/components/model-select.js bindModelChoices), without markup, so the React sheet and
 * the vanilla one list, group and word every model identically. Selection and execution stay with the caller.
 */
import {
  modelVariants, modelFamilies, modelChoiceGroups, modelVariantLabel, modelSelectionLabel, modelFacts, modelServingComputers,
  choiceStatus, availabilityLabel, computerCountLabel, ownGroup
} from '../../ui/components/model-select.js';
import { modelKey } from './model-state.js';


/**
 * `value` is the selected selection id. Options mirror bindModelChoices.update: `grouped`, `preferNetwork`,
 * `variants`, `compact`, `location`, `describe(model)` returning { status, facts, note }, and `keep`, which maps group
 * ids to the line an empty group shows. `inspectable` marks that a row can open the computers serving it.
 */
export function projectModelChoices(models, { value = null, grouped = false, preferNetwork = true, variants = false, describe = null,
  compact = false, location = 'auto', keep = {}, inspectable = false, disabled = false } = {}) {
  const entries = variants ? modelVariants(models, { value, preferNetwork })
    : models.map(model => ({ key: modelKey(model), model, ids: [modelKey(model)], value: modelKey(model) }));
  const families = variants && !compact ? modelFamilies(entries)
    : entries.map(entry => ({ base: entry, adapters: [], members: [entry], lead: entry.model }));
  const byLead = new Map(families.map(family => [family.lead, family]));
  const sections = grouped ? modelChoiceGroups(families.map(family => family.lead), { preferNetwork, location, keep: Object.keys(keep) })
    : [{ id: 'all', label: '', models: families.map(family => family.lead) }];
  return sections.map(section => {
    // Models nobody can run right now stay listed, folded under their count, so the usable ones lead.
    const folded = grouped && /unavailable$/.test(section.id);
    const rows = section.models.flatMap(lead => byLead.get(lead).members.map(entry => {
      const nested = byLead.get(lead).base !== entry;
      const model = entry.routes?.find(route => modelKey(route) === entry.value) || entry.model;
      const described = describe?.(model) || {};
      const statusGroup = ownGroup(model, preferNetwork, location);
      const status = described.status ?? (grouped ? choiceStatus(model, statusGroup, !inspectable) : availabilityLabel(model));
      const count = statusGroup === 'shared' && !model.fleet ? modelServingComputers(model) : 0;
      return {
        key: entry.key, value: entry.value, ids: entry.ids, nested,
        title: variants ? modelVariantLabel(model) : modelSelectionLabel(model),
        status: inspectable && count ? `${status} · ${computerCountLabel(count)}` : status,
        facts: compact ? '' : described.facts ?? modelFacts(model),
        note: compact ? '' : described.note || '',
        checked: entry.ids.includes(value),
        disabled,
        // The computers serving this whole model, when there are any to show.
        providers: inspectable && count ? { count, label: `View ${computerCountLabel(count)} serving ${modelVariantLabel(model)}` } : null
      };
    }));
    return {
      id: section.id,
      label: folded ? `${section.label} · ${section.models.length}` : section.label,
      folded,
      // Never fold away the current choice, and never leave the list looking empty.
      open: !folded || sections.length === 1 || rows.some(row => row.checked),
      empty: rows.length ? '' : keep[section.id] || '',
      rows
    };
  });
}
