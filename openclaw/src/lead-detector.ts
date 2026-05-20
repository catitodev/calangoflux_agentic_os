/**
 * Lead Detection Module
 *
 * Scans conversation messages for contact information (email, phone)
 * and interest keywords to detect potential leads. Persists detected
 * leads and notifies the admin dashboard.
 */

// === Types ===

export interface LeadInfo {
  name?: string;
  contact: string;
  interest: string;
  conversationId: string;
  detectedAt: Date;
}

export interface LeadStorage {
  persistLead(lead: LeadInfo): Promise<string>;
  notifyAdmin(lead: LeadInfo): Promise<void>;
}

// === Constants ===

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
const PHONE_REGEX = /(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,3}\)?[-.\s]?\d{4,5}[-.\s]?\d{4}/;

const INTEREST_KEYWORDS = [
  'preço',
  'quanto custa',
  'contratar',
  'serviço',
  'orçamento',
  'proposta',
] as const;

// === LeadDetector ===

export class LeadDetector {
  /**
   * Scans a message for contact information (email/phone) or interest keywords.
   * Returns LeadInfo if any indicator is found, null otherwise.
   */
  detectLead(message: string, sessionId: string): LeadInfo | null {
    const lowerMessage = message.toLowerCase();

    const email = message.match(EMAIL_REGEX)?.[0] ?? null;
    const phone = message.match(PHONE_REGEX)?.[0] ?? null;
    const interest = INTEREST_KEYWORDS.find((kw) => lowerMessage.includes(kw)) ?? null;

    const contact = email ?? phone ?? null;

    if (!contact && !interest) {
      return null;
    }

    return {
      contact: contact ?? '',
      interest: interest ?? '',
      conversationId: sessionId,
      detectedAt: new Date(),
    };
  }

  /**
   * Processes a message: detects lead, persists if found, and notifies admin.
   * Returns the persisted lead ID if a lead was detected, null otherwise.
   */
  async processMessage(
    message: string,
    sessionId: string,
    storage: LeadStorage,
  ): Promise<string | null> {
    const lead = this.detectLead(message, sessionId);

    if (!lead) {
      return null;
    }

    const leadId = await storage.persistLead(lead);
    await storage.notifyAdmin(lead);

    return leadId;
  }
}
