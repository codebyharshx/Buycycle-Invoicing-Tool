/**
 * Email Fetcher Service
 *
 * IMAP email polling service for fetching invoice attachments.
 * Uses imap-simple for connection management and mailparser for parsing.
 */

import imaps, { ImapSimple, Message } from 'imap-simple';
import { simpleParser, ParsedMail, Attachment } from 'mailparser';
import { logger } from '../utils/logger';

interface MailboxInfo {
  messages: {
    total: number;
    unseen?: number;
  };
}

export interface ImapConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  folder?: string;
  tls?: boolean;
  tlsOptions?: {
    rejectUnauthorized?: boolean;
  };
}

export interface EmailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
  size: number;
}

export interface FetchedEmail {
  messageId: string;
  uid: number;
  from: string;
  subject: string;
  date: Date;
  attachments: EmailAttachment[];
}

// Allowed attachment types for invoices
const ALLOWED_ATTACHMENT_TYPES = [
  'application/pdf',
  'text/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/png',
  'image/jpeg',
];

const ALLOWED_EXTENSIONS = ['.pdf', '.csv', '.xls', '.xlsx', '.png', '.jpg', '.jpeg'];

/**
 * Test IMAP connection with provided credentials
 */
export async function testImapConnection(config: ImapConfig): Promise<{
  success: boolean;
  message: string;
  folderInfo?: {
    name: string;
    totalMessages: number;
    unseenMessages: number;
  };
}> {
  let connection: imaps.ImapSimple | null = null;

  try {
    const imapConfig: imaps.ImapSimpleOptions = {
      imap: {
        user: config.user,
        password: config.password,
        host: config.host,
        port: config.port,
        tls: config.tls !== false,
        tlsOptions: config.tlsOptions || { rejectUnauthorized: true },
        authTimeout: 30000,
        connTimeout: 30000,
      },
    };

    logger.info(
      { host: config.host, port: config.port, user: config.user },
      'Testing IMAP connection'
    );

    connection = await imaps.connect(imapConfig);

    // Open the specified folder or INBOX
    const folder = config.folder || 'INBOX';
    const box = await connection.openBox(folder) as unknown as MailboxInfo;

    logger.info(
      { folder, totalMessages: box.messages.total, unseenMessages: box.messages.unseen },
      'IMAP connection successful'
    );

    return {
      success: true,
      message: `Connected successfully to ${config.host}`,
      folderInfo: {
        name: folder,
        totalMessages: box.messages.total,
        unseenMessages: box.messages.unseen || 0,
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ error: errorMessage, host: config.host }, 'IMAP connection test failed');

    return {
      success: false,
      message: `Connection failed: ${errorMessage}`,
    };
  } finally {
    if (connection) {
      try {
        connection.end();
      } catch {
        // Ignore close errors
      }
    }
  }
}

/**
 * Check if an attachment is an allowed invoice file type
 */
function isAllowedAttachment(attachment: Attachment): boolean {
  const contentType = attachment.contentType?.toLowerCase() || '';
  const filename = attachment.filename?.toLowerCase() || '';

  // Check by content type
  if (ALLOWED_ATTACHMENT_TYPES.some(type => contentType.includes(type))) {
    return true;
  }

  // Check by file extension
  if (ALLOWED_EXTENSIONS.some(ext => filename.endsWith(ext))) {
    return true;
  }

  return false;
}

/**
 * Parse a raw email message and extract invoice attachments
 */
async function parseEmail(rawEmail: string, uid: number): Promise<FetchedEmail | null> {
  try {
    const parsed: ParsedMail = await simpleParser(rawEmail);

    const messageId = parsed.messageId || `unknown-${uid}-${Date.now()}`;
    const from = parsed.from?.text || 'unknown';
    const subject = parsed.subject || 'No subject';
    const date = parsed.date || new Date();

    // Extract allowed attachments
    const attachments: EmailAttachment[] = [];

    if (parsed.attachments && parsed.attachments.length > 0) {
      for (const attachment of parsed.attachments) {
        if (isAllowedAttachment(attachment)) {
          attachments.push({
            filename: attachment.filename || `attachment-${attachments.length + 1}`,
            content: attachment.content,
            contentType: attachment.contentType || 'application/octet-stream',
            size: attachment.size || attachment.content.length,
          });
        }
      }
    }

    logger.debug(
      {
        messageId,
        from,
        subject,
        totalAttachments: parsed.attachments?.length || 0,
        invoiceAttachments: attachments.length,
      },
      'Parsed email'
    );

    return {
      messageId,
      uid,
      from,
      subject,
      date,
      attachments,
    };
  } catch (error) {
    logger.error({ error, uid }, 'Failed to parse email');
    return null;
  }
}

/**
 * Fetch new (unseen) emails from IMAP server
 */
export async function fetchNewEmails(
  config: ImapConfig,
  options: {
    limit?: number;
    markAsSeen?: boolean;
    sinceDate?: Date;
  } = {}
): Promise<{
  success: boolean;
  emails: FetchedEmail[];
  error?: string;
}> {
  let connection: imaps.ImapSimple | null = null;
  const emails: FetchedEmail[] = [];

  try {
    const imapConfig: imaps.ImapSimpleOptions = {
      imap: {
        user: config.user,
        password: config.password,
        host: config.host,
        port: config.port,
        tls: config.tls !== false,
        tlsOptions: config.tlsOptions || { rejectUnauthorized: true },
        authTimeout: 30000,
        connTimeout: 30000,
      },
    };

    logger.info({ host: config.host, folder: config.folder || 'INBOX' }, 'Fetching new emails');

    connection = await imaps.connect(imapConfig);

    // Open folder
    const folder = config.folder || 'INBOX';
    await connection.openBox(folder);

    // Build search criteria
    const searchCriteria: (string | string[])[] = ['UNSEEN'];
    if (options.sinceDate) {
      searchCriteria.push(['SINCE', options.sinceDate.toISOString().split('T')[0]]);
    }

    // Fetch unseen emails with body
    const fetchOptions = {
      bodies: [''],
      markSeen: options.markAsSeen !== false, // Default to marking as seen
    };

    const messages = await connection.search(searchCriteria, fetchOptions);

    logger.info({ messageCount: messages.length }, 'Found unseen emails');

    // Limit messages if specified
    const messagesToProcess = options.limit ? messages.slice(0, options.limit) : messages;

    // Parse each message
    for (const message of messagesToProcess) {
      const uid = message.attributes.uid;
      const bodyPart = message.parts.find(part => part.which === '');

      if (bodyPart) {
        const parsed = await parseEmail(bodyPart.body, uid);
        if (parsed && parsed.attachments.length > 0) {
          emails.push(parsed);
        }
      }
    }

    logger.info(
      { totalMessages: messagesToProcess.length, emailsWithAttachments: emails.length },
      'Email fetch completed'
    );

    return {
      success: true,
      emails,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ error: errorMessage, host: config.host }, 'Failed to fetch emails');

    return {
      success: false,
      emails: [],
      error: errorMessage,
    };
  } finally {
    if (connection) {
      try {
        connection.end();
      } catch {
        // Ignore close errors
      }
    }
  }
}

/**
 * Mark specific emails as seen/processed
 */
export async function markEmailsAsSeen(
  config: ImapConfig,
  uids: number[]
): Promise<{ success: boolean; error?: string }> {
  let connection: imaps.ImapSimple | null = null;

  try {
    const imapConfig: imaps.ImapSimpleOptions = {
      imap: {
        user: config.user,
        password: config.password,
        host: config.host,
        port: config.port,
        tls: config.tls !== false,
        tlsOptions: config.tlsOptions || { rejectUnauthorized: true },
        authTimeout: 30000,
        connTimeout: 30000,
      },
    };

    connection = await imaps.connect(imapConfig);

    const folder = config.folder || 'INBOX';
    await connection.openBox(folder);

    // Add \Seen flag to messages
    for (const uid of uids) {
      // Type assertion needed as imap-simple types are inconsistent
      await (connection as any).addFlags(uid, ['\\Seen']);
    }

    logger.info({ uids, folder }, 'Marked emails as seen');

    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ error: errorMessage, uids }, 'Failed to mark emails as seen');

    return { success: false, error: errorMessage };
  } finally {
    if (connection) {
      try {
        connection.end();
      } catch {
        // Ignore close errors
      }
    }
  }
}

/**
 * Move emails to a processed/archive folder
 */
export async function moveEmailsToFolder(
  config: ImapConfig,
  uids: number[],
  targetFolder: string
): Promise<{ success: boolean; error?: string }> {
  let connection: imaps.ImapSimple | null = null;

  try {
    const imapConfig: imaps.ImapSimpleOptions = {
      imap: {
        user: config.user,
        password: config.password,
        host: config.host,
        port: config.port,
        tls: config.tls !== false,
        tlsOptions: config.tlsOptions || { rejectUnauthorized: true },
        authTimeout: 30000,
        connTimeout: 30000,
      },
    };

    connection = await imaps.connect(imapConfig);

    const folder = config.folder || 'INBOX';
    await connection.openBox(folder);

    // Move messages to target folder
    for (const uid of uids) {
      // Type assertion needed as imap-simple types are inconsistent
      await (connection as any).moveMessage(uid, targetFolder);
    }

    logger.info({ uids, targetFolder }, 'Moved emails to folder');

    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ error: errorMessage, uids, targetFolder }, 'Failed to move emails');

    return { success: false, error: errorMessage };
  } finally {
    if (connection) {
      try {
        connection.end();
      } catch {
        // Ignore close errors
      }
    }
  }
}

/**
 * Get IMAP config from environment variables
 */
export function getImapConfigFromEnv(): ImapConfig | null {
  const host = process.env.INVOICE_IMAP_HOST;
  const user = process.env.INVOICE_IMAP_USER;
  const password = process.env.INVOICE_IMAP_PASSWORD;

  if (!host || !user || !password) {
    return null;
  }

  return {
    host,
    port: parseInt(process.env.INVOICE_IMAP_PORT || '993', 10),
    user,
    password,
    folder: process.env.INVOICE_IMAP_FOLDER || 'INBOX',
    tls: true,
    tlsOptions: {
      rejectUnauthorized: process.env.INVOICE_IMAP_REJECT_UNAUTHORIZED !== 'false',
    },
  };
}
