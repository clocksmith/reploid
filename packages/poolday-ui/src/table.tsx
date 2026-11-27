import type { ReactNode } from 'react';
import { dataProps, type DataAttributes } from './internal.js';

/**
 * Rows of recorded values under labelled columns: small text, label headers, hairline rows. `label` names the table
 * for assistive technology; the first cell of a row can name that row.
 */
export function DataTable({
  label,
  columns,
  rows,
  rowHeaders = false,
  data,
}: {
  readonly label: string;
  readonly columns: ReadonlyArray<string>;
  readonly rows: ReadonlyArray<ReadonlyArray<ReactNode>>;
  /** The first cell of each row names it. */
  readonly rowHeaders?: boolean;
  readonly data?: DataAttributes;
}) {
  return (
    <div className="pool-table" {...dataProps(data)}>
      <table aria-label={label}>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column} scope="col">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {row.map((cell, column) =>
                rowHeaders && column === 0 ? (
                  <th key={column} scope="row">
                    {cell}
                  </th>
                ) : (
                  <td key={column}>{cell}</td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
