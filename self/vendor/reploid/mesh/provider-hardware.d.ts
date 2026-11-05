export type ProviderHardware = Partial<Record<'vendor' | 'architecture' | 'device' | 'description', string>>;
export function publicProviderHardware(value: unknown): ProviderHardware | null;
