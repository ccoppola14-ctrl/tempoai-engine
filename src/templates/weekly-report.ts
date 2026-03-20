export interface WeeklyReportData {
  merchantName: string;
  locationName: string;
  weekOf: string; // e.g. "Mar 10 – Mar 16, 2026"

  // Revenue
  revenueThisWeek: number;
  revenueLastWeek: number;
  revenueChange: number; // percentage

  // Top performing items
  topItems: Array<{
    name: string;
    unitsSold: number;
    revenue: number;
    trend: 'up' | 'down' | 'flat';
  }>;

  // AI recommendations acted on
  recommendationsApplied: number;
  recommendationsTotal: number;
  estimatedLift: number; // percentage

  // Weather impact
  weatherSummary: string; // e.g. "3 rainy days drove 22% more soup orders"
  weatherDays: Array<{
    day: string;
    condition: string;
    avgTemp: number;
    revenueImpact: number; // percentage vs baseline
  }>;
}

export function generateWeeklyReportHtml(data: WeeklyReportData): string {
  const revenueArrow = data.revenueChange >= 0 ? '↑' : '↓';
  const revenueColor = data.revenueChange >= 0 ? '#10b981' : '#ef4444';
  const absChange = Math.abs(data.revenueChange).toFixed(1);

  const topItemsRows = data.topItems
    .slice(0, 5)
    .map(
      (item) => `
      <tr>
        <td style="padding: 10px 16px; border-bottom: 1px solid #1a1a2e; color: #e2e8f0; font-size: 14px;">
          ${item.name}
        </td>
        <td style="padding: 10px 16px; border-bottom: 1px solid #1a1a2e; color: #94a3b8; font-size: 14px; text-align: center;">
          ${item.unitsSold}
        </td>
        <td style="padding: 10px 16px; border-bottom: 1px solid #1a1a2e; color: #e2e8f0; font-size: 14px; text-align: right;">
          $${item.revenue.toFixed(2)}
        </td>
        <td style="padding: 10px 16px; border-bottom: 1px solid #1a1a2e; font-size: 14px; text-align: center;">
          <span style="color: ${item.trend === 'up' ? '#10b981' : item.trend === 'down' ? '#ef4444' : '#94a3b8'};">
            ${item.trend === 'up' ? '↑' : item.trend === 'down' ? '↓' : '–'}
          </span>
        </td>
      </tr>`,
    )
    .join('');

  const weatherRows = data.weatherDays
    .map(
      (day) => `
      <tr>
        <td style="padding: 8px 12px; border-bottom: 1px solid #1a1a2e; color: #94a3b8; font-size: 13px;">
          ${day.day}
        </td>
        <td style="padding: 8px 12px; border-bottom: 1px solid #1a1a2e; color: #94a3b8; font-size: 13px; text-align: center;">
          ${day.condition}
        </td>
        <td style="padding: 8px 12px; border-bottom: 1px solid #1a1a2e; color: #94a3b8; font-size: 13px; text-align: center;">
          ${day.avgTemp}°F
        </td>
        <td style="padding: 8px 12px; border-bottom: 1px solid #1a1a2e; font-size: 13px; text-align: right;">
          <span style="color: ${day.revenueImpact >= 0 ? '#10b981' : '#ef4444'};">
            ${day.revenueImpact >= 0 ? '+' : ''}${day.revenueImpact.toFixed(1)}%
          </span>
        </td>
      </tr>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>TempoAi Weekly Report</title>
</head>
<body style="margin: 0; padding: 0; background-color: #09090b; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #09090b;">
    <tr>
      <td align="center" style="padding: 40px 16px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width: 600px; width: 100%;">

          <!-- Header -->
          <tr>
            <td style="padding: 24px 32px; text-align: center;">
              <div style="display: inline-block; background: rgba(59,130,246,0.1); border-radius: 12px; padding: 10px 14px; margin-bottom: 16px;">
                <span style="color: #3b82f6; font-size: 24px;">⚡</span>
              </div>
              <h1 style="margin: 0 0 4px; color: #ffffff; font-size: 22px; font-weight: 700;">Weekly Performance Report</h1>
              <p style="margin: 0; color: #64748b; font-size: 13px;">${data.locationName} · ${data.weekOf}</p>
            </td>
          </tr>

          <!-- Revenue Card -->
          <tr>
            <td style="padding: 0 0 20px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background: #111113; border: 1px solid #1e1e2e; border-radius: 12px;">
                <tr>
                  <td style="padding: 24px 32px;">
                    <p style="margin: 0 0 8px; color: #64748b; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">Revenue This Week</p>
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td>
                          <span style="color: #ffffff; font-size: 32px; font-weight: 700;">$${data.revenueThisWeek.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                        </td>
                        <td style="text-align: right;">
                          <span style="display: inline-block; background: ${data.revenueChange >= 0 ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)'}; color: ${revenueColor}; padding: 6px 12px; border-radius: 8px; font-size: 14px; font-weight: 600;">
                            ${revenueArrow} ${absChange}%
                          </span>
                        </td>
                      </tr>
                    </table>
                    <p style="margin: 12px 0 0; color: #64748b; font-size: 13px;">
                      vs last week: $${data.revenueLastWeek.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Top Performing Items -->
          <tr>
            <td style="padding: 0 0 20px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background: #111113; border: 1px solid #1e1e2e; border-radius: 12px;">
                <tr>
                  <td style="padding: 20px 24px 8px;">
                    <h2 style="margin: 0; color: #ffffff; font-size: 16px; font-weight: 600;">Top Performing Items</h2>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 8px 8px 16px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <th style="padding: 8px 16px; color: #64748b; font-size: 11px; text-transform: uppercase; text-align: left; border-bottom: 1px solid #1a1a2e;">Item</th>
                        <th style="padding: 8px 16px; color: #64748b; font-size: 11px; text-transform: uppercase; text-align: center; border-bottom: 1px solid #1a1a2e;">Sold</th>
                        <th style="padding: 8px 16px; color: #64748b; font-size: 11px; text-transform: uppercase; text-align: right; border-bottom: 1px solid #1a1a2e;">Revenue</th>
                        <th style="padding: 8px 16px; color: #64748b; font-size: 11px; text-transform: uppercase; text-align: center; border-bottom: 1px solid #1a1a2e;">Trend</th>
                      </tr>
                      ${topItemsRows}
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- AI Recommendations -->
          <tr>
            <td style="padding: 0 0 20px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background: #111113; border: 1px solid #1e1e2e; border-radius: 12px;">
                <tr>
                  <td style="padding: 24px 32px;">
                    <h2 style="margin: 0 0 16px; color: #ffffff; font-size: 16px; font-weight: 600;">AI Recommendations</h2>
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td width="50%" style="padding-right: 12px;">
                          <div style="background: rgba(139,92,246,0.08); border-radius: 10px; padding: 16px; text-align: center;">
                            <p style="margin: 0; color: #a78bfa; font-size: 24px; font-weight: 700;">${data.recommendationsApplied}/${data.recommendationsTotal}</p>
                            <p style="margin: 4px 0 0; color: #64748b; font-size: 11px;">Applied This Week</p>
                          </div>
                        </td>
                        <td width="50%" style="padding-left: 12px;">
                          <div style="background: rgba(16,185,129,0.08); border-radius: 10px; padding: 16px; text-align: center;">
                            <p style="margin: 0; color: #10b981; font-size: 24px; font-weight: 700;">+${data.estimatedLift.toFixed(1)}%</p>
                            <p style="margin: 4px 0 0; color: #64748b; font-size: 11px;">Estimated Lift</p>
                          </div>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Weather Impact -->
          <tr>
            <td style="padding: 0 0 20px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background: #111113; border: 1px solid #1e1e2e; border-radius: 12px;">
                <tr>
                  <td style="padding: 20px 24px 8px;">
                    <h2 style="margin: 0 0 4px; color: #ffffff; font-size: 16px; font-weight: 600;">Weather Impact</h2>
                    <p style="margin: 0; color: #64748b; font-size: 13px;">${data.weatherSummary}</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 8px 8px 16px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <th style="padding: 8px 12px; color: #64748b; font-size: 11px; text-transform: uppercase; text-align: left; border-bottom: 1px solid #1a1a2e;">Day</th>
                        <th style="padding: 8px 12px; color: #64748b; font-size: 11px; text-transform: uppercase; text-align: center; border-bottom: 1px solid #1a1a2e;">Weather</th>
                        <th style="padding: 8px 12px; color: #64748b; font-size: 11px; text-transform: uppercase; text-align: center; border-bottom: 1px solid #1a1a2e;">Temp</th>
                        <th style="padding: 8px 12px; color: #64748b; font-size: 11px; text-transform: uppercase; text-align: right; border-bottom: 1px solid #1a1a2e;">Impact</th>
                      </tr>
                      ${weatherRows}
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 32px; text-align: center;">
              <p style="margin: 0 0 8px; color: #64748b; font-size: 12px;">
                Powered by <strong style="color: #3b82f6;">TempoAi</strong> — AI-driven restaurant intelligence
              </p>
              <p style="margin: 0; color: #475569; font-size: 11px;">
                ${data.merchantName} · ${data.locationName}
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function generateWeeklyReportSubject(data: WeeklyReportData): string {
  const arrow = data.revenueChange >= 0 ? '↑' : '↓';
  const absChange = Math.abs(data.revenueChange).toFixed(1);
  return `${data.locationName} Weekly Report: $${data.revenueThisWeek.toLocaleString()} (${arrow}${absChange}%) · ${data.weekOf}`;
}
