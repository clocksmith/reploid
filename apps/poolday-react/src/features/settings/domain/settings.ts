/** View record for Settings. Persistence and permission effects stay with the host. */
export type Appearance = 'system' | 'light' | 'dark';
export type Recipients = 'anyone' | 'own-devices';

export type StoredModel = { readonly id: string; readonly name: string; readonly size: string };

export type SettingsState = {
  readonly appearance: Appearance;
  readonly networkAnswers: boolean;
  readonly webSearch: boolean;
  readonly recipients: Recipients;
  readonly storedModels: ReadonlyArray<StoredModel>;
  readonly storageUsed: string;
};
