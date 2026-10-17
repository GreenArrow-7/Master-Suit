import { describe, expect, it } from 'vitest';
import { trackingNumbers } from '@/lib/integrations/telephony/resolve';

/**
 * A telephony connection's tracking numbers (M9-06): each line it holds is
 * tagged with the source a call to it came from, written on the connection
 * as `number = source`, separated by `;` or a new line.
 */
describe('trackingNumbers', () => {
  it('maps each number, in any format, to its tag', () => {
    const map = trackingNumbers({ trackingNumbers: '+971 4 400 0001 = Google Ads; 044000002=Marina launch' });
    expect([...map]).toEqual([
      ['+97144000001', 'Google Ads'],
      ['+97144000002', 'Marina launch'],
    ]);
  });

  it('takes a new line as a separator too, and keeps the tag as written', () => {
    expect(trackingNumbers({ trackingNumbers: '+97144000003 = Bayut / JVC\n+97144000004 =  Walk-in ' })).toEqual(
      new Map([
        ['+97144000003', 'Bayut / JVC'],
        ['+97144000004', 'Walk-in'],
      ]),
    );
  });

  it('skips an entry with no tag or no number, and a connection with none', () => {
    expect(trackingNumbers({ trackingNumbers: '+97144000005; = Orphan tag; 12 = Too short; ;' }).size).toBe(0);
    expect(trackingNumbers({}).size).toBe(0);
    expect(trackingNumbers(null).size).toBe(0);
  });
});
