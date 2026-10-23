import { referencePrintPages } from "../domain/reference-table.js";
import { formatInput } from "./formatters.js";

const names = { C: "시안", M: "마젠타", Y: "옐로", K: "블랙" };
export function renderGuidePrint(channel, rows, settings, second) {
  const pages = referencePrintPages(rows);
  return `<div class="guide-print reference-print" aria-hidden="true">${pages
    .map(
      (columns) => `
    <section class="reference-print-page">
      <div class="reference-heading"><h2>${channel} ${names[channel]} · ${second ? "2차" : "1차"} 패치 제작</h2></div>
      <div class="reference-print-grid">${columns
        .map(
          (column) => `
        <div class="guide-print-table" role="table" aria-label="${channel} 목표값과 제작값">
          <div role="rowgroup" class="guide-print-head"><div role="row"><span role="columnheader">목표값 (%)</span><span role="columnheader">${channel} 제작값 (%)</span></div></div>
          <div role="rowgroup">${column.map((r) => `<div role="row" class="${r.target % 10 === 0 ? "guide-print-major" : ""}"><span role="cell">${formatInput(r.target, settings, true)}</span><strong role="cell">${formatInput(r.production, settings, !second)}</strong></div>`).join("")}</div>
        </div>`,
        )
        .join("")}</div>
    </section>`,
    )
    .join("")}</div>`;
}
