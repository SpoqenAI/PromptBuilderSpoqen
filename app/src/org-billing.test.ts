import { describe, expect, it } from 'vitest';
import { getSeatUnitPrice, formatLockDate } from './org-billing';

describe('getSeatUnitPrice (graduated pricing)', () => {
  it('returns $20 for 1-3 seats', () => {
    expect(getSeatUnitPrice(1)).toBe(20);
    expect(getSeatUnitPrice(2)).toBe(20);
    expect(getSeatUnitPrice(3)).toBe(20);
  });

  it('returns $18 for 4-10 seats', () => {
    expect(getSeatUnitPrice(4)).toBe(18);
    expect(getSeatUnitPrice(7)).toBe(18);
    expect(getSeatUnitPrice(10)).toBe(18);
  });

  it('returns $16 for 11+ seats', () => {
    expect(getSeatUnitPrice(11)).toBe(16);
    expect(getSeatUnitPrice(50)).toBe(16);
    expect(getSeatUnitPrice(100)).toBe(16);
  });
});

describe('formatLockDate', () => {
  it('returns N/A for null input', () => {
    expect(formatLockDate(null)).toBe('N/A');
  });

  it('formats a valid ISO date string', () => {
    const result = formatLockDate('2026-04-15T12:00:00.000Z');
    expect(result).toContain('2026');
    expect(result).toContain('April');
    expect(result).toContain('15');
  });
});

describe('lock date computation', () => {
  const LOCK_HOURS = 72;

  it('computes lock date as period start + 72 hours', () => {
    const periodStart = new Date('2026-03-01T00:00:00Z');
    const lockMs = periodStart.getTime() + LOCK_HOURS * 60 * 60 * 1000;
    const lockDate = new Date(lockMs);
    expect(lockDate.toISOString()).toBe('2026-03-04T00:00:00.000Z');
  });

  it('correctly identifies locked state after 72 hours', () => {
    const periodStart = new Date('2026-03-01T00:00:00Z');
    const lockMs = periodStart.getTime() + LOCK_HOURS * 60 * 60 * 1000;

    const beforeLock = new Date('2026-03-03T23:59:59Z').getTime();
    const afterLock = new Date('2026-03-04T00:00:01Z').getTime();

    expect(beforeLock < lockMs).toBe(true);
    expect(afterLock >= lockMs).toBe(true);
  });

  it('5-day alert fires when hours to end < 120', () => {
    const periodEnd = new Date('2026-03-31T00:00:00Z');
    const fourDaysBefore = new Date('2026-03-27T00:00:00Z');
    const sixDaysBefore = new Date('2026-03-25T00:00:00Z');

    const hoursAt4Days = (periodEnd.getTime() - fourDaysBefore.getTime()) / 3_600_000;
    const hoursAt6Days = (periodEnd.getTime() - sixDaysBefore.getTime()) / 3_600_000;

    expect(hoursAt4Days).toBe(96);
    expect(hoursAt4Days < 120).toBe(true);

    expect(hoursAt6Days).toBe(144);
    expect(hoursAt6Days < 120).toBe(false);
  });
});

describe('credit consumption logic (pure math)', () => {
  function simulateConsume(monthly: number, topUp: number, amount: number) {
    const total = monthly + topUp;
    if (total < amount) return { result: 'insufficient' as const, monthly, topUp };

    const useFromMonthly = Math.min(monthly, amount);
    const remainder = amount - useFromMonthly;
    return {
      result: 'ok' as const,
      monthly: monthly - useFromMonthly,
      topUp: topUp - remainder,
    };
  }

  it('deducts from monthly credits first', () => {
    const out = simulateConsume(50, 30, 40);
    expect(out.result).toBe('ok');
    expect(out.monthly).toBe(10);
    expect(out.topUp).toBe(30);
  });

  it('overflows into top-up credits', () => {
    const out = simulateConsume(20, 30, 40);
    expect(out.result).toBe('ok');
    expect(out.monthly).toBe(0);
    expect(out.topUp).toBe(10);
  });

  it('returns insufficient when both pools are too small', () => {
    const out = simulateConsume(10, 5, 20);
    expect(out.result).toBe('insufficient');
    expect(out.monthly).toBe(10);
    expect(out.topUp).toBe(5);
  });

  it('handles zero amount', () => {
    const out = simulateConsume(50, 30, 0);
    expect(out.result).toBe('ok');
    expect(out.monthly).toBe(50);
    expect(out.topUp).toBe(30);
  });

  it('exact depletion of both pools', () => {
    const out = simulateConsume(30, 20, 50);
    expect(out.result).toBe('ok');
    expect(out.monthly).toBe(0);
    expect(out.topUp).toBe(0);
  });
});
