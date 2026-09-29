export type TestCardOutcome = 'approved' | 'declined' | 'insufficient-funds' | 'processing-error';

export interface TestCard {
  number: string;
  brand: 'Visa' | 'Mastercard' | 'Amex';
  label: string;
  outcome: TestCardOutcome;
}

/**
 * Card numbers the simulator accepts. It rejects every other number, so
 * nobody types a real card into a public demo. These are the widely used
 * industry test numbers, not Helcim-specific ones.
 */
export const TEST_CARDS: readonly TestCard[] = [
  { number: '4242424242424242', brand: 'Visa', label: 'Approved', outcome: 'approved' },
  { number: '5555555555554444', brand: 'Mastercard', label: 'Approved', outcome: 'approved' },
  { number: '4000000000000002', brand: 'Visa', label: 'Declined', outcome: 'declined' },
  {
    number: '4000000000009995',
    brand: 'Visa',
    label: 'Insufficient funds',
    outcome: 'insufficient-funds',
  },
  {
    number: '4000000000000119',
    brand: 'Visa',
    label: 'Processing error',
    outcome: 'processing-error',
  },
];

export function findTestCard(cardNumber: string): TestCard | undefined {
  const digits = cardNumber.replace(/\D/g, '');
  return TEST_CARDS.find((card) => card.number === digits);
}

export const DECLINE_MESSAGES: Record<Exclude<TestCardOutcome, 'approved'>, string> = {
  declined: 'HelcimPay.js transaction failed - Card declined',
  'insufficient-funds': 'HelcimPay.js transaction failed - Insufficient funds',
  'processing-error': 'HelcimPay.js transaction failed - Processor error, please try again',
};
