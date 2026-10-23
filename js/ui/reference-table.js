import { CHANNELS } from "../domain/values.js";
import { referencePrintPages } from "../domain/reference-table.js";
import { formatInput } from "./formatters.js";
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const names = { C: "시안", M: "마젠타", Y: "옐로", K: "블랙" };
function sheetTable(rows, version, print = false) {
  return `<table class="reference-table"><thead><tr><th scope="col">목표 (%)</th>${CHANNELS.map((c) => `<th scope="col" class="reference-${c.toLowerCase()}"><span class="reference-letter">${c}</span>${!print ? ` ${names[c]}<small>${version.tables[c] ? "보정 입력 (%)" : "미보정 · 원본 통과"}</small>` : version.tables[c] ? "" : "<small>미보정</small>"}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr class="${r.target % 10 === 0 ? "reference-major" : ""}"><th scope="row">${formatInput(r.target, version.settings, true)}</th>${r.channels.map((c) => `<td class="${c.applied ? "reference-applied" : "reference-passthrough"}">${formatInput(c.output, version.settings)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}
export function renderReferenceTable(project, version, rows, step, reason) {
  const state = reason ? "참고용 · 현재 적용 불가" : "확정 · 사용 가능";
  const settings = version.settings;
  const metadata = () =>
    `<div class="reference-heading"><h2>CMYK 보정 조견표</h2><strong class="reference-status ${reason ? "reference-warning" : ""}">${state}</strong></div>${reason ? `<p class="reference-caution">${esc(reason)}</p>` : ""}`;
  const custom = ![1, 2, 5, 10].includes(step),
    pages = referencePrintPages(rows);
  return `<section class="card lookup-sheet">
 <form id="reference-settings" class="toolbar no-print"><label for="reference-step">조견표 간격 <select id="reference-step">${[1, 2, 5, 10].map((n) => `<option value="${n}" ${n === step ? "selected" : ""}>${n}%</option>`).join("")}<option value="custom" ${custom ? "selected" : ""}>사용자 지정</option></select></label><label id="reference-custom-label" ${custom ? "" : "hidden"}>간격 (%) <input id="reference-custom" type="number" min="${settings.integer ? 1 : 0.1}" max="100" step="${settings.integer ? 1 : "any"}" value="${step}" required></label><button type="submit">적용</button><button type="button" id="print-reference">조견표 인쇄</button><button type="button" id="export-reference">조견표 CSV</button></form>
 <div id="reference-error" role="alert"></div>
 <div class="reference-screen">${metadata()}<div class="table-wrap">${sheetTable(rows, version)}</div></div>
 <div class="reference-print" aria-hidden="true">${pages.map((columns, i) => `<section class="reference-print-page">${metadata()}<div class="reference-print-grid">${columns.map((column) => sheetTable(column, version, true)).join("")}</div><footer><span>${i + 1} / ${pages.length}쪽</span></footer></section>`).join("")}</div>
 </section>`;
}
