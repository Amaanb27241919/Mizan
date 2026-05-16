import { describe, it, expect } from 'vitest';
import {
  median,
  labelCadence,
  gapStats,
  buildBills,
} from '../components/BillsCalendar.jsx';

describe('median', () => {
  it('returns NaN on empty input', () => {
    expect(Number.isNaN(median([]))).toBe(true);
    expect(Number.isNaN(median(null))).toBe(true);
  });
  it('returns the single value for a 1-length array', () => {
    expect(median([7])).toBe(7);
  });
  it('returns the middle value for odd-length input', () => {
    expect(median([1, 3, 9])).toBe(3);
  });
  it('returns the average of the two middle values for even-length input', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
});

describe('labelCadence', () => {
  it('labels <=10d as weekly', () => {
    expect(labelCadence(7)).toBe('weekly');
    expect(labelCadence(10)).toBe('weekly');
  });
  it('labels 11-18d as biweekly', () => {
    expect(labelCadence(14)).toBe('biweekly');
    expect(labelCadence(18)).toBe('biweekly');
  });
  it('labels 19-45d as monthly', () => {
    expect(labelCadence(30)).toBe('monthly');
    expect(labelCadence(45)).toBe('monthly');
  });
  it('labels 46-100d as quarterly', () => {
    expect(labelCadence(90)).toBe('quarterly');
  });
  it('labels >100d as irregular', () => {
    expect(labelCadence(180)).toBe('irregular');
  });
  it('returns irregular for NaN', () => {
    expect(labelCadence(NaN)).toBe('irregular');
  });
});

describe('gapStats', () => {
  it('computes integer day gaps between sorted dates', () => {
    const r = gapStats(['2025-01-01', '2025-01-08', '2025-01-15']);
    expect(r.gapsDays).toEqual([7, 7]);
    expect(r.medianGap).toBe(7);
    expect(r.sortedAsc[0]).toBe('2025-01-01');
  });
  it('sorts unsorted input before computing gaps', () => {
    const r = gapStats(['2025-02-01', '2025-01-01', '2025-03-01']);
    expect(r.sortedAsc).toEqual(['2025-01-01', '2025-02-01', '2025-03-01']);
  });
  it('handles empty input', () => {
    const r = gapStats([]);
    expect(r.gapsDays).toEqual([]);
    expect(Number.isNaN(r.medianGap)).toBe(true);
  });
  it('drops same-day duplicates from gap computation', () => {
    const r = gapStats(['2025-01-01', '2025-01-01', '2025-01-15']);
    expect(r.gapsDays).toEqual([14]);
  });
});

describe('buildBills', () => {
  const today = '2025-06-01';

  it('returns an empty array for empty/invalid input', () => {
    expect(buildBills([], [], today)).toEqual([]);
    expect(buildBills(null, [], today)).toEqual([]);
  });

  it('filters merchants that only appear in one month', () => {
    const txns = [
      { merchant_name: 'OneOff', amount: 10, date: '2025-05-01', account_id: 'a1' },
      { merchant_name: 'OneOff', amount: 10, date: '2025-05-15', account_id: 'a1' },
    ];
    expect(buildBills(txns, [], today)).toEqual([]);
  });

  it('ignores credits (amount <= 0)', () => {
    const txns = [
      { merchant_name: 'Refunds', amount: -10, date: '2025-04-01' },
      { merchant_name: 'Refunds', amount: -10, date: '2025-05-01' },
    ];
    expect(buildBills(txns, [], today)).toEqual([]);
  });

  it('projects the next due date forward from the last charge', () => {
    const txns = [
      { merchant_name: 'Netflix', amount: 15.99, date: '2025-03-15', account_id: 'a1' },
      { merchant_name: 'Netflix', amount: 15.99, date: '2025-04-15', account_id: 'a1' },
      { merchant_name: 'Netflix', amount: 15.99, date: '2025-05-15', account_id: 'a1' },
    ];
    const bills = buildBills(txns, [], today);
    expect(bills).toHaveLength(1);
    const [b] = bills;
    expect(b.merchant).toBe('Netflix');
    expect(b.cadence).toBe('monthly');
    expect(b.expectedNextDate).toBe('2025-06-14'); // 2025-05-15 + 30d
    expect(b.estAmount).toBeCloseTo(15.99);
  });

  it('rolls projected date forward when last charge + gap is already past', () => {
    // Last charge was Jan 1; gap = 30d. Today is 2025-06-01. Naive
    // projection (Jan 31) is far in the past — buildBills should walk
    // forward in 30-day steps until it lands on/after today.
    const txns = [
      { merchant_name: 'Old', amount: 9.99, date: '2024-12-01' },
      { merchant_name: 'Old', amount: 9.99, date: '2025-01-01' },
    ];
    const bills = buildBills(txns, [], today);
    expect(bills).toHaveLength(1);
    const ms = new Date(`${bills[0].expectedNextDate}T00:00:00Z`).getTime();
    const todayMs = new Date(`${today}T00:00:00Z`).getTime();
    expect(ms).toBeGreaterThanOrEqual(todayMs);
    expect(bills[0].daysUntil).toBeGreaterThanOrEqual(0);
  });

  it('resolves a single-account label using institution_name + mask', () => {
    const txns = [
      { merchant_name: 'Spotify', amount: 9.99, date: '2025-04-01', account_id: 'aa' },
      { merchant_name: 'Spotify', amount: 9.99, date: '2025-05-01', account_id: 'aa' },
    ];
    const accounts = [{ account_id: 'aa', institution_name: 'Chase', mask: '4421' }];
    const [b] = buildBills(txns, accounts, today);
    expect(b.account).toBe('Chase ····4421');
  });

  it('marks multi-account merchants with a count instead of one label', () => {
    const txns = [
      { merchant_name: 'AWS', amount: 22.00, date: '2025-04-01', account_id: 'aa' },
      { merchant_name: 'AWS', amount: 22.00, date: '2025-05-01', account_id: 'bb' },
    ];
    const accounts = [
      { account_id: 'aa', institution_name: 'Chase', mask: '4421' },
      { account_id: 'bb', institution_name: 'Amex',  mask: '0001' },
    ];
    const [b] = buildBills(txns, accounts, today);
    expect(b.account).toBe('2 accounts');
  });

  it('sorts bills by ascending expectedNextDate', () => {
    const txns = [
      // Weekly: gap = 7d, last on 2025-05-30 → expected 2025-06-06
      { merchant_name: 'Weekly', amount: 5, date: '2025-04-25' },
      { merchant_name: 'Weekly', amount: 5, date: '2025-05-02' },
      { merchant_name: 'Weekly', amount: 5, date: '2025-05-30' },
      // Monthly: gap = 30d, last on 2025-05-01 → expected 2025-06-30
      { merchant_name: 'Monthly', amount: 50, date: '2025-04-01' },
      { merchant_name: 'Monthly', amount: 50, date: '2025-05-01' },
    ];
    const bills = buildBills(txns, [], today);
    expect(bills.map(b => b.merchant)).toEqual(['Weekly', 'Monthly']);
  });
});
