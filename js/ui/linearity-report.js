import { patchId } from "../domain/values.js";
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const fmt = (v) => (Number.isFinite(v) ? v.toFixed(2) : "—");
const names = { C: "시안", M: "마젠타", Y: "옐로", K: "블랙" };
const badge = (c) => `<span class="channel ${c.toLowerCase()}">${c}</span>`;
const cellTable = (headers, rows) =>
  `<div class="table-wrap"><table><thead><tr>${headers.map((h) => `<th scope="col">${h}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((v) => `<td>${v}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
const review = (c, t, label = patchId(c, t)) =>
  `<button type="button" class="report-patch-link" data-review-channel="${c}" data-review-target="${t}">${esc(label)}</button>`;
export function renderLinearityReport(project, report, channel, transition) {
  const r = report.channels.find((r) => r.channel === channel);
  return `<div class="linearity-report">
  <section class="card"><div class="card-head"><div><h2>1차 원본 선형도 진단</h2><p class="muted">${esc(project.meta.name)} · ${project.settings.step}% 증분 · ${report.completed} / ${report.totalPatches}패치 입력 · ${report.versionNumber ? `보정 V${report.versionNumber} 준비됨` : "보정 버전은 진행 시 저장"}</p></div><span class="badge warning">${report.hasSecondData ? "원본 진단 · 2차 결과는 최종 결과에서 확인" : "2차 측정 전 · 개선 효과 미검증"}</span></div>
  <p>이 리포트는 <strong>원본 측정값의 비선형도</strong>와 예상 보정 입력값을 보여줍니다. 보정 후 출력이 개선됐는지는 2차 측정으로 확인해야 합니다.</p>
  ${cellTable(
    [
      "채널",
      "입력 완료",
      "평균 절대 오차 (%p)",
      "최대 절대 오차 (%p)",
      "검토 구간",
      "추가 중복 패치",
      "상태",
    ],
    report.channels.map((x) => [
      `<button type="button" data-channel="${x.channel}" aria-label="${x.channel} 채널 리포트 보기">${badge(x.channel)} ${names[x.channel]}</button>`,
      `${x.completed} / ${x.total}`,
      fmt(x.meanError),
      fmt(x.maxError),
      x.ready ? x.reviewIntervals : "—",
      x.ready ? x.duplicateExtras : "—",
      x.error ? esc(x.error) : x.anomalies.length ? "재측정 검토" : "계산 가능",
    ]),
  )}
  <p class="muted">계조는 1차 종이색 대비 ΔE76을 100% 패치 색차로 나눈 값입니다. 오차는 목표 계조와의 차이이며, 평균에는 끝점을 포함합니다. 자동 품질 합격 판정이나 ISO 표준 선형도 등급이 아닙니다.</p></section>
  <section class="card"><h2>${badge(channel)} ${names[channel]} 채널 진단</h2>
   ${r.error ? `<div class="notice warning">${esc(r.error)} 입력표에서 측정값을 확인하세요.</div>` : ""}
   <div class="metrics"><div class="metric"><span>평균 절대 계조 오차</span><strong id="report-mean">${fmt(r.meanError)}</strong><span>%p</span></div><div class="metric"><span>최대 절대 계조 오차</span><strong id="report-max">${fmt(r.maxError)}</strong><span>%p</span></div><div class="metric"><span>검토할 구간</span><strong>${r.ready ? r.reviewIntervals : "—"}</strong><span>역전·평탄·급변·최대 농도 초과</span></div><div class="metric"><span>반올림으로 추가 중복</span><strong id="report-duplicates">${r.ready ? r.duplicateExtras : "—"}</strong><span>${r.ready ? `${r.duplicateGroups.length}종의 제작값에서 발생` : "보정값 계산 후 확인"}</span></div></div>
   ${r.ready ? `<div class="report-charts"><div class="chart-panel"><h3>원본 계조와 이상적인 직선</h3><div class="legend"><span style="--legend:#a4adbc">이상적인 선형 계조</span><span style="--legend:#4964d9">1차 원본 측정</span></div><canvas id="chart-linearity" role="img" aria-label="원본 정규화 계조와 이상 직선 비교. 수치는 아래 계조 표에서 확인하세요."></canvas></div><div class="chart-panel"><h3>예상 보정 입력 곡선</h3><div class="legend"><span style="--legend:#4964d9">내부 계산값</span><span style="--legend:#df7d3a">제작용 반올림값</span></div><canvas id="chart-preview" role="img" aria-label="목표 계조별 예상 보정 입력값. 아직 2차 출력 개선을 검증한 곡선이 아닙니다."></canvas></div></div>` : ""}
   <div class="toolbar no-print"><button id="export-report">리포트 CSV</button><button id="print-report">리포트 인쇄</button></div>
  </section>
  <section class="card"><h2>측정값을 확인할 구간</h2><p class="muted">역전: 계조가 0.1%p 초과 감소 · 평탄: 변화량 절댓값 0.1%p 이하 · 급변: 입력 변화량의 3배 초과 증가 · 최대 농도 초과: 정규화 계조 100.1% 초과. 재측정을 돕는 검토 기준이며 측정 오류를 확정하는 기준은 아닙니다. 한 구간에 여러 검토 항목이 표시될 수 있습니다.</p>
  ${
    r.anomalies.length
      ? cellTable(
          [
            "유형",
            "입력 구간 (%)",
            "계조 변화 (%p)",
            "시작 패치 확인",
            "끝 패치 확인",
          ],
          r.anomalies.map((a) => [
            a.type,
            `${a.from} → ${a.to}`,
            fmt(a.change),
            review(channel, a.from),
            review(channel, a.to),
          ]),
        )
      : `<p class="muted">${r.ready ? "검토 기준에 해당하는 구간이 없습니다." : "유효한 측정값이 모두 준비되면 검토 구간을 계산합니다."}</p>`
  }
  </section>
  <section class="card"><h2>${project.settings.integer ? "정수" : "소수"} 반올림과 제작값 중복</h2><p class="muted">같은 제작값을 사용하는 목표가 있어도 패치 ID와 측정은 각각 유지합니다. 추가 중복 수는 각 제작값 그룹의 첫 패치를 제외한 개수입니다.</p>
  ${
    r.duplicateGroups.length
      ? cellTable(
          ["같은 제작 입력값 (%)", "해당 목표 계조 (%)", "추가 중복 수"],
          r.duplicateGroups.map((g) => [
            esc(g.production),
            g.targets.map((t) => review(channel, t, `${t}%`)).join(" "),
            g.targets.length - 1,
          ]),
        )
      : `<p class="muted">${r.ready ? "현재 계산된 제작값에 중복이 없습니다." : "유효한 측정값이 모두 준비되면 제작값 중복을 계산합니다."}</p>`
  }</section>
  <section class="card"><h2>원본 계조와 보정 입력값</h2>
  ${cellTable(
    [
      "입력 / 목표 (%)",
      "원본 정규화 계조 (%)",
      "편차 (%p)",
      "내부 보정값 (%)",
      "제작 입력값 (%)",
      "측정 확인",
    ],
    r.points.map((p) => [
      p.target,
      fmt(p.tone),
      fmt(p.error),
      p.internal === null ? "—" : esc(p.internal),
      p.production === null ? "—" : esc(p.production),
      review(channel, p.target),
    ]),
  )}
  <details id="report-lab-details"><summary>원본 Lab값과 L* · a* · b* 그래프</summary><div class="chart-grid">${["L", "a", "b"].map((f) => `<div class="chart-panel"><h3>${f}*</h3><canvas id="chart-${f}" role="img" aria-label="1차 원본 ${f}* 그래프"></canvas></div>`).join("")}</div>
  ${cellTable(
    ["패치 ID", "입력 (%)", "L*", "a*", "b*"],
    r.points.map((p) => [
      patchId(channel, p.target),
      p.target,
      ...["L", "a", "b"].map((f) => esc(p.lab?.[f] ?? "미입력")),
    ]),
  )}</details></section>
  <div id="second-preparation">${transition}</div>
 </div>`;
}
