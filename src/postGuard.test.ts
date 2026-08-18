import { describe, it, expect } from 'vitest';
import { parsePostPolicy, isChannelAllowed } from './postGuard';

describe('parsePostPolicy', () => {
  it('returns disabled for undefined', () => {
    expect(parsePostPolicy(undefined)).toEqual({ kind: 'disabled' });
  });

  it('returns disabled for an empty string', () => {
    expect(parsePostPolicy('')).toEqual({ kind: 'disabled' });
  });

  it('returns disabled for a whitespace-only string', () => {
    expect(parsePostPolicy('   ')).toEqual({ kind: 'disabled' });
  });

  it('returns all for "true"', () => {
    expect(parsePostPolicy('true')).toEqual({ kind: 'all' });
  });

  it('returns all for "1"', () => {
    expect(parsePostPolicy('1')).toEqual({ kind: 'all' });
  });

  it('returns an allow policy for a comma-separated channel list', () => {
    expect(parsePostPolicy('C123,C456')).toEqual({
      kind: 'allow',
      channels: new Set(['C123', 'C456']),
    });
  });

  it('returns a deny policy for a single "!" prefixed channel', () => {
    expect(parsePostPolicy('!C123')).toEqual({
      kind: 'deny',
      channels: new Set(['C123']),
    });
  });

  it('returns a deny policy for multiple "!" prefixed channels', () => {
    expect(parsePostPolicy('!C123,!C456')).toEqual({
      kind: 'deny',
      channels: new Set(['C123', 'C456']),
    });
  });

  it('trims whitespace around entries and ignores empty entries', () => {
    expect(parsePostPolicy(' C1 , ,C2 ')).toEqual({
      kind: 'allow',
      channels: new Set(['C1', 'C2']),
    });
  });

  it('throws when mixing allow and deny entries', () => {
    expect(() => parsePostPolicy('C123,!C456')).toThrow(
      'cannot mix allowed and disallowed (! prefixed) channels',
    );
  });
});

describe('isChannelAllowed', () => {
  it('returns false when disabled', () => {
    expect(isChannelAllowed({ kind: 'disabled' }, 'C123')).toBe(false);
  });

  it('returns true for any channel when all', () => {
    expect(isChannelAllowed({ kind: 'all' }, 'C123')).toBe(true);
    expect(isChannelAllowed({ kind: 'all' }, 'C999')).toBe(true);
  });

  it('returns true for a channel in the allow list', () => {
    const policy: ReturnType<typeof parsePostPolicy> = {
      kind: 'allow',
      channels: new Set(['C123']),
    };
    expect(isChannelAllowed(policy, 'C123')).toBe(true);
  });

  it('returns false for a channel not in the allow list', () => {
    const policy: ReturnType<typeof parsePostPolicy> = {
      kind: 'allow',
      channels: new Set(['C123']),
    };
    expect(isChannelAllowed(policy, 'C999')).toBe(false);
  });

  it('returns false for a channel in the deny list', () => {
    const policy: ReturnType<typeof parsePostPolicy> = {
      kind: 'deny',
      channels: new Set(['C123']),
    };
    expect(isChannelAllowed(policy, 'C123')).toBe(false);
  });

  it('returns true for a channel not in the deny list', () => {
    const policy: ReturnType<typeof parsePostPolicy> = {
      kind: 'deny',
      channels: new Set(['C123']),
    };
    expect(isChannelAllowed(policy, 'C999')).toBe(true);
  });
});
