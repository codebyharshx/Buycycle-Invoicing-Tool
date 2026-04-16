/**
 * Email Service
 *
 * Handles sending transactional emails using Resend.
 */

import { Resend } from 'resend';
import logger from '../utils/logger';

// Initialize Resend client
const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

// Email configuration
const FROM_EMAIL = process.env.EMAIL_FROM || 'noreply@buycycle.com';
const APP_NAME = process.env.APP_NAME || 'Buycycle Invoicing';
const APP_URL = process.env.APP_URL || 'http://localhost:3007';

/**
 * Check if email service is configured
 */
export function isEmailConfigured(): boolean {
  return !!resend;
}

/**
 * Send a password reset email
 */
export async function sendPasswordResetEmail(
  to: string,
  userName: string | null,
  resetToken: string
): Promise<boolean> {
  if (!resend) {
    logger.warn('Email service not configured - RESEND_API_KEY missing');
    // In development, log the reset link instead
    const resetUrl = `${APP_URL}/reset-password?token=${resetToken}`;
    logger.info({ to, resetUrl }, 'Password reset link (email not sent - no API key)');
    return true; // Return true in dev so the flow continues
  }

  const resetUrl = `${APP_URL}/reset-password?token=${resetToken}`;
  const greeting = userName ? `Hi ${userName}` : 'Hi';

  try {
    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: [to],
      subject: `Reset your ${APP_NAME} password`,
      html: `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Reset Your Password</title>
          </head>
          <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: #f8f9fa; border-radius: 8px; padding: 30px; margin-bottom: 20px;">
              <h1 style="color: #2596be; margin: 0 0 20px 0; font-size: 24px;">
                ${APP_NAME}
              </h1>
              <p style="margin: 0 0 15px 0; font-size: 16px;">
                ${greeting},
              </p>
              <p style="margin: 0 0 15px 0;">
                We received a request to reset your password. Click the button below to create a new password:
              </p>
              <div style="text-align: center; margin: 30px 0;">
                <a href="${resetUrl}"
                   style="background-color: #2596be; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: 600; display: inline-block;">
                  Reset Password
                </a>
              </div>
              <p style="margin: 0 0 15px 0; font-size: 14px; color: #666;">
                This link will expire in 1 hour for security reasons.
              </p>
              <p style="margin: 0 0 15px 0; font-size: 14px; color: #666;">
                If you didn't request this password reset, you can safely ignore this email. Your password will remain unchanged.
              </p>
              <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">
              <p style="margin: 0; font-size: 12px; color: #999;">
                If the button doesn't work, copy and paste this link into your browser:<br>
                <a href="${resetUrl}" style="color: #2596be; word-break: break-all;">${resetUrl}</a>
              </p>
            </div>
            <p style="text-align: center; font-size: 12px; color: #999; margin: 0;">
              © ${new Date().getFullYear()} ${APP_NAME}. All rights reserved.
            </p>
          </body>
        </html>
      `,
      text: `
${greeting},

We received a request to reset your password for ${APP_NAME}.

Click the link below to reset your password:
${resetUrl}

This link will expire in 1 hour for security reasons.

If you didn't request this password reset, you can safely ignore this email. Your password will remain unchanged.

© ${new Date().getFullYear()} ${APP_NAME}
      `.trim(),
    });

    if (error) {
      logger.error({ error, to }, 'Failed to send password reset email');
      return false;
    }

    logger.info({ to }, 'Password reset email sent');
    return true;
  } catch (error) {
    logger.error({ error, to }, 'Error sending password reset email');
    return false;
  }
}

/**
 * Send a password changed confirmation email
 */
export async function sendPasswordChangedEmail(
  to: string,
  userName: string | null
): Promise<boolean> {
  if (!resend) {
    logger.warn('Email service not configured - skipping password changed notification');
    return true;
  }

  const greeting = userName ? `Hi ${userName}` : 'Hi';

  try {
    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: [to],
      subject: `Your ${APP_NAME} password was changed`,
      html: `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
          </head>
          <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: #f8f9fa; border-radius: 8px; padding: 30px;">
              <h1 style="color: #2596be; margin: 0 0 20px 0; font-size: 24px;">
                ${APP_NAME}
              </h1>
              <p style="margin: 0 0 15px 0; font-size: 16px;">
                ${greeting},
              </p>
              <p style="margin: 0 0 15px 0;">
                Your password has been successfully changed.
              </p>
              <p style="margin: 0 0 15px 0; font-size: 14px; color: #666;">
                If you did not make this change, please contact support immediately.
              </p>
            </div>
          </body>
        </html>
      `,
      text: `
${greeting},

Your password for ${APP_NAME} has been successfully changed.

If you did not make this change, please contact support immediately.

© ${new Date().getFullYear()} ${APP_NAME}
      `.trim(),
    });

    if (error) {
      logger.error({ error, to }, 'Failed to send password changed email');
      return false;
    }

    logger.info({ to }, 'Password changed email sent');
    return true;
  } catch (error) {
    logger.error({ error, to }, 'Error sending password changed email');
    return false;
  }
}
