export function drawChart(canvas, series, ylabel, yDomain) {
  const width = Math.max(canvas.clientWidth, 250),
    height = 230,
    dpr = window.devicePixelRatio || 1;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  const pad = { left: 43, right: 15, top: 20, bottom: 35 };
  const points = series
    .flatMap((s) => s.points)
    .filter((p) => Number.isFinite(p.y));
  let low = yDomain?.[0] ?? Math.min(0, ...points.map((p) => p.y)),
    high = yDomain?.[1] ?? Math.max(1, ...points.map((p) => p.y));
  if (!yDomain) {
    const gap = (high - low) * 0.08;
    low -= gap;
    high += gap;
  }
  const x = (v) => pad.left + (v / 100) * (width - pad.left - pad.right);
  const y = (v) =>
    height -
    pad.bottom -
    ((v - low) / (high - low)) * (height - pad.top - pad.bottom);
  ctx.font = "10px system-ui";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const value = low + ((high - low) * i) / 4,
      py = y(value);
    ctx.strokeStyle = "#e8edf5";
    ctx.beginPath();
    ctx.moveTo(pad.left, py);
    ctx.lineTo(width - pad.right, py);
    ctx.stroke();
    ctx.fillStyle = "#7c879a";
    ctx.textAlign = "right";
    ctx.fillText(value.toFixed(0), pad.left - 8, py + 3);
    ctx.textAlign = "center";
    ctx.fillText(String(i * 25), x(i * 25), height - 16);
  }
  ctx.fillStyle = "#78839a";
  ctx.textAlign = "left";
  ctx.fillText(ylabel, pad.left, 11);
  ctx.textAlign = "right";
  ctx.fillText("목표 / 입력 (%)", width - pad.right, height - 1);
  series.forEach((s) => {
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 2;
    ctx.setLineDash(s.dashed ? [4, 4] : []);
    ctx.beginPath();
    let started = false;
    s.points.forEach((p) => {
      if (!Number.isFinite(p.y)) {
        started = false;
        return;
      }
      if (!started) ctx.moveTo(x(p.x), y(p.y));
      else ctx.lineTo(x(p.x), y(p.y));
      started = true;
    });
    ctx.stroke();
    ctx.setLineDash([]);
    s.points
      .filter((p) => Number.isFinite(p.y))
      .forEach((p) => {
        ctx.beginPath();
        ctx.fillStyle = s.color;
        ctx.arc(x(p.x), y(p.y), 2.5, 0, Math.PI * 2);
        ctx.fill();
      });
  });
}
