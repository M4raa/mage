import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { FileAccess } from './fileAccess';
import { isAllowedNavigationUrl, normalizeNavigationUrl } from './navigationPolicy';

const PAGE = path.resolve('/proyecto/index.html');
// Acceso falso: solo PAGE es una página permitida (las reglas de carpeta las prueba fileAccess.test.ts).
const files: FileAccess = {
  root: path.resolve('/proyecto'),
  resolve: (url) => (url === pathToFileURL(PAGE).href ? PAGE : null),
  allowsPage: (url) => url === pathToFileURL(PAGE).href,
};

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
    const result = normalizeNavigationUrl(input, files);

    // Assert
    expect(result).toBe(expected);
  });

  it.each([
    ['file:///C:/Windows/win.ini', /carpeta de la conversación/],
    ['C:\\Windows\\win.ini', /carpeta de la conversación/],
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
    expect(() => normalizeNavigationUrl(input, files)).toThrow(expectedMessage);
  });
});

describe('normalizeNavigationUrl con ficheros', () => {
  it.each([
    ['ruta absoluta', PAGE],
    ['file:// ', pathToFileURL(PAGE).href],
  ])('normalizeNavigationUrl_allowedFile_returnsFileHref (%s)', (_case, input) => {
    expect(normalizeNavigationUrl(input, files)).toBe(pathToFileURL(PAGE).href);
  });

  it('normalizeNavigationUrl_fileWithoutAccess_throwsNoFolder', () => {
    expect(() => normalizeNavigationUrl(PAGE, null)).toThrow(/no tiene carpeta de trabajo/);
  });

  it('isAllowedNavigationUrl_fileWithoutAccess_isFalse', () => {
    expect(isAllowedNavigationUrl(pathToFileURL(PAGE).href, null)).toBe(false);
  });
});

describe('isAllowedNavigationUrl', () => {
  it.each([
    ['https://example.com/', true],
    ['http://127.0.0.1:4000/', true],
    ['http://localhost:5173/', true],
    ['file:///etc/passwd', false],
    [pathToFileURL(PAGE).href, true],
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
    const result = isAllowedNavigationUrl(url, files);

    // Assert
    expect(result).toBe(expected);
  });
});
