import {
  CHANNELS,
  META,
  createProject,
  record,
  targets,
  key,
  patchId,
  labValid,
  actualValid,
  numeric,
  production,
  firstComplete,
  calculateVersion,
  versionCurrent,
  secondComplete,
  confirmVersion,
  calculatorReason,
  convert,
  comparison,
  validateSettings,
} from "./core.js";
import {
  openDB,
  listProjects,
  putProject,
  deleteProject,
} from "./storage/indexeddb.js";
import { backupText, parseBackup, csv, download } from "./storage/backup.js";
import { drawChart } from "./ui/charts.js";

const routes = [
  ["projects", "프로젝트"],
  ["settings", "측정 설정"],
  ["guide1", "1차 패치 가이드"],
  ["measure1", "1차 측정 입력"],
  ["results1", "1차 측정 결과"],
  ["correction", "보정값 관리"],
  ["guide2", "2차 패치 가이드"],
  ["measure2", "2차 측정 입력"],
  ["final", "최종 결과"],
  ["calculator", "CMYK 보정 계산기"],
];
const $ = (s) => document.querySelector(s);
const content = $("#content");
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const fmt = (value, precision = 2) =>
  numeric(value) ? Number(value).toFixed(precision) : "—";
const prodFmt = (value, s) =>
  numeric(value) ? Number(value).toFixed(s.integer ? 0 : s.precision) : "—";
const date = (value) => new Date(value).toLocaleString("ko-KR");
let projects = [],
  currentId,
  route = "projects",
  queue = Promise.resolve(),
  pending = 0,
  saveError = false,
  timer,
  calcInteger;
const project = () => projects.find((p) => p.id === currentId);
const version = () => {
  const p = project();
  return (
    p?.versions.find((v) => v.id === p.location.versionId) || p?.versions.at(-1)
  );
};
const channel = (second = false) => {
  const p = project(),
    available = second && version() ? version().channels : p.settings.channels;
  return available.includes(p.location.channel)
    ? p.location.channel
    : available[0];
};
function toast(message) {
  clearTimeout(timer);
  $("#toast").textContent = message;
  $("#toast").classList.add("visible");
  timer = setTimeout(() => $("#toast").classList.remove("visible"), 5000);
}
function status(text, error = false) {
  $("#save-status").textContent = text;
  $("#save-status").style.color = error ? "#ffb6c1" : "#b8e5d0";
}
function persist(p = project()) {
  if (!p) return Promise.resolve();
  p.updatedAt = new Date().toISOString();
  const snapshot = structuredClone(p);
  pending++;
  status("저장 중…");
  const task = queue.then(() => putProject(snapshot));
  queue = task.then(
    () => {
      pending--;
      if (!pending && !saveError) status("자동 저장 완료");
    },
    (error) => {
      pending--;
      saveError = true;
      status("저장 실패 · JSON 백업 필요", true);
      toast(`저장 실패: ${error.message}. JSON 백업으로 보관하세요.`);
    },
  );
  return task;
}
function saveSoon(p) {
  persist(p).catch(() => {});
}
window.addEventListener("beforeunload", (e) => {
  if (pending || saveError) {
    e.preventDefault();
    e.returnValue = "";
  }
});
function heading(title, subtitle, step) {
  return `<div class="page-head"><div><p class="eyebrow">${step ? `STEP ${String(step).padStart(2, "0")} / 10` : "CMYK CALIBRATION"}</p><h1>${title}</h1><p class="subtitle">${subtitle}</p></div>${project() ? `<span class="badge">정수값 모드 ${project().settings.integer ? "ON" : "OFF"}</span>` : ""}</div>`;
}
function notice(text, kind = "") {
  return `<div class="notice ${kind}">${text}</div>`;
}
function table(headers, rows) {
  return `<div class="table-wrap"><table><thead><tr>${headers.map((h) => `<th scope="col">${h}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
}
function row(values) {
  return `<tr>${values.map((v) => `<td>${v}</td>`).join("")}</tr>`;
}
function badge(c) {
  return `<span class="channel ${c.toLowerCase()}">${c}</span>`;
}
function empty(text, link, label) {
  return `<div class="card empty"><h2>${text}</h2>${link ? `<a href="#${link}">${label}</a>` : ""}</div>`;
}
function tabs(second = false) {
  const p = project(),
    chs = second ? version().channels : p.settings.channels;
  return `<div class="tabs" aria-label="측정 채널">${chs.map((c) => `<button type="button" data-channel="${c}" aria-pressed="${c === channel(second)}">${badge(c)} 채널</button>`).join("")}</div>`;
}
function versionToolbar() {
  const p = project();
  return `<div class="toolbar no-print"><label>보정 버전 <select class="version-select" id="version-select">${p.versions.map((v) => `<option value="${esc(v.id)}" ${v.id === version()?.id ? "selected" : ""}>V${v.number} · ${v.channels.join("/")} · ${v.confirmedAt ? "확정" : "검증 중"}${versionCurrent(p, v) ? "" : " · 현재 설정 불일치"}</option>`).join("")}</select></label></div>`;
}
function versionNotice(v) {
  const p = project();
  return `${!versionCurrent(p, v) ? notice("현재 설정 또는 1차 데이터가 이 버전과 다릅니다. 아래는 보존된 과거 버전입니다. 실제 적용하려면 보정값 관리에서 새 버전을 만드세요.", "warning") : ""}${v.confirmedAt ? notice(`V${v.number} 확정 · ${date(v.confirmedAt)}. 확정 버전의 제작값·측정값은 잠겨 있습니다. 수정은 새 버전에서 진행하세요.`) : ""}`;
}
function sidebar() {
  const p = project();
  try {
    if (currentId) localStorage.setItem("color-cal-current", currentId);
    else localStorage.removeItem("color-cal-current");
  } catch {}
  $("#project-select").innerHTML = projects.length
    ? projects
        .map(
          (p) =>
            `<option value="${esc(p.id)}" ${p.id === currentId ? "selected" : ""}>${esc(p.meta.name)}</option>`,
        )
        .join("")
    : "<option>프로젝트 없음</option>";
  $("#active-project").textContent = p?.meta.name || "";
  $("#project-meta").textContent = p
    ? `${p.settings.channels.join(" · ")} / ${p.settings.step}% / 정수 ${p.settings.integer ? "ON" : "OFF"}`
    : "프로젝트를 생성해 시작하세요.";
  $("#navigation").innerHTML = routes
    .map(
      ([id, label], i) =>
        `<a href="#${id}" class="${route === id ? "active" : ""}" ${route === id ? 'aria-current="page"' : ""}><b>${String(i + 1).padStart(2, "0")}</b>${label}</a>`,
    )
    .join("");
  $("#backup").disabled = !p;
}
function render() {
  sidebar();
  const p = project();
  if (!p && route !== "projects") {
    content.innerHTML =
      heading(
        routes.find((r) => r[0] === route)?.[1] || "프로젝트",
        "먼저 프로젝트를 만들어 주세요.",
      ) + empty("진행할 프로젝트가 없습니다.", "projects", "프로젝트 만들기");
    return;
  }
  const pages = {
    projects: projectsPage,
    settings: settingsPage,
    guide1: () => guidePage(false),
    measure1: () => measurePage(false),
    results1: resultsPage,
    correction: correctionPage,
    guide2: () => guidePage(true),
    measure2: () => measurePage(true),
    final: finalPage,
    calculator: calculatorPage,
  };
  content.innerHTML = (pages[route] || projectsPage)();
  bindPage();
  requestAnimationFrame(() => {
    charts();
    if (route === "measure1" || route === "measure2") {
      const cell = document.getElementById(p.location.cell);
      if (cell && !cell.disabled) cell.focus();
    }
  });
}
function navigate() {
  route = location.hash.slice(1).split("?")[0] || "projects";
  if (!routes.some(([id]) => id === route)) route = "projects";
  const p = project();
  if (p) {
    p.location.route = route;
    saveSoon(p);
  }
  calcInteger = undefined;
  render();
}
function projectFields(p) {
  return Object.entries(META)
    .map(
      ([k, label]) =>
        `<label class="field ${k === "notes" ? "full" : ""}">${label}${k === "name" ? " *" : ""}${k === "notes" ? `<textarea name="${k}" maxlength="20000">${esc(p.meta[k])}</textarea>` : `<input name="${k}" value="${esc(p.meta[k])}" ${k === "name" ? "required" : ""} maxlength="${k === "name" ? 200 : 2000}">`}</label>`,
    )
    .join("");
}
function projectsPage() {
  const p = project();
  return (
    heading(
      "프로젝트",
      "출력 조건을 기록하고, 측정부터 보정 검증까지 한곳에서 관리하세요.",
      1,
    ) +
    `<div class="toolbar"><button class="primary" id="new-project">+ 새 프로젝트</button></div><div class="project-list">${projects.map((item) => `<article class="card project-card"><div class="card-head"><span class="badge ${item.id === currentId ? "success" : ""}">${item.id === currentId ? "현재 프로젝트" : "프로젝트"}</span><span class="muted">${item.settings.step}% 증분</span></div><h3>${esc(item.meta.name)}</h3><p class="muted">${esc(item.meta.printer || "장비 미설정")}<br>${esc(item.meta.paper || "용지 미설정")} · ${item.settings.channels.join(" / ")}<br>최근 저장 ${date(item.updatedAt)}</p><button data-open="${esc(item.id)}">프로젝트 열기</button></article>`).join("")}</div>${
      p
        ? `<section class="card" style="margin-top:24px"><h2>프로젝트 정보</h2><form id="project-form"><div class="grid">${projectFields(p)}</div><div class="toolbar"><button class="primary" type="submit">정보 저장</button><button type="button" id="duplicate-project">복제</button><button type="button" class="danger" id="delete-project">프로젝트 삭제</button></div></form></section><section class="card"><h2>작업 이력</h2><ol class="history">${p.history
            .slice()
            .reverse()
            .map((h) => `<li>${date(h.at)} · ${esc(h.action)}</li>`)
            .join("")}</ol></section>`
        : empty("첫 캘리브레이션을 시작하세요.")
    } `
  );
}
function settingsPage() {
  const p = project(),
    s = p.settings,
    ts = targets(s);
  return (
    heading(
      "측정 설정",
      "사용할 채널과 패치 간격을 정하세요. 각 채널은 다른 세 채널을 0%로 고정해 측정합니다.",
      2,
    ) +
    `<div class="metrics"><div class="metric"><span>선택 채널</span><strong>${s.channels.length}</strong><span>${s.channels.join(" · ")}</span></div><div class="metric"><span>채널당 패치</span><strong>${ts.length}</strong><span>0%와 100% 포함</span></div><div class="metric"><span>전체 패치</span><strong>${ts.length * s.channels.length}</strong><span>측정 단계별</span></div><div class="metric"><span>제작값 형식</span><strong>${s.integer ? "정수" : "소수"}</strong><span>내부 계산 정밀도 보존</span></div></div><section class="card"><h2>채널 및 정밀도</h2><form id="settings-form"><div class="channel-checks">${CHANNELS.map((c) => `<label class="check"><input type="checkbox" name="channels" value="${c}" ${s.channels.includes(c) ? "checked" : ""}>${badge(c)}</label>`).join("")}</div><div class="grid"><label class="field">패치 증분<select id="step-preset"><option value="custom">사용자 지정</option>${[1, 2, 5, 10].map((n) => `<option value="${n}" ${s.step === n ? "selected" : ""}>${n}%</option>`).join("")}</select></label><label class="field">사용자 지정 증분 (%)<input type="number" name="step" min="0.1" max="100" step="any" value="${s.step}" required></label><label class="field">소수 모드 제작 정밀도<select name="precision">${[0, 1, 2, 3, 4].map((n) => `<option value="${n}" ${s.precision === n ? "selected" : ""}>소수점 ${n}자리</option>`).join("")}</select></label><label class="check"><input type="checkbox" name="integer" ${s.integer ? "checked" : ""}>정수값 모드 (Integer CMYK Mode)</label></div>${notice("설정을 바꿔도 이전 1차 원본과 버전별 2차 데이터는 보존됩니다. 기존 버전의 제작값·검증 결과는 다시 계산하지 않습니다. 새 설정은 새 보정 버전을 만들어 제작·측정한 뒤 적용하세요.", "warning")}<button class="primary" type="submit">측정 설정 저장</button></form></section><a href="#guide1">다음: 1차 패치 제작 가이드 →</a>`
  );
}
function guidePage(second) {
  const p = project(),
    v = version();
  if (second && !v)
    return (
      heading("2차 패치 가이드", "보정값을 계산한 후 제작할 수 있습니다.", 7) +
      empty("보정 테이블이 없습니다.", "correction", "보정값 계산하기")
    );
  const c = channel(second),
    s = second ? v.settings : p.settings,
    ts = second
      ? v.tables[c]
      : targets(s).map((t) => ({ target: t, production: t, internal: t }));
  return (
    heading(
      `${second ? "2차 보정" : "1차"} 패치 제작 가이드`,
      "아래 수치로 그래픽 프로그램에서 직접 패치를 제작하세요. 패치 이미지나 PDF 파일은 생성하지 않습니다.",
      second ? 7 : 3,
    ) +
    (second ? versionToolbar() + versionNotice(v) : "") +
    tabs(second) +
    `<section class="card"><div class="card-head"><div><h2>${badge(c)} ${second ? "보정 패치" : "기본 패치"} 목록 ${second ? `· V${v.number}` : ""}</h2><span class="muted">채널당 ${ts.length}개 · 전체 ${(second ? v.channels : s.channels).length * ts.length}개 · ${s.integer ? "정수" : "소수"} 제작값</span></div><span class="badge">${second ? "2차" : "1차"} 제작</span></div>${notice("용지·잉크·출력 해상도·RIP 및 측색 조건을 두 측정에서 동일하게 유지하세요. 패치 ID와 측정 순서를 함께 기록하고, 충분히 건조한 뒤 측정하세요.")}<div class="toolbar no-print"><button id="copy-guide">제작값 복사</button><button id="print-guide">현재 채널 가이드 인쇄</button><a href="#${second ? "measure2" : "measure1"}">측정값 입력 →</a></div>${table(
      [
        "순서",
        "패치 ID",
        ...(second ? ["목표 계조", "내부 계산값"] : []),
        "C (%)",
        "M (%)",
        "Y (%)",
        "K (%)",
        ...(second ? ["실제 제작 입력값 (%)"] : []),
      ],
      ts.map((r, i) => {
        const actual = v?.second[key(c, r.target)]?.actual;
        return row([
          i + 1,
          patchId(c, r.target, second ? 2 : 1, v?.number),
          ...(second ? [`${r.target}%`, fmt(r.internal, 8)] : []),
          ...CHANNELS.map((ch) => prodFmt(ch === c ? r.production : 0, s)),
          ...(second
            ? [
                actualValid(actual, s)
                  ? prodFmt(actual, s)
                  : "미기록 또는 유효하지 않음 · 2차 입력에서 기록",
              ]
            : []),
        ]);
      }),
    )}</section>`
  );
}
function inputCell(field, value, id, c, t, second, disabled) {
  const valid =
    value === "" || value === undefined || value === null
      ? true
      : field === "actual"
        ? actualValid(value, version().settings)
        : numeric(value) &&
          (field !== "L" || (Number(value) >= 0 && Number(value) <= 100));
  const msg =
    field === "L"
      ? "L*: 0~100"
      : field === "actual"
        ? `${version().settings.integer ? "정수 " : ""}0~100%`
        : "유효한 숫자를 입력하세요";
  return `<input id="${id}-${field}" data-measure="${field}" data-target="${t}" data-channel="${c}" data-second="${second}" aria-label="${id} ${field === "actual" ? "실제 제작 입력값" : field + "*"}" type="number" value="${esc(value)}" step="${field === "actual" && version()?.settings.integer ? "1" : "any"}" ${field === "L" || field === "actual" ? 'min="0" max="100"' : ""} ${disabled ? "disabled" : ""} aria-invalid="${!valid}" aria-describedby="${id}-${field}-error"><span class="cell-error" id="${id}-${field}-error" ${valid ? "hidden" : ""}>${msg}</span>`;
}
function measurePage(second) {
  const p = project(),
    v = version();
  if (second && !v)
    return (
      heading("2차 측정 입력", "적용할 보정 버전이 필요합니다.", 8) +
      empty(
        "보정 테이블을 먼저 생성하세요.",
        "correction",
        "보정값 관리로 이동",
      )
    );
  const c = channel(second),
    s = second ? v.settings : p.settings,
    ts = second ? v.tables[c].map((r) => r.target) : targets(s),
    data = second ? v.second : p.first;
  const done = ts.filter(
    (t) =>
      labValid(data[key(c, t)]) &&
      (!second || actualValid(data[key(c, t)]?.actual, s)),
  ).length;
  return (
    heading(
      `${second ? "2차" : "1차"} 측정 입력`,
      "측색계의 Lab값을 입력하세요. 변경 사항은 자동 저장됩니다. Tab / Enter로 다음 셀로 이동합니다.",
      second ? 8 : 4,
    ) +
    (second ? versionToolbar() + versionNotice(v) : "") +
    tabs(second) +
    `<section class="card"><div class="card-head"><h2>${badge(c)} Lab 수동 입력 ${second ? `· V${v.number}` : ""}</h2><span id="completion" class="badge">${done} / ${ts.length} 완료 (${Math.round((done / ts.length) * 100)}%)</span></div><div class="progress"><span id="progress-bar" style="width:${(done / ts.length) * 100}%"></span></div><p class="muted">${second ? "실제 제작 입력값은 자동 추정하지 않습니다. 실제 사용한 값을 반드시 기록하세요. 정수 중복 패치도 각각 측정합니다." : "각 패치의 활성 채널 수치는 표의 입력값이며, 나머지 CMYK 채널은 모두 0%입니다."} 빈칸은 미입력입니다. L*: 0~100, a*·b*: 유한한 숫자.</p><div class="toolbar"><button id="export-measure">${second ? "2차" : "1차"} 전체 CSV</button><button id="resume-cell">마지막 입력 위치</button></div>${table(
      [
        "패치 ID",
        second ? "목표 계조 (%)" : "실제 CMYK 입력 (%)",
        ...(second ? ["제작 권장값 (%)", "실제 제작값 (%)"] : []),
        "L*",
        "a*",
        "b*",
        "상태",
      ],
      ts.map((t) => {
        const m = data[key(c, t)] || {},
          id = patchId(c, t, second ? 2 : 1, v?.number),
          ready = labValid(m) && (!second || actualValid(m.actual, s));
        return `<tr data-measure-row="${t}">${[id, t, ...(second ? [prodFmt(v.tables[c].find((r) => r.target === t).production, s), inputCell("actual", m.actual, id, c, t, second, v.confirmedAt)] : []), ...["L", "a", "b"].map((f) => inputCell(f, m[f], id, c, t, second, second && v.confirmedAt)), `<span data-row-status class="${ready ? "complete" : "incomplete"}">${ready ? "완료" : "미완료"}</span>`].map((x) => `<td>${x}</td>`).join("")}</tr>`;
      }),
    )}</section><a href="#${second ? "final" : "results1"}">다음: ${second ? "최종 결과 비교" : "1차 결과 확인"} →</a>`
  );
}
function graphPanels(includeCorrection = false) {
  return `<div class="legend"><span style="--legend:#4964d9">1차 측정</span><span style="--legend:#df7d3a">2차 측정</span></div><div class="chart-grid">${["L", "a", "b"].map((f) => `<div class="chart-panel"><h3>${f}* 측정 곡선</h3><canvas id="chart-${f}" role="img" aria-label="목표 계조별 ${f}* 측정 곡선. 수치는 아래 데이터 표에서 확인하세요."></canvas></div>`).join("")}</div>${includeCorrection ? '<div class="chart-panel"><h3>목표 계조 → 보정 입력값</h3><canvas id="chart-correction" role="img" aria-label="보정 입력 곡선. 정확한 값은 아래 표를 확인하세요."></canvas></div>' : ""}`;
}
function resultsPage() {
  const p = project(),
    c = channel(),
    ts = targets(p.settings),
    n = ts.filter((t) => labValid(p.first[key(c, t)])).length;
  return (
    heading(
      "1차 측정 결과",
      "측정 곡선과 원본 데이터를 확인하세요. 보정 계산에는 모든 패치가 필요합니다.",
      5,
    ) +
    tabs() +
    `<section class="card"><h2>${badge(c)} 채널 측정 · ${n} / ${ts.length} 완료</h2>${graphPanels()}${table(
      ["입력 (%)", "L*", "a*", "b*", "상태"],
      ts.map((t) => {
        const m = p.first[key(c, t)];
        return row([
          t,
          ...["L", "a", "b"].map((f) => fmt(m?.[f])),
          labValid(m) ? "완료" : "미완료",
        ]);
      }),
    )}</section><a href="#correction">다음: 보정값 계산 →</a>`
  );
}
function correctionPage() {
  const p = project(),
    v = version();
  return (
    heading(
      "보정값 관리",
      "1차 측정값으로 채널별 보정 테이블을 만들고 버전별 제작값을 보존합니다.",
      6,
    ) +
    `<section class="card"><h2>새 보정 버전 만들기</h2><div class="toolbar"><label>계산 범위 <select id="calculate-channel"><option value="all">선택한 전체 채널</option>${p.settings.channels.map((c) => `<option value="${c}">${c} 채널만</option>`).join("")}</select></label><button class="primary" id="calculate">보정값 계산 · 새 버전 생성</button></div><p class="muted">${p.settings.channels.map((c) => `${c}: ${firstComplete(p, c) ? "입력 완료" : "미입력 있음"}`).join(" / ")}</p><details><summary>보정 알고리즘과 한계</summary><p>종이색(0%)부터 최대 농도(100%)까지의 ΔE*ab (CIE76)를 0~100%로 정규화합니다. 비단조 측정 곡선은 PAVA 단조 회귀로 정리한 뒤, 선형 목표 계조에 역선형 보간합니다. 0%와 100%는 고정하며 평탄 구간의 정확한 목표값은 해당 입력 구간 중점을 사용합니다. 이는 단색 계조용 경험적 보정으로 ISO 농도·SCTV 표준 구현이나 ICC 색상 일치 보장이 아닙니다. 인쇄장비에 실제 적용하기 전에 2차 측정과 작업자 검토가 필요합니다.</p></details></section>${
      v
        ? versionToolbar() +
          versionNotice(v) +
          tabs(true) +
          `<section class="card"><div class="card-head"><h2>V${v.number} · ${badge(channel(true))} 보정 테이블</h2><span class="badge ${v.confirmedAt ? "success" : ""}">${v.confirmedAt ? "확정" : "검증 중"}</span></div><p class="muted">생성: ${date(v.createdAt)} · 버전 정수 모드 ${v.settings.integer ? "ON" : "OFF"}</p>${v.warnings.map((w) => notice(esc(w), "warning")).join("")}<div class="toolbar"><button id="copy-correction">현재 채널 보정값 복사</button><button id="export-correction">보정 테이블 전체 CSV</button><a href="#guide2">2차 패치 제작 →</a></div>${table(
            [
              "목표 계조 (%)",
              "내부 계산값 (원정밀도)",
              "제작용 입력값 (%)",
              "정수 모드",
              "버전",
            ],
            v.tables[channel(true)].map((r) =>
              row([
                r.target,
                String(r.internal),
                prodFmt(r.production, v.settings),
                v.settings.integer ? "ON" : "OFF",
                `V${v.number}`,
              ]),
            ),
          )}</section>`
        : empty("아직 보정 버전이 없습니다.")
    }`
  );
}
function finalPage() {
  const p = project(),
    v = version();
  if (!v)
    return (
      heading("최종 결과", "같은 목표 계조의 1차·2차 측정을 비교합니다.", 9) +
      empty("보정 테이블이 없습니다.", "correction", "보정값 관리")
    );
  const c = channel(true),
    rows = comparison(v, c),
    done = rows.filter((r) => r.after !== null),
    mean = (key) =>
      done.length ? done.reduce((s, r) => s + r[key], 0) / done.length : null;
  return (
    heading(
      "최종 결과",
      "기준은 목표 계조입니다. 1차·2차 Lab와 실제 제작 입력값을 함께 검토하세요.",
      9,
    ) +
    versionToolbar() +
    versionNotice(v) +
    tabs(true) +
    `<div class="metrics"><div class="metric"><span>비교 가능 패치</span><strong>${done.length} / ${rows.length}</strong><span>${c} 채널</span></div><div class="metric"><span>1차 평균 계조 오차</span><strong>${fmt(mean("before"))}</strong><span>%p · 비교 가능 패치 기준</span></div><div class="metric"><span>2차 평균 계조 오차</span><strong>${fmt(mean("after"))}</strong><span>%p · 비교 가능 패치 기준</span></div><div class="metric"><span>개선 패치</span><strong>${rows.filter((r) => r.status === "개선").length}</strong><span>악화 ${rows.filter((r) => r.status === "악화").length} / 동등 ${rows.filter((r) => r.status === "동등").length}</span></div></div><section class="card"><h2>${badge(c)} V${v.number} 측정 결과 비교</h2>${graphPanels(true)}<p class="muted">계조 오차: 종이색 대비 ΔE76 정규화 계조와 목표의 차이(%p). 개선/악화는 절대 오차를 비교한 상대 상태이며 합격 판정이 아닙니다. ΔE76은 종이색–최대 농도의 Lab 직선 목표와 2차 Lab의 차이입니다.</p><div class="toolbar"><button id="export-final">전체 비교표 CSV</button><button class="primary" id="confirm-version" ${v.confirmedAt || !versionCurrent(p, v) || !secondComplete(v) ? "disabled" : ""}>이 보정 버전 확정</button></div>${!secondComplete(v) ? notice("모든 적용 채널의 2차 Lab와 실제 제작 입력값을 기록해야 확정할 수 있습니다.", "warning") : ""}${table(
      [
        "목표 (%)",
        "1차 입력 (%)",
        "1차 L*",
        "1차 a*",
        "1차 b*",
        "내부 보정값",
        "실제 제작값",
        "2차 L*",
        "2차 a*",
        "2차 b*",
        "1차 오차 (%p)",
        "2차 오차 (%p)",
        "ΔE76",
        "상태",
      ],
      rows.map((r) =>
        row([
          r.target,
          r.target,
          ...["L", "a", "b"].map((f) => fmt(r.first[f])),
          String(r.internal),
          actualValid(r.second?.actual, v.settings)
            ? prodFmt(r.second.actual, v.settings)
            : "미기록 / 오류",
          ...["L", "a", "b"].map((f) => fmt(r.second?.[f])),
          fmt(r.before),
          fmt(r.after),
          fmt(r.deltaE),
          r.status,
        ]),
      ),
    )}</section><a href="#calculator">CMYK 보정 계산기 →</a>`
  );
}
function calculatorPage() {
  const p = project(),
    v = version(),
    reason = calculatorReason(p, v);
  calcInteger ??= p.settings.integer;
  return (
    heading(
      "CMYK 보정 계산기",
      "입력한 CMYK를 각 채널의 확정 보정 테이블로 독립 변환합니다.",
      10,
    ) +
    versionToolbar() +
    (reason ? notice(esc(reason), "warning") : "") +
    `<section class="card"><div class="card-head"><div><h2>${esc(p.meta.name)} ${v ? `· V${v.number}` : ""}</h2><p class="muted">${v ? "적용 채널: " + v.channels.join(" / ") : "적용할 버전 없음"} · 미보정 채널은 원본값을 통과시킵니다.</p></div><label class="check"><input type="checkbox" id="calc-integer" ${calcInteger ? "checked" : ""}>정수값 모드</label></div><p class="muted">계산기의 모드는 이번 변환 출력에만 적용됩니다. 저장된 프로젝트 모드와 제작·측정 이력은 변경하지 않습니다.</p><div class="calculator">${CHANNELS.map((c) => `<div class="calc-channel"><label for="calc-${c}">${badge(c)} 원본 입력 (%)</label><input id="calc-${c}" data-calc="${c}" type="number" value="0" min="0" max="100" step="${calcInteger ? "1" : "any"}" ${reason ? "disabled" : ""}><span class="calc-result" id="output-${c}">—</span><span class="calc-internal" id="internal-${c}">내부값 —</span><p class="muted">${v?.tables[c] ? "보정 적용" : "미보정 · 원본 통과"}</p></div>`).join("")}</div><div id="calc-error" role="alert"></div><div class="summary-output" id="calc-summary">${reason ? "보정 적용 대기" : "C 0 / M 0 / Y 0 / K 0"}</div><div class="toolbar"><button id="copy-calculator" ${reason ? "disabled" : ""}>결과 전체 복사</button><button id="copy-calculator-csv" ${reason ? "disabled" : ""}>CSV 형식 복사</button><button id="reset-calculator">입력 초기화</button></div>${notice("혼합색의 Lab값을 예측하거나 색상 일치를 보장하지 않습니다. 개별 단색 채널의 계조 보정값만 제공합니다.")}</section>`
  );
}
async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast("클립보드에 복사했습니다.");
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.top = "0";
    document.body.append(area);
    area.focus();
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    if (!ok) throw Error("복사 권한이 없습니다. CSV 내보내기를 사용하세요.");
    toast("복사했습니다.");
  }
}
function exportFile(rows, name) {
  download(csv(rows), `${name}.csv`, "text/csv;charset=utf-8");
  toast("CSV 파일을 내려받았습니다.");
}
function measurementExport(second) {
  const p = project(),
    v = version(),
    s = second ? v.settings : p.settings,
    chs = second ? v.channels : s.channels;
  const rows = [
    [
      "패치 ID",
      "채널",
      "목표 계조",
      "C",
      "M",
      "Y",
      "K",
      ...(second
        ? [
            "내부 계산값",
            "제작 권장값",
            "실제 제작 입력값",
            "보정 버전",
            "정수 모드",
          ]
        : []),
      "L*",
      "a*",
      "b*",
      "완료",
    ],
  ];
  chs.forEach((c) =>
    (second
      ? v.tables[c]
      : targets(s).map((t) => ({ target: t, production: t }))
    ).forEach((r) => {
      const m = (second ? v.second : p.first)[key(c, r.target)] || {};
      rows.push([
        patchId(c, r.target, second ? 2 : 1, v?.number),
        c,
        r.target,
        ...CHANNELS.map((ch) =>
          ch === c
            ? second
              ? actualValid(m.actual, s)
                ? Number(m.actual)
                : ""
              : r.target
            : 0,
        ),
        ...(second
          ? [
              r.internal,
              r.production,
              actualValid(m.actual, s) ? Number(m.actual) : "",
              v.number,
              s.integer,
            ]
          : []),
        ...["L", "a", "b"].map((f) =>
          numeric(m[f]) ? Number(m[f]) : (m[f] ?? ""),
        ),
        labValid(m) && (!second || actualValid(m.actual, s))
          ? "완료"
          : "미완료",
      ]);
    }),
  );
  exportFile(rows, second ? `2차측정-V${v.number}` : "1차측정");
}
function bind(id, fn, event = "click") {
  const el = $(id);
  if (el)
    el.addEventListener(event, async (e) => {
      try {
        await fn(e);
      } catch (error) {
        toast(error.message);
        console.error(error);
      }
    });
}
function bindPage() {
  document.querySelectorAll("[data-channel]:not(input)").forEach(
    (b) =>
      (b.onclick = () => {
        project().location.channel = b.dataset.channel;
        saveSoon();
        render();
      }),
  );
  document.querySelectorAll("[data-open]").forEach(
    (b) =>
      (b.onclick = () => {
        currentId = b.dataset.open;
        calcInteger = undefined;
        render();
      }),
  );
  bind(
    "#version-select",
    (e) => {
      project().location.versionId = e.target.value;
      calcInteger = undefined;
      saveSoon();
      render();
    },
    "change",
  );
  bind("#new-project", async () => {
    const p = createProject();
    await persist(p);
    projects.push(p);
    currentId = p.id;
    render();
    $("#project-form input").focus();
  });
  bind(
    "#project-form",
    async (e) => {
      e.preventDefault();
      const p = project(),
        data = new FormData(e.target);
      const meta = Object.fromEntries(
        Object.keys(META).map((k) => [k, String(data.get(k) || "").trim()]),
      );
      if (!meta.name) throw Error("프로젝트 이름을 입력하세요.");
      p.meta = meta;
      record(p, "프로젝트 정보 수정");
      await persist(p);
      render();
      toast("프로젝트 정보를 저장했습니다.");
    },
    "submit",
  );
  document
    .querySelectorAll("#project-form input, #project-form textarea")
    .forEach((input) => {
      input.addEventListener("input", () => {
        const value = input.value.trim();
        input.setCustomValidity(
          input.name === "name" && !value ? "프로젝트 이름을 입력하세요." : "",
        );
        if (!input.validity.valid) return;
        project().meta[input.name] = value;
        saveSoon();
        sidebar();
      });
      input.addEventListener("change", () => {
        if (input.validity.valid) {
          record(project(), `${META[input.name]} 수정`);
          saveSoon();
        }
      });
    });
  bind("#duplicate-project", async () => {
    const p = structuredClone(project());
    p.id = crypto.randomUUID();
    p.meta.name += " (복제)";
    record(p, "프로젝트 복제");
    await persist(p);
    projects.push(p);
    currentId = p.id;
    render();
  });
  bind("#delete-project", async () => {
    const p = project();
    if (
      !confirm(
        `“${p.meta.name}”과 모든 측정·버전을 삭제할까요? 먼저 JSON 백업을 권장합니다.`,
      )
    )
      return;
    await queue;
    await deleteProject(p.id);
    projects = projects.filter((x) => x.id !== p.id);
    currentId = projects[0]?.id;
    render();
    toast("프로젝트를 삭제했습니다.");
  });
  bind(
    "#step-preset",
    (e) => {
      if (e.target.value !== "custom")
        $("#settings-form [name=step]").value = e.target.value;
    },
    "change",
  );
  bind(
    "#settings-form",
    async (e) => {
      e.preventDefault();
      const p = project(),
        data = new FormData(e.target),
        s = {
          channels: data.getAll("channels"),
          step: Number(data.get("step")),
          integer: data.has("integer"),
          precision: Number(data.get("precision")),
        };
      validateSettings(s);
      if (JSON.stringify(s) !== JSON.stringify(p.settings)) {
        p.settings = s;
        record(p, "측정 설정 변경 · 과거 측정/버전 보존");
        await persist(p);
      }
      render();
      toast("측정 설정을 저장했습니다. 기존 버전의 데이터는 보존됩니다.");
    },
    "submit",
  );
  bind("#print-guide", () => window.print());
  bind("#copy-guide", () => {
    const p = project(),
      v = version(),
      second = route === "guide2",
      c = channel(second),
      s = second ? v.settings : p.settings,
      rs = second
        ? v.tables[c]
        : targets(s).map((t) => ({ target: t, production: t }));
    return copy(
      csv([
        ["패치 ID", "목표 계조", "C", "M", "Y", "K"],
        ...rs.map((r) => [
          patchId(c, r.target, second ? 2 : 1, v?.number),
          r.target,
          ...CHANNELS.map((ch) => prodFmt(ch === c ? r.production : 0, s)),
        ]),
      ]).slice(1),
    );
  });
  document.querySelectorAll("[data-measure]").forEach((input) => {
    input.addEventListener("input", () => updateMeasurement(input));
    input.addEventListener("focus", () => {
      project().location.cell = input.id;
      saveSoon();
    });
    input.addEventListener("change", () => {
      record(
        project(),
        `${input.dataset.second === "true" ? "2차 V" + version().number : "1차"} ${input.dataset.channel}:${input.dataset.target} ${input.dataset.measure} 수정`,
      );
      saveSoon();
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const inputs = [
            ...document.querySelectorAll("[data-measure]:not(:disabled)"),
          ],
          i = inputs.indexOf(input),
          next = inputs[i + (e.shiftKey ? -1 : 1)];
        if (next) next.focus();
      }
    });
  });
  bind("#resume-cell", () => {
    const el = document.getElementById(project().location.cell);
    if (el && !el.disabled) {
      el.focus();
      el.scrollIntoView({ block: "center" });
    } else toast("현재 채널에 저장된 입력 위치가 없습니다.");
  });
  bind("#export-measure", () => measurementExport(route === "measure2"));
  bind("#calculate", async () => {
    const p = project(),
      selection = $("#calculate-channel").value,
      chs = selection === "all" ? p.settings.channels : [selection];
    const v = calculateVersion(p, chs);
    p.location.versionId = v.id;
    p.location.channel = chs[0];
    await persist(p);
    render();
    toast(`보정 V${v.number}을 생성했습니다. 2차 패치를 제작하세요.`);
  });
  bind("#copy-correction", () => {
    const v = version();
    return copy(
      csv([
        ["채널", "목표 계조", "내부 계산값", "제작 입력값", "버전"],
        ...v.tables[channel(true)].map((r) => [
          channel(true),
          r.target,
          r.internal,
          prodFmt(r.production, v.settings),
          v.number,
        ]),
      ]).slice(1),
    );
  });
  bind("#export-correction", () => {
    const v = version();
    exportFile(
      [
        [
          "채널",
          "목표 계조",
          "내부 계산값",
          "제작 입력값",
          "정수 모드",
          "버전",
        ],
        ...v.channels.flatMap((c) =>
          v.tables[c].map((r) => [
            c,
            r.target,
            r.internal,
            r.production,
            v.settings.integer,
            v.number,
          ]),
        ),
      ],
      `보정테이블-V${v.number}`,
    );
  });
  bind("#export-final", () => {
    const v = version();
    exportFile(
      [
        [
          "채널",
          "목표 계조",
          "1차 입력값",
          "1차 L*",
          "1차 a*",
          "1차 b*",
          "내부 계산값",
          "권장 제작값",
          "실제 제작값",
          "2차 L*",
          "2차 a*",
          "2차 b*",
          "1차 계조오차",
          "2차 계조오차",
          "DeltaE76",
          "상태",
          "버전",
        ],
        ...v.channels.flatMap((c) =>
          comparison(v, c).map((r) => [
            c,
            r.target,
            r.target,
            ...["L", "a", "b"].map((f) => Number(r.first[f])),
            r.internal,
            r.production,
            actualValid(r.second?.actual, v.settings)
              ? Number(r.second.actual)
              : "",
            ...["L", "a", "b"].map((f) =>
              numeric(r.second?.[f]) ? Number(r.second[f]) : "",
            ),
            r.before,
            r.after,
            r.deltaE,
            r.status,
            v.number,
          ]),
        ),
      ],
      `최종비교-V${v.number}`,
    );
  });
  bind("#confirm-version", async () => {
    const p = project(),
      v = version();
    if (
      !confirm(
        "개선·악화 상태와 출력 품질을 검토하셨나요? 확정하면 이 버전의 측정값이 잠기고 계산기에서 사용할 수 있습니다.",
      )
    )
      return;
    confirmVersion(p, v);
    await persist(p);
    render();
    toast(`V${v.number}을 확정했습니다.`);
  });
  if (route === "calculator") {
    document
      .querySelectorAll("[data-calc]")
      .forEach((i) => i.addEventListener("input", updateCalculator));
    bind(
      "#calc-integer",
      (e) => {
        calcInteger = e.target.checked;
        document
          .querySelectorAll("[data-calc]")
          .forEach((i) => (i.step = calcInteger ? "1" : "any"));
        updateCalculator();
      },
      "change",
    );
    bind("#copy-calculator", () =>
      copy(
        calculatorRows()
          .map(
            (r) =>
              `${r.channel} ${prodFmt(r.output, { ...project().settings, integer: calcInteger })}`,
          )
          .join(" / "),
      ),
    );
    bind("#copy-calculator-csv", () =>
      copy(
        calculatorRows()
          .map((r) =>
            prodFmt(r.output, { ...project().settings, integer: calcInteger }),
          )
          .join(","),
      ),
    );
    bind("#reset-calculator", () => {
      document.querySelectorAll("[data-calc]").forEach((i) => (i.value = 0));
      updateCalculator();
    });
    updateCalculator();
  }
}
function updateMeasurement(input) {
  const p = project(),
    second = input.dataset.second === "true",
    v = version();
  if (second && v.confirmedAt) return;
  const data = second ? v.second : p.first,
    k = key(input.dataset.channel, Number(input.dataset.target));
  data[k] ??= {};
  // Keep raw drafts (including invalid values) separate from calculation/display values.
  data[k][input.dataset.measure] = input.validity.badInput
    ? "유효하지 않은 숫자"
    : input.value;
  p.location.cell = input.id;
  const f = input.dataset.measure,
    val = data[k][f],
    valid =
      val === ""
        ? true
        : f === "actual"
          ? actualValid(val, v.settings)
          : numeric(val) &&
            (f !== "L" || (Number(val) >= 0 && Number(val) <= 100));
  input.setAttribute("aria-invalid", String(!valid));
  document.getElementById(`${input.id}-error`).hidden = valid;
  const r = input.closest("tr"),
    ready =
      labValid(data[k]) && (!second || actualValid(data[k].actual, v.settings)),
    label = r.querySelector("[data-row-status]");
  label.textContent = ready ? "완료" : "미완료";
  label.className = ready ? "complete" : "incomplete";
  const ts = second
      ? v.tables[channel(true)].map((r) => r.target)
      : targets(p.settings),
    done = ts.filter(
      (t) =>
        labValid(data[key(channel(second), t)]) &&
        (!second ||
          actualValid(data[key(channel(true), t)]?.actual, v.settings)),
    ).length;
  $("#completion").textContent =
    `${done} / ${ts.length} 완료 (${Math.round((done / ts.length) * 100)}%)`;
  $("#progress-bar").style.width = `${(done / ts.length) * 100}%`;
  saveSoon(p);
}
function calculatorRows() {
  return convert(
    project(),
    version(),
    Object.fromEntries(CHANNELS.map((c) => [c, $(`#calc-${c}`).value])),
    calcInteger,
  );
}
function updateCalculator() {
  if (calculatorReason(project(), version())) return;
  try {
    const rows = calculatorRows();
    $("#calc-error").innerHTML = "";
    rows.forEach((r) => {
      $(`#calc-${r.channel}`).setAttribute("aria-invalid", "false");
      $(`#output-${r.channel}`).textContent =
        prodFmt(r.output, { ...project().settings, integer: calcInteger }) +
        "%";
      $(`#internal-${r.channel}`).textContent = `내부값 ${r.internal}`;
    });
    $("#calc-summary").textContent = rows
      .map(
        (r) =>
          `${r.channel} ${prodFmt(r.output, { ...project().settings, integer: calcInteger })}`,
      )
      .join(" / ");
    $("#copy-calculator").disabled = $("#copy-calculator-csv").disabled = false;
  } catch (error) {
    $("#calc-error").innerHTML = notice(esc(error.message), "error");
    $("#calc-summary").textContent = "입력값을 확인하세요.";
    CHANNELS.forEach((c) => {
      $(`#output-${c}`).textContent = "—";
      $(`#internal-${c}`).textContent = "내부값 —";
      $(`#calc-${c}`).setAttribute(
        "aria-invalid",
        String(
          !actualValid($(`#calc-${c}`).value, {
            ...project().settings,
            integer: calcInteger,
          }),
        ),
      );
    });
    $("#copy-calculator").disabled = $("#copy-calculator-csv").disabled = true;
  }
}
function charts() {
  const p = project();
  if (!p) return;
  const final = route === "final",
    v = version();
  if (route !== "results1" && !final) return;
  if (final && !v) return;
  const c = channel(final),
    ts = final ? v.tables[c].map((r) => r.target) : targets(p.settings);
  ["L", "a", "b"].forEach((f) => {
    const canvas = $(`#chart-${f}`);
    if (!canvas) return;
    const first = final ? v.source : p.first;
    drawChart(
      canvas,
      [
        {
          color: "#4964d9",
          points: ts.map((t) => ({
            x: t,
            y: numeric(first[key(c, t)]?.[f])
              ? Number(first[key(c, t)][f])
              : NaN,
          })),
        },
        ...(final
          ? [
              {
                color: "#df7d3a",
                points: ts.map((t) => ({
                  x: t,
                  y: numeric(v.second[key(c, t)]?.[f])
                    ? Number(v.second[key(c, t)][f])
                    : NaN,
                })),
              },
            ]
          : []),
      ],
      `${f}*`,
      f === "L" ? [0, 100] : null,
    );
  });
  if (final)
    drawChart(
      $("#chart-correction"),
      [
        {
          color: "#b6becc",
          dashed: true,
          points: [
            { x: 0, y: 0 },
            { x: 100, y: 100 },
          ],
        },
        {
          color: "#4964d9",
          points: v.tables[c].map((r) => ({ x: r.target, y: r.internal })),
        },
        {
          color: "#df7d3a",
          points: v.tables[c].map((r) => ({
            x: r.target,
            y: numeric(v.second[key(c, r.target)]?.actual)
              ? Number(v.second[key(c, r.target)].actual)
              : NaN,
          })),
        },
      ],
      "보정 입력 (%)",
      [0, 100],
    );
}
window.addEventListener("resize", charts);
$("#project-select").addEventListener("change", (e) => {
  currentId = e.target.value;
  location.hash = project().location.route;
  calcInteger = undefined;
  render();
});
$("#backup").addEventListener("click", () => {
  const p = project();
  if (!p) return;
  download(
    backupText(p),
    `color-cal-${new Date().toISOString().slice(0, 10)}.json`,
    "application/json",
  );
  toast("현재 프로젝트 전체를 백업했습니다.");
});
$("#restore").addEventListener("click", () => $("#restore-file").click());
$("#restore-file").addEventListener("change", async (e) => {
  try {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 30 * 1024 * 1024)
      throw Error("백업은 30MB 이하여야 합니다.");
    const p = parseBackup(await file.text());
    await persist(p);
    projects.push(p);
    currentId = p.id;
    location.hash = "projects";
    render();
    toast("기존 데이터를 덮어쓰지 않고 별도 프로젝트로 복원했습니다.");
  } catch (error) {
    toast(`복원 실패: ${error.message}`);
  } finally {
    e.target.value = "";
  }
});
window.addEventListener("hashchange", navigate);
try {
  await openDB();
  projects = (await listProjects()).sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
  let selected;
  try {
    selected = localStorage.getItem("color-cal-current");
  } catch {}
  currentId = projects.some((p) => p.id === selected)
    ? selected
    : projects[0]?.id;
  status("자동 저장 준비 완료");
  if (!location.hash && project())
    location.hash = project().location.route || "projects";
  else navigate();
} catch (error) {
  status("저장소 연결 실패", true);
  saveError = true;
  content.innerHTML =
    heading(
      "저장소를 열 수 없습니다.",
      "브라우저의 사이트 데이터 및 IndexedDB 허용 설정을 확인한 뒤 새로고침하세요.",
    ) + notice(esc(error.message), "error");
  $("#backup").disabled = true;
}
