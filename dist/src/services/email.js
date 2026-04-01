"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendDailySummary = sendDailySummary;
exports.sendWelcomeEmail = sendWelcomeEmail;
exports.sendNewLeadNotification = sendNewLeadNotification;
exports.sendPasswordResetEmail = sendPasswordResetEmail;
exports.sendVerificationEmail = sendVerificationEmail;
exports.buildMockSummary = buildMockSummary;
const resend_1 = require("resend");
const logger_1 = require("../utils/logger");
function getResend() {
    const key = process.env.RESEND_API_KEY;
    if (!key)
        throw new Error('RESEND_API_KEY is not set');
    return new resend_1.Resend(key);
}
const DASHBOARD_URL = 'https://usetempoai.com';
const FROM_EMAIL = 'TempoAi <hello@usetempoai.com>';
function formatCurrency(amount) {
    return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function buildHtml(summary, locationName) {
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
    // Build promo recommendations HTML
    const promos = summary.promoRecommendations || [];
    const promosHtml = promos.length > 0 ? `
          <tr>
            <td style="background-color: #141428; padding: 0 32px 24px;">
              <span style="color: #4ADE80; font-size: 13px; text-transform: uppercase; letter-spacing: 1px; font-weight: 600;">&#127919; Today's Promos</span>
              ${promos.map((p, i) => `
              <div style="background: #1A1A2E; border-radius: 10px; padding: 16px 20px; margin-top: ${i === 0 ? '12' : '8'}px; border-left: 3px solid #4ADE80;">
                <p style="color: #FFFFFF; font-size: 15px; font-weight: 600; margin: 0 0 4px;">${p.itemName} <span style="color: #4ADE80; font-size: 13px;">(+${p.expectedLift.toFixed(0)}% expected)</span></p>
                <p style="color: #A0A0B8; font-size: 14px; margin: 0;">${p.promoSuggestion}</p>
              </div>`).join('')}
            </td>
          </tr>` : '';
    // Build upsell tip HTML
    const upsell = summary.upsellTip;
    const upsellHtml = upsell ? `
          <tr>
            <td style="background-color: #141428; padding: 0 32px 24px;">
              <div style="background: #1A1A2E; border-radius: 10px; padding: 16px 20px; border-left: 3px solid #F59E0B;">
                <span style="color: #F59E0B; font-size: 13px; text-transform: uppercase; letter-spacing: 1px;">&#128161; Upsell Tip</span>
                <p style="color: #FFFFFF; font-size: 15px; font-weight: 600; margin: 8px 0 4px;">When customers order: ${upsell.baseItem}</p>
                <p style="color: #A0A0B8; font-size: 14px; margin: 0;">Suggest: <span style="color: #F59E0B; font-weight: 600;">${upsell.suggestItem}</span></p>
                <p style="color: #888; font-size: 13px; margin: 6px 0 0;">${upsell.reason}</p>
              </div>
            </td>
          </tr>` : '';
    // Build staffing note HTML
    const staffing = summary.staffingNote;
    const staffingHtml = staffing ? `
          <tr>
            <td style="background-color: #141428; padding: 0 32px 24px;">
              <div style="background: #1A1A2E; border-radius: 10px; padding: 16px 20px; border-left: 3px solid #8B5CF6;">
                <span style="color: #8B5CF6; font-size: 13px; text-transform: uppercase; letter-spacing: 1px;">&#128101; Staffing</span>
                <p style="color: #FFFFFF; font-size: 15px; margin: 8px 0 4px;">${staffing.message}</p>
                <p style="color: #A0A0B8; font-size: 14px; margin: 0;">&#10145; ${staffing.action}</p>
              </div>
            </td>
          </tr>` : '';
    // Build underperformers HTML
    const underperformers = summary.underperformers || [];
    const underperformersHtml = underperformers.length > 0 ? `
          <tr>
            <td style="background-color: #141428; padding: 0 32px 24px;">
              <span style="color: #F87171; font-size: 13px; text-transform: uppercase; letter-spacing: 1px; font-weight: 600;">&#9888; Menu Watch</span>
              ${underperformers.map(u => `
              <div style="background: #1A1A2E; border-radius: 10px; padding: 12px 20px; margin-top: 8px; border-left: 3px solid #F87171;">
                <p style="color: #FFFFFF; font-size: 15px; margin: 0;"><span style="color: #F87171; font-weight: 600;">${u.name}</span> — sold ${u.soldYesterday} yesterday vs. ${u.avgSold} daily avg</p>
              </div>`).join('')}
            </td>
          </tr>` : '';
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


          <!-- Today's Promos -->
          ${promosHtml}

          <!-- Upsell Tip -->
          ${upsellHtml}

          <!-- Staffing Note -->
          ${staffingHtml}

          <!-- Underperformers -->
          ${underperformersHtml}

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
async function sendDailySummary(to, summary, locationName) {
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
            logger_1.logger.error('Email', `Failed to send digest to ${to}`, error);
            return { success: false, error: error.message };
        }
        logger_1.logger.info('Email', `Daily digest sent to ${to} (id: ${data?.id})`);
        return { success: true, id: data?.id };
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger_1.logger.error('Email', `Failed to send digest to ${to}`, err);
        return { success: false, error: message };
    }
}
// ─── Welcome Email (new signup via get-started form) ─────────────
async function sendWelcomeEmail(to, name, tempPassword, verificationToken) {
    const loginUrl = `${DASHBOARD_URL}/login`;
    const onboardUrl = `${DASHBOARD_URL}/onboard`;
    const verifyUrl = `${DASHBOARD_URL}/verify-email?token=${verificationToken}`;
    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#0D0D1A;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#0D0D1A;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;">
        <tr><td style="padding:32px;background:linear-gradient(135deg,#1A1A2E 0%,#16162A 100%);border-radius:16px 16px 0 0;border-bottom:2px solid #60A5FA;">
          <span style="color:#60A5FA;font-size:13px;text-transform:uppercase;letter-spacing:2px;font-weight:600;">Welcome to TempoAI</span>
          <h1 style="color:#FFFFFF;font-size:24px;margin:8px 0 4px;font-weight:700;">Hey ${name}!</h1>
          <p style="color:#A0A0B8;font-size:15px;margin:0;">Your account is ready. Here&rsquo;s how to get started.</p>
        </td></tr>
        <tr><td style="background-color:#141428;padding:24px 32px;">
          <div style="background:#1A1A2E;border-radius:12px;padding:20px;margin-bottom:16px;">
            <span style="color:#A0A0B8;font-size:12px;text-transform:uppercase;letter-spacing:1px;">Your Temporary Password</span>
            <p style="color:#60A5FA;font-size:24px;font-weight:700;margin:8px 0 0;font-family:monospace;letter-spacing:2px;">${tempPassword}</p>
          </div>
          <p style="color:#A0A0B8;font-size:14px;margin:0 0 8px;">Please change this password after your first login.</p>
        </td></tr>
        <tr><td style="background-color:#141428;padding:0 32px 24px;">
          <h2 style="color:#FFFFFF;font-size:18px;margin:0 0 16px;">Next Steps</h2>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
            <tr><td style="padding:12px 16px;background:#1A1A2E;border-radius:8px;margin-bottom:8px;">
              <span style="color:#60A5FA;font-weight:700;font-size:16px;">1.</span>
              <span style="color:#E0E0E0;font-size:15px;margin-left:8px;">Log in at <a href="${loginUrl}" style="color:#60A5FA;text-decoration:none;">${loginUrl}</a></span>
            </td></tr>
            <tr><td style="height:8px;"></td></tr>
            <tr><td style="padding:12px 16px;background:#1A1A2E;border-radius:8px;">
              <span style="color:#60A5FA;font-weight:700;font-size:16px;">2.</span>
              <span style="color:#E0E0E0;font-size:15px;margin-left:8px;">Connect your POS system in the <a href="${onboardUrl}" style="color:#60A5FA;text-decoration:none;">onboarding wizard</a></span>
            </td></tr>
            <tr><td style="height:8px;"></td></tr>
            <tr><td style="padding:12px 16px;background:#1A1A2E;border-radius:8px;">
              <span style="color:#60A5FA;font-weight:700;font-size:16px;">3.</span>
              <span style="color:#E0E0E0;font-size:15px;margin-left:8px;">Verify your email: <a href="${verifyUrl}" style="color:#60A5FA;text-decoration:none;">Click here to verify</a></span>
            </td></tr>
          </table>
        </td></tr>
        <tr><td style="background-color:#141428;padding:8px 32px 32px;text-align:center;">
          <a href="${onboardUrl}" style="display:inline-block;background:linear-gradient(135deg,#3B82F6 0%,#2563EB 100%);color:#FFFFFF;font-size:15px;font-weight:700;text-decoration:none;padding:14px 40px;border-radius:8px;letter-spacing:0.5px;">
            Start Onboarding
          </a>
        </td></tr>
        <tr><td style="padding:24px 32px;background:#0F0F22;border-radius:0 0 16px 16px;text-align:center;">
          <p style="color:#555;font-size:12px;margin:0;">Sent by <span style="color:#60A5FA;">TempoAI</span> &mdash; AI-powered restaurant intelligence.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
    try {
        const { data, error } = await getResend().emails.send({
            from: FROM_EMAIL,
            to,
            subject: 'Welcome to TempoAI — Your account is ready!',
            html,
        });
        if (error) {
            logger_1.logger.error('Email', `Failed to send welcome email to ${to}`, error);
            return { success: false, error: error.message };
        }
        logger_1.logger.info('Email', `Welcome email sent to ${to} (id: ${data?.id})`);
        return { success: true, id: data?.id };
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger_1.logger.error('Email', `Failed to send welcome email to ${to}`, err);
        return { success: false, error: message };
    }
}
// ─── New Lead Notification (to Chuck) ────────────────────────────
async function sendNewLeadNotification(lead) {
    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background-color:#0D0D1A;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#0D0D1A;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;">
        <tr><td style="padding:32px;background:linear-gradient(135deg,#1A1A2E 0%,#16162A 100%);border-radius:16px;border-left:4px solid #4ADE80;">
          <span style="color:#4ADE80;font-size:13px;text-transform:uppercase;letter-spacing:2px;font-weight:600;">New Lead Signed Up</span>
          <h1 style="color:#FFFFFF;font-size:22px;margin:12px 0 16px;font-weight:700;">${lead.restaurant}</h1>
          <table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;">
            <tr><td style="color:#A0A0B8;font-size:13px;padding:4px 0;">Name:</td><td style="color:#E0E0E0;font-size:14px;padding:4px 0 4px 12px;">${lead.name}</td></tr>
            <tr><td style="color:#A0A0B8;font-size:13px;padding:4px 0;">Email:</td><td style="color:#E0E0E0;font-size:14px;padding:4px 0 4px 12px;">${lead.email}</td></tr>
            <tr><td style="color:#A0A0B8;font-size:13px;padding:4px 0;">Phone:</td><td style="color:#E0E0E0;font-size:14px;padding:4px 0 4px 12px;">${lead.phone || 'Not provided'}</td></tr>
            <tr><td style="color:#A0A0B8;font-size:13px;padding:4px 0;">Locations:</td><td style="color:#E0E0E0;font-size:14px;padding:4px 0 4px 12px;">${lead.locations}</td></tr>
            <tr><td style="color:#A0A0B8;font-size:13px;padding:4px 0;">POS:</td><td style="color:#E0E0E0;font-size:14px;padding:4px 0 4px 12px;">${lead.pos}</td></tr>
            <tr><td style="color:#A0A0B8;font-size:13px;padding:4px 0;">Notes:</td><td style="color:#E0E0E0;font-size:14px;padding:4px 0 4px 12px;">${lead.notes || 'None'}</td></tr>
          </table>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
    try {
        const { error } = await getResend().emails.send({
            from: FROM_EMAIL,
            to: 'ccoppola14@gmail.com',
            subject: `New TempoAI Lead: ${lead.restaurant}`,
            html,
        });
        if (error) {
            logger_1.logger.error('Email', 'Failed to send lead notification', error);
            return { success: false, error: error.message };
        }
        logger_1.logger.info('Email', `Lead notification sent for ${lead.restaurant}`);
        return { success: true };
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger_1.logger.error('Email', 'Failed to send lead notification', err);
        return { success: false, error: message };
    }
}
// ─── Password Reset Email ────────────────────────────────────────
async function sendPasswordResetEmail(to, name, resetToken) {
    const resetUrl = `${DASHBOARD_URL}/reset-password?token=${resetToken}`;
    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#0D0D1A;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#0D0D1A;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;">
        <tr><td style="padding:32px;background:linear-gradient(135deg,#1A1A2E 0%,#16162A 100%);border-radius:16px 16px 0 0;border-bottom:2px solid #60A5FA;">
          <span style="color:#60A5FA;font-size:13px;text-transform:uppercase;letter-spacing:2px;font-weight:600;">Password Reset</span>
          <h1 style="color:#FFFFFF;font-size:24px;margin:8px 0 4px;font-weight:700;">Hi ${name},</h1>
          <p style="color:#A0A0B8;font-size:15px;margin:0;">We received a request to reset your password.</p>
        </td></tr>
        <tr><td style="background-color:#141428;padding:24px 32px;">
          <p style="color:#E0E0E0;font-size:15px;margin:0 0 20px;">Click the button below to set a new password. This link expires in 1 hour.</p>
          <div style="text-align:center;">
            <a href="${resetUrl}" style="display:inline-block;background:linear-gradient(135deg,#3B82F6 0%,#2563EB 100%);color:#FFFFFF;font-size:15px;font-weight:700;text-decoration:none;padding:14px 40px;border-radius:8px;letter-spacing:0.5px;">
              Reset Password
            </a>
          </div>
          <p style="color:#666;font-size:13px;margin:20px 0 0;text-align:center;">If you didn&rsquo;t request this, you can safely ignore this email.</p>
        </td></tr>
        <tr><td style="padding:24px 32px;background:#0F0F22;border-radius:0 0 16px 16px;text-align:center;">
          <p style="color:#555;font-size:12px;margin:0;">Sent by <span style="color:#60A5FA;">TempoAI</span></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
    try {
        const { data, error } = await getResend().emails.send({
            from: FROM_EMAIL,
            to,
            subject: 'Reset your TempoAI password',
            html,
        });
        if (error) {
            logger_1.logger.error('Email', `Failed to send reset email to ${to}`, error);
            return { success: false, error: error.message };
        }
        logger_1.logger.info('Email', `Password reset email sent to ${to} (id: ${data?.id})`);
        return { success: true, id: data?.id };
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger_1.logger.error('Email', `Failed to send reset email to ${to}`, err);
        return { success: false, error: message };
    }
}
// ─── Email Verification Email ────────────────────────────────────
async function sendVerificationEmail(to, name, verificationToken) {
    const verifyUrl = `${DASHBOARD_URL}/verify-email?token=${verificationToken}`;
    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#0D0D1A;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#0D0D1A;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;">
        <tr><td style="padding:32px;background:linear-gradient(135deg,#1A1A2E 0%,#16162A 100%);border-radius:16px 16px 0 0;border-bottom:2px solid #60A5FA;">
          <span style="color:#60A5FA;font-size:13px;text-transform:uppercase;letter-spacing:2px;font-weight:600;">Verify Your Email</span>
          <h1 style="color:#FFFFFF;font-size:24px;margin:8px 0 4px;font-weight:700;">Hi ${name},</h1>
          <p style="color:#A0A0B8;font-size:15px;margin:0;">Please verify your email address to complete your account setup.</p>
        </td></tr>
        <tr><td style="background-color:#141428;padding:24px 32px;text-align:center;">
          <a href="${verifyUrl}" style="display:inline-block;background:linear-gradient(135deg,#3B82F6 0%,#2563EB 100%);color:#FFFFFF;font-size:15px;font-weight:700;text-decoration:none;padding:14px 40px;border-radius:8px;letter-spacing:0.5px;">
            Verify Email Address
          </a>
          <p style="color:#666;font-size:13px;margin:20px 0 0;">If you didn&rsquo;t create this account, you can safely ignore this email.</p>
        </td></tr>
        <tr><td style="padding:24px 32px;background:#0F0F22;border-radius:0 0 16px 16px;text-align:center;">
          <p style="color:#555;font-size:12px;margin:0;">Sent by <span style="color:#60A5FA;">TempoAI</span></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
    try {
        const { data, error } = await getResend().emails.send({
            from: FROM_EMAIL,
            to,
            subject: 'Verify your TempoAI email address',
            html,
        });
        if (error) {
            logger_1.logger.error('Email', `Failed to send verification email to ${to}`, error);
            return { success: false, error: error.message };
        }
        logger_1.logger.info('Email', `Verification email sent to ${to} (id: ${data?.id})`);
        return { success: true, id: data?.id };
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger_1.logger.error('Email', `Failed to send verification email to ${to}`, err);
        return { success: false, error: message };
    }
}
function buildMockSummary() {
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
        weatherImpactNote: 'clear skies boosting patio/walk-in traffic (~+5%)',
        topRecommendation: 'PROMOTE: Truffle Burger — strong lunch performer on clear days (expected +23%)',
        beforeAfterSnippet: 'Since TempoAi (45d): avg daily revenue up 12.3% ($3,200 -> $3,594)',
        upcomingEvents: null,
        promoRecommendations: [
            {
                itemName: 'Truffle Burger',
                message: 'Strong lunch performer on clear days',
                expectedLift: 23,
                triggerType: 'weather',
                triggerCondition: 'clear',
                promoSuggestion: 'Good weather play: Pair Truffle Burger with a cold drink combo',
            },
            {
                itemName: 'Margherita Pizza',
                message: 'Trending up this week across all dayparts',
                expectedLift: 15,
                triggerType: 'trend',
                triggerCondition: 'trending_up',
                promoSuggestion: 'Margherita Pizza is trending up \u2014 ride the momentum with extra visibility',
            },
        ],
        upsellTip: {
            baseItem: 'Truffle Burger',
            suggestItem: 'Sweet Potato Fries',
            reason: 'Suggest "Sweet Potato Fries" ($5.99) with every "Truffle Burger" order \u2014 easy ticket bump',
        },
        staffingNote: {
            message: 'Beautiful weather \u2014 expect higher than normal foot traffic',
            action: 'Make sure you\'re fully staffed through the afternoon. Patio/outdoor seating will be busy',
        },
        underperformers: [
            { name: 'Veggie Wrap', soldYesterday: 3, avgSold: 18 },
        ],
    };
}
//# sourceMappingURL=email.js.map