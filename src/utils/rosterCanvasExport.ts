export interface CanvasRosterDay {
  dayNum: number;
  isoDate: string;
  weekdayUpper: string;
  isWeekend: boolean;
  isToday: boolean;
}

export interface CanvasRosterRow {
  rowKey: string;
  siraNo: number;
  groupIdx?: number;
  displayLabel: string;
  roleColor: 'leader' | 'deputy' | 'member';
  isLastInGroup: boolean;
  isCurrentUser: boolean;
}

export interface CanvasRosterCell {
  code: string;
  variant: 'normal' | 'swap-in' | 'swap-out' | 'leave' | 'note' | 'cleared' | 'extra';
  customBg?: string;
}

export interface CanvasRosterStyleOptions {
  tableTheme?: 'classic' | 'modern' | 'dark' | 'contrast';
  highlightWeekends?: boolean;
  zebraGroups?: boolean;
  colorizeShiftCodes?: boolean;
  highlightToday?: boolean;
  boldGroupDividers?: boolean;
  showLegend?: boolean;
  showTotalsColumn?: boolean;
  rowDensity?: 'compact' | 'normal' | 'comfortable';
}

export interface RenderRosterCanvasParams {
  title: string;
  subtitle: string;
  days: CanvasRosterDay[];
  rows: CanvasRosterRow[];
  getCell: (row: CanvasRosterRow, dayIdx: number) => CanvasRosterCell;
  getRowTotals?: (row: CanvasRosterRow) => { shifts: number; hours: number };
  styleOptions?: CanvasRosterStyleOptions;
  legendText: string;
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let trimmed = text;
  while (trimmed.length > 1 && ctx.measureText(`${trimmed}…`).width > maxWidth) {
    trimmed = trimmed.slice(0, -1);
  }
  return `${trimmed}…`;
}

/**
 * Renders the full official 112 shift roster matrix directly onto a crisp 2x DPI
 * HTML5 Canvas, honoring visual customization options and per-cell color highlights.
 */
export function renderRosterToCanvas(params: RenderRosterCanvasParams): HTMLCanvasElement {
  const { title, subtitle, days, rows, getCell, getRowTotals, styleOptions, legendText } = params;

  const opts: Required<CanvasRosterStyleOptions> = {
    tableTheme: styleOptions?.tableTheme || 'classic',
    highlightWeekends: styleOptions?.highlightWeekends ?? false,
    zebraGroups: styleOptions?.zebraGroups ?? false,
    colorizeShiftCodes: styleOptions?.colorizeShiftCodes ?? false,
    highlightToday: styleOptions?.highlightToday ?? true,
    boldGroupDividers: styleOptions?.boldGroupDividers ?? true,
    showLegend: styleOptions?.showLegend ?? true,
    showTotalsColumn: styleOptions?.showTotalsColumn ?? false,
    rowDensity: styleOptions?.rowDensity || 'normal',
  };

  const isDark = opts.tableTheme === 'dark';
  const isModern = opts.tableTheme === 'modern';
  const isContrast = opts.tableTheme === 'contrast';

  const palette = {
    paperBg: isDark ? '#0B1120' : '#FFFFFF',
    headerBg: isDark ? '#111827' : isModern ? '#F8FAFC' : '#FFFFFF',
    cellBg: isDark ? '#0F172A' : '#FFFFFF',
    zebraBg: isDark ? '#162033' : isModern ? '#F1F5F9' : '#F8FAFC',
    weekendBg: isDark ? '#1E1B2E' : '#FFF1F2',
    todayHeaderBg: isDark ? '#0C4A6E' : '#E0F2FE',
    todayCellBg: isDark ? '#0F2942' : '#F0F9FF',
    currentUserBg: isDark ? '#2A2210' : '#FFFBEB',
    titleFg: isDark ? '#F8FAFC' : '#0F172A',
    subtitleFg: isDark ? '#94A3B8' : '#475569',
    textFg: isDark ? '#E2E8F0' : '#0F172A',
    gridLine: isDark ? '#334155' : isContrast ? '#0F172A' : isModern ? '#CBD5E1' : '#334155',
    strongLine: isDark ? '#64748B' : '#0F172A',
    leaderFg: isDark ? '#FCA5A5' : '#B91C1C',
    deputyFg: isDark ? '#93C5FD' : '#1D4ED8',
    weekendFg: isDark ? '#F87171' : '#DC2626',
  };

  const fontFamily = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';

  const padX = 20;
  const padY = 18;
  const titleH = 34;
  const siraColW = 40;
  const nameColW = 248;
  const dayColW = 34;
  const totalColW = opts.showTotalsColumn ? 64 : 0;
  const numHeaderH = 26;
  const weekdayHeaderH = 82;
  const headerTotalH = numHeaderH + weekdayHeaderH;
  const rowH = opts.rowDensity === 'compact' ? 23 : opts.rowDensity === 'comfortable' ? 34 : 28;
  const legendH = opts.showLegend ? 30 : 12;

  const tableW = siraColW + nameColW + days.length * dayColW + totalColW;
  const tableH = headerTotalH + rows.length * rowH;

  const totalW = padX * 2 + tableW;
  const totalH = padY * 2 + titleH + tableH + legendH;
  const scale = Math.min(2, 4096 / Math.max(totalW, totalH, 1));

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(totalW * scale);
  canvas.height = Math.round(totalH * scale);

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas 2D context unavailable');
  }

  ctx.scale(scale, scale);
  ctx.textBaseline = 'middle';

  // 1. Background
  ctx.fillStyle = palette.paperBg;
  ctx.fillRect(0, 0, totalW, totalH);

  // 2. Title & subtitle
  ctx.fillStyle = palette.titleFg;
  ctx.font = `800 15px ${fontFamily}`;
  ctx.textAlign = 'left';
  ctx.fillText(title, padX, padY + 14);

  ctx.fillStyle = palette.subtitleFg;
  ctx.font = `600 11.5px ${fontFamily}`;
  ctx.textAlign = 'right';
  ctx.fillText(subtitle, padX + tableW, padY + 14);

  const tableX = padX;
  const tableY = padY + titleH;

  // 3. Header Backgrounds
  ctx.fillStyle = palette.headerBg;
  ctx.fillRect(tableX, tableY, siraColW + nameColW, headerTotalH);

  days.forEach((d, dIdx) => {
    const cx = tableX + siraColW + nameColW + dIdx * dayColW;
    ctx.fillStyle =
      opts.highlightToday && d.isToday
        ? palette.todayHeaderBg
        : opts.highlightWeekends && d.isWeekend
        ? palette.weekendBg
        : palette.headerBg;
    ctx.fillRect(cx, tableY, dayColW, headerTotalH);

    if (opts.highlightToday && d.isToday) {
      ctx.fillStyle = '#0284C7';
      ctx.fillRect(cx, tableY, dayColW, 3);
    }

    ctx.fillStyle = opts.highlightToday && d.isToday ? (isDark ? '#E0F2FE' : '#0C4A6E') : palette.textFg;
    ctx.font = `800 12px ${fontFamily}`;
    ctx.textAlign = 'center';
    ctx.fillText(String(d.dayNum), cx + dayColW / 2, tableY + numHeaderH / 2 + 0.5);

    ctx.save();
    ctx.translate(cx + dayColW / 2, tableY + numHeaderH + weekdayHeaderH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = d.isWeekend ? palette.weekendFg : palette.textFg;
    ctx.font = `700 10px ${fontFamily}`;
    ctx.textAlign = 'center';
    ctx.fillText(d.weekdayUpper, 0, 0.5);
    ctx.restore();
  });

  if (opts.showTotalsColumn) {
    const tx = tableX + siraColW + nameColW + days.length * dayColW;
    ctx.fillStyle = palette.headerBg;
    ctx.fillRect(tx, tableY, totalColW, headerTotalH);
    ctx.fillStyle = palette.textFg;
    ctx.font = `800 10.5px ${fontFamily}`;
    ctx.textAlign = 'center';
    ctx.fillText('TOPLAM', tx + totalColW / 2, tableY + headerTotalH / 2 - 7);
    ctx.fillText('NÖB / SA', tx + totalColW / 2, tableY + headerTotalH / 2 + 7);
  }

  ctx.fillStyle = palette.textFg;
  ctx.font = `800 11px ${fontFamily}`;
  ctx.textAlign = 'center';
  ctx.fillText('SIRA', tableX + siraColW / 2, tableY + headerTotalH / 2 - 7);
  ctx.fillText('NO', tableX + siraColW / 2, tableY + headerTotalH / 2 + 7);

  ctx.font = `800 12px ${fontFamily}`;
  ctx.fillText('PERSONEL', tableX + siraColW + nameColW / 2, tableY + headerTotalH / 2 - 8);
  ctx.fillText('ADI SOYADI', tableX + siraColW + nameColW / 2, tableY + headerTotalH / 2 + 8);

  // 4. Body Rows & Cells
  rows.forEach((row, rIdx) => {
    const ry = tableY + headerTotalH + rIdx * rowH;
    const isAltGroup = opts.zebraGroups && typeof row.groupIdx === 'number' && row.groupIdx % 2 === 1;
    const rowBaseBg = row.isCurrentUser
      ? palette.currentUserBg
      : isAltGroup
      ? palette.zebraBg
      : palette.cellBg;

    ctx.fillStyle = rowBaseBg;
    ctx.fillRect(tableX, ry, siraColW + nameColW, rowH);

    ctx.fillStyle = palette.textFg;
    ctx.font = `700 11px ${fontFamily}`;
    ctx.textAlign = 'center';
    ctx.fillText(String(row.siraNo), tableX + siraColW / 2, ry + rowH / 2 + 0.5);

    if (row.roleColor === 'leader') {
      ctx.fillStyle = palette.leaderFg;
      ctx.font = `700 11px ${fontFamily}`;
    } else if (row.roleColor === 'deputy') {
      ctx.fillStyle = palette.deputyFg;
      ctx.font = `700 11px ${fontFamily}`;
    } else {
      ctx.fillStyle = palette.textFg;
      ctx.font = `600 11px ${fontFamily}`;
    }
    ctx.textAlign = 'left';
    const labelFitted = fitText(ctx, row.displayLabel, nameColW - 14);
    ctx.fillText(labelFitted, tableX + siraColW + 7, ry + rowH / 2 + 0.5);

    days.forEach((day, dIdx) => {
      const cx = tableX + siraColW + nameColW + dIdx * dayColW;
      const cell = getCell(row, dIdx);

      let bg =
        opts.highlightToday && day.isToday
          ? palette.todayCellBg
          : opts.highlightWeekends && day.isWeekend
          ? palette.weekendBg
          : rowBaseBg;
      let fg = palette.textFg;
      let font = `700 12.5px ${fontFamily}`;

      if (opts.colorizeShiftCodes && cell.variant === 'normal') {
        if (cell.code === 'S') fg = isDark ? '#FBBF24' : '#B45309';
        else if (cell.code === 'A') fg = isDark ? '#818CF8' : '#3730A3';
        else if (cell.code === '24') fg = isDark ? '#FB7185' : '#BE123C';
      }

      if (cell.variant === 'swap-in') {
        bg = '#BAE6FD';
        fg = '#020617';
        font = `800 12.5px ${fontFamily}`;
      } else if (cell.variant === 'swap-out') {
        bg = '#FDE047';
        fg = '#0F172A';
      } else if (cell.variant === 'leave') {
        bg = '#7E22CE';
        fg = '#FFFFFF';
        font = `800 8.5px ${fontFamily}`;
      } else if (cell.variant === 'note') {
        bg = '#FEF08A';
        fg = '#0F172A';
      } else if (cell.variant === 'extra') {
        bg = '#BBF7D0';
        fg = '#052E16';
        font = `800 12.5px ${fontFamily}`;
      } else if (cell.variant === 'cleared') {
        bg = rowBaseBg;
        fg = '#64748B';
      }

      if (cell.customBg) {
        bg = cell.customBg;
        fg = '#0F172A';
      }

      ctx.fillStyle = bg;
      ctx.fillRect(cx, ry, dayColW, rowH);

      if (cell.code) {
        ctx.fillStyle = fg;
        ctx.font = font;
        ctx.textAlign = 'center';
        ctx.fillText(cell.code, cx + dayColW / 2, ry + rowH / 2 + 0.5);
      }
    });

    if (opts.showTotalsColumn && getRowTotals) {
      const tx = tableX + siraColW + nameColW + days.length * dayColW;
      const tot = getRowTotals(row);
      ctx.fillStyle = rowBaseBg;
      ctx.fillRect(tx, ry, totalColW, rowH);
      ctx.fillStyle = palette.textFg;
      ctx.font = `700 10px ${fontFamily}`;
      ctx.textAlign = 'center';
      ctx.fillText(`${tot.shifts}g / ${tot.hours}s`, tx + totalColW / 2, ry + rowH / 2 + 0.5);
    }
  });

  // 5. Grid Borders
  ctx.strokeStyle = palette.gridLine;
  ctx.lineWidth = isContrast ? 1.25 : 1;

  ctx.beginPath();
  ctx.moveTo(tableX + siraColW + nameColW, tableY + numHeaderH + 0.5);
  ctx.lineTo(tableX + siraColW + nameColW + days.length * dayColW, tableY + numHeaderH + 0.5);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(tableX + siraColW + 0.5, tableY);
  ctx.lineTo(tableX + siraColW + 0.5, tableY + tableH);
  ctx.stroke();

  for (let dIdx = 1; dIdx <= days.length; dIdx++) {
    const vx = tableX + siraColW + nameColW + dIdx * dayColW + 0.5;
    ctx.beginPath();
    ctx.moveTo(vx, tableY);
    ctx.lineTo(vx, tableY + tableH);
    ctx.stroke();
  }

  rows.forEach((row, rIdx) => {
    const by = tableY + headerTotalH + (rIdx + 1) * rowH;
    ctx.beginPath();
    const isBoldDivider = opts.boldGroupDividers && row.isLastInGroup;
    ctx.strokeStyle = isBoldDivider ? palette.strongLine : palette.gridLine;
    ctx.lineWidth = isBoldDivider ? 2 : 1;
    ctx.moveTo(tableX, by);
    ctx.lineTo(tableX + tableW, by);
    ctx.stroke();
  });

  ctx.strokeStyle = palette.strongLine;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(tableX + siraColW + nameColW, tableY);
  ctx.lineTo(tableX + siraColW + nameColW, tableY + tableH);
  ctx.stroke();

  if (opts.showTotalsColumn) {
    const tx = tableX + siraColW + nameColW + days.length * dayColW;
    ctx.beginPath();
    ctx.moveTo(tx, tableY);
    ctx.lineTo(tx, tableY + tableH);
    ctx.stroke();
  }

  ctx.beginPath();
  ctx.moveTo(tableX, tableY + headerTotalH);
  ctx.lineTo(tableX + tableW, tableY + headerTotalH);
  ctx.stroke();

  ctx.strokeRect(tableX, tableY, tableW, tableH);

  // 6. Footer Legend
  if (opts.showLegend) {
    ctx.fillStyle = palette.subtitleFg;
    ctx.font = `600 10.5px ${fontFamily}`;
    ctx.textAlign = 'left';
    ctx.fillText(legendText, padX, tableY + tableH + 18);
  }

  return canvas;
}
