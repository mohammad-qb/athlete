/**
 * Conventional commits, so history is greppable by change type and a release note can
 * be assembled without reading every diff.
 *
 * @type {import('@commitlint/types').UserConfig}
 */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // The default 100-character header is too tight for a subject that names both the
    // subsystem and the behaviour change; 180 keeps subjects informative without
    // inviting a paragraph.
    'header-max-length': [2, 'always', 180],
    'body-max-line-length': [2, 'always', 120],
    'footer-max-line-length': [2, 'always', 120],
  },
};
