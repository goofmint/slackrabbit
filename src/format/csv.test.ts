import { describe, it, expect } from 'vitest';
import { toCsv } from './csv';

describe('toCsv', () => {
  it('quotes a value containing a comma', () => {
    const result = toCsv(['A'], [{ A: 'foo,bar' }]);
    expect(result).toBe('A\n"foo,bar"');
  });

  it('quotes a value containing a newline', () => {
    const result = toCsv(['A'], [{ A: 'foo\nbar' }]);
    expect(result).toBe('A\n"foo\nbar"');
  });

  it('escapes double quotes and wraps the whole field in quotes', () => {
    const result = toCsv(['A'], [{ A: 'say "hi"' }]);
    expect(result).toBe('A\n"say ""hi"""');
  });

  it('does not quote a plain value', () => {
    const result = toCsv(['A'], [{ A: 'plain' }]);
    expect(result).toBe('A\nplain');
  });

  it('converts undefined and null to an empty string', () => {
    const result = toCsv(['A', 'B'], [{ A: undefined, B: null }]);
    expect(result).toBe('A,B\n,');
  });

  it('stringifies numbers and booleans', () => {
    const result = toCsv(['Num', 'Bool'], [{ Num: 42, Bool: true }]);
    expect(result).toBe('Num,Bool\n42,true');
  });

  it('produces exact output for message rows with mixed special characters', () => {
    const headers = [
      'MsgID',
      'UserID',
      'UserName',
      'RealName',
      'Channel',
      'ThreadTs',
      'Text',
      'Time',
      'Permalink',
      'Cursor',
    ];
    const rows = [
      {
        MsgID: 'M1',
        UserID: 'U1',
        UserName: 'alice',
        RealName: 'Alice Example',
        Channel: 'C1',
        ThreadTs: '1234.5678',
        Text: 'line1\nline2, with "quotes"',
        Time: '1234.5678',
        Permalink: 'https://example.slack.com/archives/C1/p12345678',
        Cursor: 'cursor1',
      },
    ];
    const result = toCsv(headers, rows);
    expect(result).toBe(
      'MsgID,UserID,UserName,RealName,Channel,ThreadTs,Text,Time,Permalink,Cursor\n' +
        'M1,U1,alice,Alice Example,C1,1234.5678,"line1\nline2, with ""quotes""",1234.5678,https://example.slack.com/archives/C1/p12345678,cursor1',
    );
  });

  it('produces columns in header order for channel rows', () => {
    const headers = ['ID', 'Name', 'Topic', 'Purpose', 'MemberCount', 'Cursor'];
    const rows = [
      {
        ID: 'C1',
        Name: 'general',
        Topic: 'General discussion',
        Purpose: 'Company-wide announcements',
        MemberCount: 100,
        Cursor: 'cursor1',
      },
    ];
    const result = toCsv(headers, rows);
    expect(result).toBe(
      'ID,Name,Topic,Purpose,MemberCount,Cursor\n' +
        'C1,general,General discussion,Company-wide announcements,100,cursor1',
    );
  });

  it('produces columns in header order for user rows', () => {
    const headers = ['UserID', 'UserName', 'RealName', 'DisplayName', 'Email', 'Title', 'DMChannelID'];
    const rows = [
      {
        UserID: 'U1',
        UserName: 'alice',
        RealName: 'Alice Example',
        DisplayName: 'Alice',
        Email: 'alice@example.com',
        Title: 'Engineer',
        DMChannelID: 'D1',
      },
    ];
    const result = toCsv(headers, rows);
    expect(result).toBe(
      'UserID,UserName,RealName,DisplayName,Email,Title,DMChannelID\n' +
        'U1,alice,Alice Example,Alice,alice@example.com,Engineer,D1',
    );
  });

  it('does not emit keys present in rows but not in headers', () => {
    const result = toCsv(['A'], [{ A: 'value', B: 'extra' }]);
    expect(result).toBe('A\nvalue');
  });
});
