/** A model reissued under a new name keeps its weights: the manifest changes, the shards do not. Its catalog
 * entry lists what it replaces (`supersedes`: the earlier ID and identity), so an earlier name still selects
 * the model and a weights directory filled under the earlier identity is adopted instead of refused. */
export const supersededIds = model => (model?.supersedes ?? []).map(row => row.id);
export const supersededIdentities = model => (model?.supersedes ?? []).map(row => row.identity);
/** The catalog model with this ID, or the one that replaced it. */
export const findCatalogModel = (models, id) => models.find(model => model.id === id)
  ?? models.find(model => supersededIds(model).includes(id));
