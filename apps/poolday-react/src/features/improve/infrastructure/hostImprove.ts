// Adapts the host's improve controller (apps/poolday/host/decisions/improve.js) to the Changes page. The work
// session, evolution, swarm and training owners decide everything; this file only reads the lazy host parts, hands
// files to the browser and opens home for a revision.
import * as controllerModule from '../../../../../poolday/host/decisions/improve.js';
import type { DownloadFile, ImproveServices, ImproveSnapshot, TrainingField } from '../domain/improve';

type Controller = {
  readonly getSnapshot: () => ImproveSnapshot;
  readonly subscribe: (listener: () => void) => () => void;
  readonly dispose: () => void;
  readonly select: (id: string) => void;
  readonly setInspectionOpen: (open: boolean) => void;
  readonly revise: (id: string) => void;
  readonly review: (accepted: boolean) => Promise<unknown>;
  readonly artifact: (id: string) => DownloadFile;
  readonly exportRecords: () => DownloadFile;
  readonly decide: (id: string, adopt: boolean) => Promise<void>;
  readonly rollback: (id: string) => Promise<void>;
  readonly exportEvaluation: (id: string) => Promise<DownloadFile>;
  readonly exportOffer: (id: string) => Promise<DownloadFile | null>;
  readonly choosePeer: (id: string, peerId: string) => void;
  readonly sendOffer: (id: string) => Promise<void>;
  readonly importOfferFile: (file: File | null) => Promise<void>;
  readonly previewPeerOffer: (id: string) => Promise<void>;
  readonly dismissPeerOffer: (id: string) => Promise<void>;
  readonly retryOffer: (id: string) => Promise<void>;
  readonly allowOffers: (on: boolean) => void;
  readonly evaluateOffer: () => Promise<void>;
  readonly chooseSamples: (file: File | null) => Promise<void>;
  readonly setTrainingField: (field: TrainingField, value: unknown) => void;
  readonly trainHere: () => Promise<void>;
  readonly trainPooled: () => Promise<void>;
  readonly stopTraining: () => Promise<void>;
  readonly connectTraining: () => Promise<void>;
  readonly contributeRound: () => Promise<void>;
  readonly adapterFile: (kind: 'manifest' | 'weights') => DownloadFile | null;
};

const { createImproveController } = controllerModule as unknown as { readonly createImproveController: (ports: object) => Controller };

/** Saves a file through the browser. */
export function download(file: DownloadFile | null) {
  if (!file) return;
  const url = URL.createObjectURL(new Blob([file.text as BlobPart], { type: file.type }));
  const link = document.createElement('a');
  link.href = url; link.download = file.name;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

type Host = { readonly work?: object; readonly evolution?: object; readonly swarm?: object; readonly training?: object };

/** Reads a lazy host part; a host closed or without that part shows the page without it. */
const part = (host: Host, name: keyof Host): object | null => {
  try {
    return host[name] ?? null;
  } catch {
    return null;
  }
};

export function createImproveServices(product: { readonly host: object }): ImproveServices {
  const host = product.host as Host;
  const controller = createImproveController({ work: part(host, 'work'), evolution: part(host, 'evolution'), swarm: part(host, 'swarm'), training: part(host, 'training') });
  const quiet = (pending: Promise<unknown>) => void pending.catch(() => undefined);
  return {
    getSnapshot: controller.getSnapshot,
    subscribe: controller.subscribe,
    dispose: controller.dispose,
    select: controller.select,
    setInspectionOpen: controller.setInspectionOpen,
    revise(id) {
      controller.revise(id);
      // Tasks are written on home; the revision's draft waits there.
      const url = new URL('/', window.location.href);
      for (const [key, value] of new URL(window.location.href).searchParams) url.searchParams.set(key, value);
      window.location.assign(url.pathname + url.search);
    },
    review: (accepted) => quiet(controller.review(accepted)),
    downloadArtifact: (id) => download(controller.artifact(id)),
    exportRecords: () => download(controller.exportRecords()),
    decide: (id, adopt) => quiet(controller.decide(id, adopt)),
    rollback: (id) => quiet(controller.rollback(id)),
    exportEvaluation: (id) => quiet(controller.exportEvaluation(id).then(download)),
    exportOffer: (id) => quiet(controller.exportOffer(id).then(download)),
    choosePeer: controller.choosePeer,
    sendOffer: (id) => quiet(controller.sendOffer(id)),
    importOfferFile: (file) => quiet(controller.importOfferFile(file)),
    previewPeerOffer: (id) => quiet(controller.previewPeerOffer(id)),
    dismissPeerOffer: (id) => quiet(controller.dismissPeerOffer(id)),
    retryOffer: (id) => quiet(controller.retryOffer(id)),
    allowOffers: controller.allowOffers,
    evaluateOffer: () => quiet(controller.evaluateOffer()),
    chooseSamples: (file) => quiet(controller.chooseSamples(file)),
    setTrainingField: controller.setTrainingField,
    trainHere: () => quiet(controller.trainHere()),
    trainPooled: () => quiet(controller.trainPooled()),
    stopTraining: () => quiet(controller.stopTraining()),
    connectTraining: () => quiet(controller.connectTraining()),
    contributeRound: () => quiet(controller.contributeRound()),
    downloadAdapter: (kind) => download(controller.adapterFile(kind)),
  };
}
