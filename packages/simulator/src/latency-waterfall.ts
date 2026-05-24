import chalk from 'chalk';

export interface LatencyWaterfallRow {
  turn: number;
  userSaid: string;
  agentSaid: string;
  sttMs: number;
  mcpMs: number;
  ttsFirstByteMs: number;
  totalMs: number;
  sttBudget: number;
  mcpBudget: number;
  ttsBudget: number;
  totalBudgetTarget: number;
  totalBudgetHardCap: number;
}

function colorLatency(actual: number, budget: number): string {
  if (actual <= budget) {
    return chalk.green(`${actual}ms`);
  }
  if (actual <= budget * 1.3) {
    return chalk.yellow(`${actual}ms`);
  }
  return chalk.red(`${actual}ms`);
}

function colorTotalLatency(actual: number, target: number, hardCap: number): string {
  if (actual <= target) {
    return chalk.green(`${actual}ms`);
  }
  if (actual <= hardCap) {
    return chalk.yellow(`${actual}ms`);
  }
  return chalk.red(`${actual}ms`);
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) {
    return str;
  }
  return `${str.slice(0, maxLen - 3)}...`;
}

/**
 * Renders a latency waterfall table using chalk for color coding:
 * green = within budget, yellow = near limit, red = exceeded.
 */
export function renderLatencyWaterfall(rows: LatencyWaterfallRow[]): string {
  if (rows.length === 0) {
    return chalk.dim('No turns recorded.');
  }

  const userColWidth = Math.max(17, ...rows.map((r) => r.userSaid.length)) + 2;
  const agentColWidth = Math.max(17, ...rows.map((r) => r.agentSaid.length)) + 2;

  const header =
    chalk.bold(' Turn ') +
    '| ' +
    chalk.bold('User Said'.padEnd(userColWidth)) +
    '| ' +
    chalk.bold('Agent Said'.padEnd(agentColWidth)) +
    '| ' +
    chalk.bold('STT   ') +
    '| ' +
    chalk.bold('MCP   ') +
    '| ' +
    chalk.bold('TTS:FB ') +
    '| ' +
    chalk.bold('Total  ');

  const sep = chalk.dim(
    '-----+-' +
      '-'.repeat(userColWidth) +
      '-+-' +
      '-'.repeat(agentColWidth) +
      '-+------+------+-------+--------',
  );

  const lines: string[] = [header, sep];

  let sumStt = 0;
  let sumMcp = 0;
  let sumTts = 0;
  let sumTotal = 0;

  for (const row of rows) {
    const sttStr = colorLatency(row.sttMs, row.sttBudget).padEnd(6);
    const mcpStr = colorLatency(row.mcpMs, row.mcpBudget).padEnd(6);
    const ttsStr = colorLatency(row.ttsFirstByteMs, row.ttsBudget).padEnd(7);
    const totalStr = colorTotalLatency(
      row.totalMs,
      row.totalBudgetTarget,
      row.totalBudgetHardCap,
    ).padEnd(7);

    const turnNum = chalk.dim(String(row.turn).padStart(4));
    const userStr = truncate(row.userSaid, userColWidth).padEnd(userColWidth);
    const agentStr = truncate(row.agentSaid, agentColWidth).padEnd(agentColWidth);

    lines.push(
      `${turnNum} | ${chalk.cyan(userStr)}| ${chalk.magenta(agentStr)}| ${sttStr}| ${mcpStr}| ${ttsStr}| ${totalStr}`,
    );

    sumStt += row.sttMs;
    sumMcp += row.mcpMs;
    sumTts += row.ttsFirstByteMs;
    sumTotal += row.totalMs;
  }

  lines.push(sep);

  const count = rows.length;
  const firstRow = rows[0];
  if (!firstRow) {
    return lines.join('\n');
  }

  const avgStt = Math.round(sumStt / count);
  const avgMcp = Math.round(sumMcp / count);
  const avgTts = Math.round(sumTts / count);
  const avgTotal = Math.round(sumTotal / count);

  const avgSttStr = colorLatency(avgStt, firstRow.sttBudget).padEnd(6);
  const avgMcpStr = colorLatency(avgMcp, firstRow.mcpBudget).padEnd(6);
  const avgTtsStr = colorLatency(avgTts, firstRow.ttsBudget).padEnd(7);
  const avgTotalStr = colorTotalLatency(
    avgTotal,
    firstRow.totalBudgetTarget,
    firstRow.totalBudgetHardCap,
  ).padEnd(7);

  const avgLabel = chalk.bold(' AVG ');
  const emptyUser = ''.padEnd(userColWidth);
  const emptyAgent = ''.padEnd(agentColWidth);

  lines.push(
    `${avgLabel} | ${chalk.dim(emptyUser)}| ${chalk.dim(emptyAgent)}| ${avgSttStr}| ${avgMcpStr}| ${avgTtsStr}| ${avgTotalStr}`,
  );

  return lines.join('\n');
}
