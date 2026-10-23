import { CHANNELS, targets } from "./values.js";
import { calibrationTablesValid, convertChannels } from "./calibration.js";
export function referenceTable(version, step = 5) {
  if (!version || !calibrationTablesValid(version))
    throw Error("원본과 일치하는 유효한 보정 테이블이 필요합니다.");
  const values = targets({ ...version.settings, step });
  return values.map((target) => ({
    target,
    channels: convertChannels(
      version,
      Object.fromEntries(CHANNELS.map((c) => [c, target])),
    ),
  }));
}
export function referencePrintPages(rows) {
  const pages = [];
  for (let i = 0; i < rows.length; i += 102) {
    const page = rows.slice(i, i + 102),
      columnSize = Math.ceil(page.length / 3),
      columns = [];
    for (let j = 0; j < page.length; j += columnSize)
      columns.push(page.slice(j, j + columnSize));
    pages.push(columns);
  }
  return pages;
}
