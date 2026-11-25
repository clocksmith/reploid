import { Disclosure, Facts } from '@reploid/poolday-ui';
import type { Receipt as ReceiptRecord } from '../domain/chat';
import { strings } from '../../../l10n/strings';

const t = strings.chat;

/** Where and how one answer ran, folded under the answer. */
export function Receipt({ receipt, defaultOpen = false }: { readonly receipt: ReceiptRecord; readonly defaultOpen?: boolean }) {
  return (
    <Disclosure quiet defaultOpen={defaultOpen} summary={t.receipt} status={`${receipt.computer} · ${receipt.duration}`} data={{ 'data-receipt': true }}>
      <Facts
        items={[
          [t.receiptComputer, receipt.computer],
          [t.receiptModel, receipt.model],
          [t.receiptReadBy, receipt.readBy],
          [t.receiptDuration, receipt.duration],
          [t.receiptTokens, receipt.tokens],
          [t.receiptSettlement, receipt.settlement],
        ]}
      />
    </Disclosure>
  );
}
