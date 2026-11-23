import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The app is English-only today and must be mirrorable tomorrow (Arabic is a stated
 * direction, not a v1 feature). That is cheap if no class ever says "left" or "right",
 * and expensive to retrofit, so it is a check and not a convention: only LOGICAL
 * Tailwind classes (`ms-`, `me-`, `ps-`, `pe-`, `start-`, `end-`, `text-start`,
 * `text-end`, `border-s`, `rounded-e`, ...).
 *
 * `components/ui` is excluded from this half: it is shadcn's generated code, installed
 * with the CLI's RTL setting, and the one physical pair left in it
 * (`group-data-[side=left]:-right-4` on the sidebar rail) is keyed on a physical side
 * on purpose.
 *
 * The second half has no exclusion: the theme is light only, so a class behind the
 * other theme's variant would be dead code anywhere. (That variant's name is assembled
 * below rather than written out, so that searching the source for it finds nothing.)
 */
const SRC = path.resolve(import.meta.dirname, '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(tsx?|css)$/.test(entry.name) ? [full] : [];
  });
}

const relative = (file: string) => path.relative(SRC, file).split(path.sep).join('/');

const files = sourceFiles(SRC).filter((file) => {
  const name = relative(file);
  return (
    !name.startsWith('lib/api/generated/') && !name.endsWith('.gen.ts') && !/\.test\.tsx?$/.test(name)
  );
});

// A class token starts after whitespace, a quote or a variant's colon -- never in the
// middle of a word -- and may be negative (`-ml-2`).
const START = String.raw`(?<![\w-])-?`;
const PHYSICAL = new RegExp(
  [
    String.raw`${START}(?:ml|mr|pl|pr)-[\w[(]`,
    String.raw`${START}(?:left|right)-[\w[(]`,
    String.raw`${START}text-(?:left|right)(?![\w-])`,
    String.raw`${START}(?:border|rounded)-[lr](?![\w])`,
    String.raw`${START}(?:scroll-)?(?:m|p)[lr]-[\w[(]`,
  ].join('|'),
  'g',
);

function offences(pattern: RegExp, candidates: string[]): string[] {
  return candidates.flatMap((file) =>
    readFileSync(file, 'utf8')
      .split('\n')
      .flatMap((line, index) =>
        [...line.matchAll(pattern)].map((match) => `${relative(file)}:${index + 1}  ${match[0]}`),
      ),
  );
}

describe('styling rules', () => {
  it('finds the source files', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('recognises physical classes, and leaves logical ones alone', () => {
    const physical = ['ml-2', '-mr-1', 'md:pl-4', 'pr-[3px]', 'left-0', 'hover:right-2', 'text-left',
      'text-right', 'border-l', 'border-r-2', 'rounded-l', 'rounded-r-md'];
    for (const token of physical) {
      expect(`class="${token}"`.match(PHYSICAL), token).not.toBeNull();
    }
    const logical = ['ms-2', '-me-1', 'ps-4', 'pe-8', 'start-0', 'end-2', 'text-start', 'text-end',
      'border-s', 'rounded-e-md', 'align="right"', 'side: "left"', 'justify-self-start', 'copyright-2'];
    for (const token of logical) {
      expect(`class="${token}"`.match(PHYSICAL), token).toBeNull();
    }
  });

  it('uses only logical (direction-neutral) classes outside components/ui', () => {
    const outsideUi = files.filter((file) => !relative(file).startsWith('components/ui/'));
    expect(offences(PHYSICAL, outsideUi)).toEqual([]);
  });

  it('has no dark-theme variant or token block anywhere', () => {
    const theme = ['da', 'rk'].join('');
    const pattern = new RegExp(
      String.raw`(?<![\w-])${theme}:|\.${theme}\b|@custom-variant\s+${theme}`,
      'g',
    );
    expect(offences(pattern, files)).toEqual([]);
  });
});
