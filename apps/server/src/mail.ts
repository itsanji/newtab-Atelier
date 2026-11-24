import nodemailer from 'nodemailer';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface MailTransport {
  send(message: MailMessage): Promise<void>;
}

/** Sends through an SMTP server, e.g. `smtp://user:pass@host:587`. */
export function smtpTransport(url: string, from: string): MailTransport {
  const transporter = nodemailer.createTransport(url);
  return {
    async send(message) {
      await transporter.sendMail({ from, ...message });
    },
  };
}

/** Collects messages instead of sending them; used by tests. */
export function memoryTransport(): MailTransport & { sent: MailMessage[] } {
  const sent: MailMessage[] = [];
  return {
    sent,
    async send(message) {
      sent.push(message);
    },
  };
}
