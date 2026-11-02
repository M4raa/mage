import { describe, expect, it } from 'vitest';
import { isAllowedNavigationUrl, normalizeNavigationUrl } from './navigationPolicy';

describe('normalizeNavigationUrl', () => {
  it.each([
    ['http://example.com', 'http://example.com/'],
    ['https://example.com/a?b=1', 'https://example.com/a?b=1'],
    ['localhost', 'http://localhost/'],
    ['localhost:5173', 'http://localhost:5173/'],
    ['LOCALHOST:3000/app', 'http://localhost:3000/app'],
    ['http://localhost:8080/x', 'http://localhost:8080/x'],
    ['  https://example.com  ', 'https://example.com/'],
  ])('normalizeNavigationUrl_allowedInput_returnsHref: %s', (input, expected) => {
    // Arrange y Act
    const result = normalizeNavigationUrl(input);

    // Assert
    expect(result).toBe(expected);
  });

  it.each([
    ['file:///C:/Windows/win.ini', /file:/],
    ['chrome://settings', /chrome:/],
    ['devtools://devtools/bundled/inspector.html', /devtools:/],
    ['javascript:alert(1)', /javascript:/],
    ['data:text/html,<b>x</b>', /data:/],
    ['about:blank', /about:/],
    ['http://', /no válida/],
    ['no es una url', /no válida/],
    ['', /vacía/],
    ['   ', /vacía/],
  ])('normalizeNavigationUrl_deniedInput_throwsWithValue: %s', (input, expectedMessage) => {
    // Act y Assert
    expect(() => normalizeNavigationUrl(input)).toThrow(expectedMessage);
  });
});

describe('isAllowedNavigationUrl', () => {
  it.each([
    ['https://example.com/', true],
    ['http://127.0.0.1:4000/', true],
    ['http://localhost:5173/', true],
    ['file:///etc/passwd', false],
    ['chrome://gpu', false],
    ['devtools://x', false],
    ['about:blank', false],
    ['javascript:void(0)', false],
    ['data:text/html,x', false],
    ['localhost:5173', false],
    ['', false],
    ['nope', false],
  ])('isAllowedNavigationUrl_table_returnsExpected: %s', (url, expected) => {
    // Act
    const result = isAllowedNavigationUrl(url);

    // Assert
    expect(result).toBe(expected);
  });
});
