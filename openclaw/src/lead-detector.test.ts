import { describe, it, expect, vi } from 'vitest';
import { LeadDetector, LeadInfo, LeadStorage } from './lead-detector.js';

// === Test Helpers ===

function createMockStorage(): LeadStorage & {
  persistLead: ReturnType<typeof vi.fn>;
  notifyAdmin: ReturnType<typeof vi.fn>;
} {
  return {
    persistLead: vi.fn().mockResolvedValue('lead-uuid-001'),
    notifyAdmin: vi.fn().mockResolvedValue(undefined),
  };
}

// === Tests ===

describe('LeadDetector', () => {
  describe('detectLead - email detection', () => {
    it('should detect a valid email address', () => {
      const detector = new LeadDetector();
      const result = detector.detectLead('Meu email é joao@empresa.com.br', 'session-1');

      expect(result).not.toBeNull();
      expect(result!.contact).toBe('joao@empresa.com.br');
      expect(result!.conversationId).toBe('session-1');
    });

    it('should detect email with subdomains', () => {
      const detector = new LeadDetector();
      const result = detector.detectLead('Contato: user@mail.corp.io', 'session-2');

      expect(result).not.toBeNull();
      expect(result!.contact).toBe('user@mail.corp.io');
    });

    it('should detect email with special characters', () => {
      const detector = new LeadDetector();
      const result = detector.detectLead('Email: nome.sobre+tag@dominio.com', 'session-3');

      expect(result).not.toBeNull();
      expect(result!.contact).toBe('nome.sobre+tag@dominio.com');
    });
  });

  describe('detectLead - phone detection', () => {
    it('should detect Brazilian phone number with country code', () => {
      const detector = new LeadDetector();
      const result = detector.detectLead('Me liga no +55 11 99999-1234', 'session-4');

      expect(result).not.toBeNull();
      expect(result!.contact).toBe('+55 11 99999-1234');
    });

    it('should detect phone number without country code', () => {
      const detector = new LeadDetector();
      const result = detector.detectLead('Meu número é (11) 98765-4321', 'session-5');

      expect(result).not.toBeNull();
      expect(result!.contact).toBe('(11) 98765-4321');
    });

    it('should detect phone number with dots as separator', () => {
      const detector = new LeadDetector();
      const result = detector.detectLead('Telefone: 11.99999.1234', 'session-6');

      expect(result).not.toBeNull();
      expect(result!.contact).toBe('11.99999.1234');
    });
  });

  describe('detectLead - interest keyword detection', () => {
    it('should detect "preço" keyword', () => {
      const detector = new LeadDetector();
      const result = detector.detectLead('Qual o preço do plano básico?', 'session-7');

      expect(result).not.toBeNull();
      expect(result!.interest).toBe('preço');
    });

    it('should detect "quanto custa" keyword', () => {
      const detector = new LeadDetector();
      const result = detector.detectLead('Quanto custa o serviço mensal?', 'session-8');

      expect(result).not.toBeNull();
      expect(result!.interest).toBe('quanto custa');
    });

    it('should detect "contratar" keyword', () => {
      const detector = new LeadDetector();
      const result = detector.detectLead('Gostaria de contratar o plano premium', 'session-9');

      expect(result).not.toBeNull();
      expect(result!.interest).toBe('contratar');
    });

    it('should detect "serviço" keyword', () => {
      const detector = new LeadDetector();
      const result = detector.detectLead('Vocês oferecem algum serviço de consultoria?', 'session-10');

      expect(result).not.toBeNull();
      expect(result!.interest).toBe('serviço');
    });

    it('should detect "orçamento" keyword', () => {
      const detector = new LeadDetector();
      const result = detector.detectLead('Preciso de um orçamento para o projeto', 'session-11');

      expect(result).not.toBeNull();
      expect(result!.interest).toBe('orçamento');
    });

    it('should detect "proposta" keyword', () => {
      const detector = new LeadDetector();
      const result = detector.detectLead('Podem enviar uma proposta comercial?', 'session-12');

      expect(result).not.toBeNull();
      expect(result!.interest).toBe('proposta');
    });

    it('should detect keywords case-insensitively', () => {
      const detector = new LeadDetector();
      const result = detector.detectLead('QUANTO CUSTA o plano?', 'session-13');

      expect(result).not.toBeNull();
      expect(result!.interest).toBe('quanto custa');
    });

    it('should set empty contact when only interest keyword is found', () => {
      const detector = new LeadDetector();
      const result = detector.detectLead('Qual o preço?', 'session-14');

      expect(result).not.toBeNull();
      expect(result!.contact).toBe('');
      expect(result!.interest).toBe('preço');
    });
  });

  describe('detectLead - combined detection', () => {
    it('should detect both email and interest keyword', () => {
      const detector = new LeadDetector();
      const result = detector.detectLead(
        'Quanto custa? Meu email é lead@empresa.com',
        'session-15',
      );

      expect(result).not.toBeNull();
      expect(result!.contact).toBe('lead@empresa.com');
      expect(result!.interest).toBe('quanto custa');
    });

    it('should prefer email over phone when both present', () => {
      const detector = new LeadDetector();
      const result = detector.detectLead(
        'Email: user@test.com ou ligue 11 99999-0000',
        'session-16',
      );

      expect(result).not.toBeNull();
      expect(result!.contact).toBe('user@test.com');
    });
  });

  describe('detectLead - no detection', () => {
    it('should return null for messages without contact or interest', () => {
      const detector = new LeadDetector();
      const result = detector.detectLead('Olá, tudo bem?', 'session-17');

      expect(result).toBeNull();
    });

    it('should return null for empty message', () => {
      const detector = new LeadDetector();
      const result = detector.detectLead('', 'session-18');

      expect(result).toBeNull();
    });

    it('should return null for generic questions', () => {
      const detector = new LeadDetector();
      const result = detector.detectLead('Como funciona o sistema?', 'session-19');

      expect(result).toBeNull();
    });
  });

  describe('detectLead - metadata', () => {
    it('should include detectedAt timestamp', () => {
      const detector = new LeadDetector();
      const before = new Date();
      const result = detector.detectLead('preço do plano', 'session-20');
      const after = new Date();

      expect(result).not.toBeNull();
      expect(result!.detectedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(result!.detectedAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('should include conversationId from sessionId', () => {
      const detector = new LeadDetector();
      const result = detector.detectLead('preço', 'conv-abc-123');

      expect(result).not.toBeNull();
      expect(result!.conversationId).toBe('conv-abc-123');
    });
  });

  describe('processMessage', () => {
    it('should persist lead and notify admin when lead detected', async () => {
      const detector = new LeadDetector();
      const storage = createMockStorage();

      const leadId = await detector.processMessage(
        'Meu email é cliente@empresa.com, qual o preço?',
        'session-21',
        storage,
      );

      expect(leadId).toBe('lead-uuid-001');
      expect(storage.persistLead).toHaveBeenCalledTimes(1);
      expect(storage.notifyAdmin).toHaveBeenCalledTimes(1);

      const persistedLead: LeadInfo = storage.persistLead.mock.calls[0][0];
      expect(persistedLead.contact).toBe('cliente@empresa.com');
      expect(persistedLead.interest).toBe('preço');
      expect(persistedLead.conversationId).toBe('session-21');
    });

    it('should return null and not call storage when no lead detected', async () => {
      const detector = new LeadDetector();
      const storage = createMockStorage();

      const leadId = await detector.processMessage('Olá, bom dia!', 'session-22', storage);

      expect(leadId).toBeNull();
      expect(storage.persistLead).not.toHaveBeenCalled();
      expect(storage.notifyAdmin).not.toHaveBeenCalled();
    });

    it('should call notifyAdmin after persistLead succeeds', async () => {
      const detector = new LeadDetector();
      const callOrder: string[] = [];
      const storage: LeadStorage = {
        persistLead: vi.fn().mockImplementation(async () => {
          callOrder.push('persist');
          return 'lead-id';
        }),
        notifyAdmin: vi.fn().mockImplementation(async () => {
          callOrder.push('notify');
        }),
      };

      await detector.processMessage('preço do serviço', 'session-23', storage);

      expect(callOrder).toEqual(['persist', 'notify']);
    });

    it('should pass the same LeadInfo to both persist and notify', async () => {
      const detector = new LeadDetector();
      const storage = createMockStorage();

      await detector.processMessage('orçamento para user@test.io', 'session-24', storage);

      const persistedLead: LeadInfo = storage.persistLead.mock.calls[0][0];
      const notifiedLead: LeadInfo = storage.notifyAdmin.mock.calls[0][0];
      expect(persistedLead).toEqual(notifiedLead);
    });
  });
});
