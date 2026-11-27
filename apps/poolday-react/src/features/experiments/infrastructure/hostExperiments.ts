// Adapts the host's experiments controller (apps/poolday/host/decisions/experiments.js) to the Experiments page.
// The research plugin session owns the study; this file supplies this browser's storage and locks and saves the
// exported record.
import * as controllerModule from '../../../../../poolday/host/decisions/experiments.js';
import type { ExperimentsServices, ExperimentsSnapshot, Judgment } from '../domain/experiments';

type File = { readonly name: string; readonly text: string; readonly type: string };
type Controller = Omit<ExperimentsServices, 'exportRecord' | 'setJudgment'> & {
  readonly setJudgment: (choice: Judgment) => void;
  readonly exportRecord: () => File;
  readonly getSnapshot: () => ExperimentsSnapshot;
};

const { createExperimentsController } = controllerModule as unknown as {
  readonly createExperimentsController: (host: object, options: object) => Controller;
};

const save = (file: File) => {
  const url = URL.createObjectURL(new Blob([file.text], { type: file.type }));
  const link = document.createElement('a');
  link.href = url; link.download = file.name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const safeStorage = (): Storage | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

export function createExperimentsServices(product: { readonly host: object }): ExperimentsServices {
  const controller = createExperimentsController(product.host, { storage: safeStorage(), locks: navigator.locks });
  return { ...controller, exportRecord: () => save(controller.exportRecord()) };
}
