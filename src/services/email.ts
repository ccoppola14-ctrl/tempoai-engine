import { Resend } from 'resend';
import { logger } from '../utils/logger';
import type { SummaryData } from './daily-summary';

function getResend(): Resend {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error('RESEND_API_KEY is not set');
  return new Resend(key);
}

const DASHBOARD_URL = 'https://tempoai-three.vercel.app';
const FROM_EMAIL = 'TempoAI <digest@tempoai.app>';

function formatCurrency(amount: number): string {
  return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function buildHtml(summary: SummaryData, locationName: string): string {
  const date = new Date(summary.date + 'T12:00:00');
  const dateStr = date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const changeArrow = summary.changePercent !== null
    ? (summary.changePercent >= 0 ? '&#8593;' : '&#8595;')
    : '';
  const changeColor = summary.changePercent !== null
    ? (summary.changePercent >= 0 ? '#4ADE80' : '#F87171')
    : '#888';
  const changeText = summary.changePercent !== null
    ? `${changeArrow} ${Math.abs(summary.changePercent).toFixed(1)}%`
    : 'N/A';
  const prevWeekText = summary.prevWeekSales !== null
    ? `vs ${formatCurrency(summary.prevWeekSales)} last week`
    : 'No data from last week';

  const topItemsHtml = summary.topItems.length > 0
    ? summary.topItems.map((item, i) => {
        const medals = ['&#129351;', '&#129352;', '&#129353;'];
        const medal = medals[i] || '';
        return `
        <tr>
          <td style="padding: 10px 16px; border-bottom: 1px solid #2A2A3E; color: #E0E0E0; font-size: 15px;">
            ${medal} ${item.name}
          </td>
          <td style="padding: 10px 16px; border-bottom: 1px solid #2A2A3E; color: #C9A94E; font-size: 15px; text-align: center;">
            ${item.quantity} sold
          </td>
          <td style="padding: 10px 16px; border-bottom: 1px solid #2A2A3E; color: #A0A0B8; font-size: 15px; text-align: right;">
            ${formatCurrency(item.revenue)}
          </td>
        </tr>`;
      }).join('')
    : `<tr><td colspan="3" style="padding: 16px; color: #666; text-align: center;">No item data available</td></tr>`;

  const weatherHtml = summary.weatherNote
    ? `
      <div style="background: #1E1E30; border-radius: 10px; padding: 16px 20px; margin-top: 16px; border-left: 3px solid #60A5FA;">
        <span style="color: #60A5FA; font-size: 13px; text-transform: uppercase; letter-spacing: 1px;">Weather</span>
        <p style="color: #E0E0E0; font-size: 15px; margin: 6px 0 0 0;">${summary.weatherNote}</p>
      </div>`
    : '';

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Daily Digest — ${locationName}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0D0D1A; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #0D0D1A;">
    <tr>
      <td align="center" style="padding: 32px 16px;">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width: 600px; width: 100%;">

          <!-- Header -->
          <tr>
            <td style="padding: 32px 32px 24px; background: linear-gradient(135deg, #1A1A2E 0%, #16162A 100%); border-radius: 16px 16px 0 0; border-bottom: 2px solid #C9A94E;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td>
                    <span style="color: #C9A94E; font-size: 13px; text-transform: uppercase; letter-spacing: 2px; font-weight: 600;">TempoAI Daily Digest</span>
                    <h1 style="color: #FFFFFF; font-size: 24px; margin: 8px 0 4px; font-weight: 700;">${locationName}</h1>
                    <p style="color: #A0A0B8; font-size: 14px; margin: 0;">${dateStr}</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Sales & Orders Row -->
          <tr>
            <td style="background-color: #141428; padding: 24px 32px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <!-- Total Sales -->
                  <td width="50%" style="padding-right: 12px;">
                    <div style="background: #1A1A2E; border-radius: 12px; padding: 20px; text-align: center;">
                      <span style="color: #A0A0B8; font-size: 12px; text-transform: uppercase; letter-spacing: 1px;">Total Sales</span>
                      <p style="color: #C9A94E; font-size: 32px; font-weight: 700; margin: 8px 0 0; line-height: 1;">${formatCurrency(summary.totalSales)}</p>
                    </div>
                  </td>
                  <!-- Order Count -->
                  <td width="50%" style="padding-left: 12px;">
                    <div style="background: #1A1A2E; border-radius: 12px; padding: 20px; text-align: center;">
                      <span style="color: #A0A0B8; font-size: 12px; text-transform: uppercase; letter-spacing: 1px;">Orders</span>
                      <p style="color: #FFFFFF; font-size: 32px; font-weight: 700; margin: 8px 0 0; line-height: 1;">${summary.orderCount}</p>
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Week-over-Week -->
          <tr>
            <td style="background-color: #141428; padding: 0 32px 24px;">
              <div style="background: #1A1A2E; border-radius: 12px; padding: 20px; text-align: center;">
                <span style="color: #A0A0B8; font-size: 12px; text-transform: uppercase; letter-spacing: 1px;">Week over Week</span>
                <p style="color: ${changeColor}; font-size: 28px; font-weight: 700; margin: 8px 0 4px; line-height: 1;">${changeText}</p>
                <p style="color: #666; font-size: 13px; margin: 0;">${prevWeekText}</p>
              </div>
            </td>
          </tr>

          <!-- Top Items -->
          <tr>
            <td style="background-color: #141428; padding: 0 32px 24px;">
              <span style="color: #C9A94E; font-size: 13px; text-transform: uppercase; letter-spacing: 1px; font-weight: 600;">Top Sellers</span>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top: 12px; background: #1A1A2E; border-radius: 12px; overflow: hidden;">
                ${topItemsHtml}
              </table>
            </td>
          </tr>

          <!-- Weather -->
          ${weatherHtml ? `
          <tr>
            <td style="background-color: #141428; padding: 0 32px 24px;">
              ${weatherHtml}
            </td>
          </tr>` : ''}

          <!-- CTA Button -->
          <tr>
            <td style="background-color: #141428; padding: 8px 32px 32px; text-align: center;">
              <a href="${DASHBOARD_URL}" target="_blank" style="display: inline-block; background: linear-gradient(135deg, #C9A94E 0%, #B8962E 100%); color: #0D0D1A; font-size: 15px; font-weight: 700; text-decoration: none; padding: 14px 40px; border-radius: 8px; letter-spacing: 0.5px;">
                View Dashboard
              </a>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 32px; background: #0F0F22; border-radius: 0 0 16px 16px; text-align: center;">
              <p style="color: #555; font-size: 12px; margin: 0;">
                Sent by <span style="color: #C9A94E;">TempoAI</span> &mdash; Restaurant intelligence, delivered daily.
              </p>
              <p style="color: #444; font-size: 11px; margin: 8px 0 0;">
                Manage your digest preferences in the dashboard settings.
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

export async function sendDailySummary(
  to: string,
  summary: SummaryData,
  locationName: string,
): Promise<{ success: boolean; id?: string; error?: string }> {
  const subject = `Daily Digest — ${locationName} — ${summary.date}`;
  const html = buildHtml(summary, locationName);

  try {
    const { data, error } = await getResend().emails.send({
      from: FROM_EMAIL,
      to,
      subject,
      html,
    });

    if (error) {
      logger.error('Email', `Failed to send digest to ${to}`, error);
      return { success: false, error: error.message };
    }

    logger.info('Email', `Daily digest sent to ${to} (id: ${data?.id})`);
    return { success: true, id: data?.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Email', `Failed to send digest to ${to}`, err);
    return { success: false, error: message };
  }
}

export function buildMockSummary(): SummaryData {
  return {
    locationId: 'mock-location',
    locationName: 'The Golden Fork',
    date: new Date().toISOString().split('T')[0],
    totalSales: 4827.50,
    orderCount: 147,
    topItems: [
      { name: 'Truffle Burger', quantity: 38, revenue: 684.00 },
      { name: 'Caesar Salad', quantity: 31, revenue: 434.00 },
      { name: 'Margherita Pizza', quantity: 27, revenue: 459.00 },
    ],
    laborCostPct: null,
    prevWeekSales: 4215.00,
    prevWeekOrders: 132,
    changePercent: 14.5,
    weatherNote: 'Partly Cloudy, 72°F, no precipitation',
  };
}
