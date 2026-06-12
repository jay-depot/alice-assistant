import { describe, it, expect, vi } from 'vitest';
import { generateLessonHtml, generateGlossaryHtml } from './lesson-template.js';
import { markdownToHtmlSimple } from './teach.js';

// ---------------------------------------------------------------------------
// Break circular dep chain via plugin-hooks
// ---------------------------------------------------------------------------

vi.mock('../../../lib/plugin-hooks.js', () => ({
  PluginHooks: vi.fn(() => ({})),
  PluginHookInvocations: {
    invokeOnContextCompactionSummariesWillBeDeleted: vi
      .fn()
      .mockResolvedValue(undefined),
    invokeOnUserConversationWillBegin: vi.fn().mockResolvedValue(undefined),
    invokeOnUserConversationWillEnd: vi.fn().mockResolvedValue(undefined),
  },
}));

// ---------------------------------------------------------------------------
// lesson-template tests
// ---------------------------------------------------------------------------

describe('generateLessonHtml', () => {
  const baseOptions = {
    title: 'Introduction to Closures',
    topicName: 'JavaScript Basics',
    bodyContent:
      '<p>A closure is a function that retains access to its lexical scope.</p>',
    sequenceNumber: 1,
  };

  it('produces a valid HTML5 document with doctype', () => {
    const html = generateLessonHtml(baseOptions);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toMatch(/<html lang="en">/);
    expect(html).toMatch(/<\/html>/);
  });

  it('includes the title in the document title and h1', () => {
    const html = generateLessonHtml(baseOptions);
    expect(html).toContain('Lesson 1: Introduction to Closures</title>');
    expect(html).toContain('<h1>Introduction to Closures</h1>');
  });

  it('includes the topic name in breadcrumb', () => {
    const html = generateLessonHtml(baseOptions);
    expect(html).toContain('JavaScript Basics</a>');
  });

  it('includes the body content', () => {
    const html = generateLessonHtml(baseOptions);
    expect(html).toContain(
      '<p>A closure is a function that retains access to its lexical scope.</p>'
    );
  });

  it('includes the lesson number badge', () => {
    const html = generateLessonHtml(baseOptions);
    expect(html).toContain('Lesson 1');
  });

  it('includes a followup reminder', () => {
    const html = generateLessonHtml(baseOptions);
    expect(html).toContain('followup-reminder');
  });

  it('includes primary source citation when provided', () => {
    const html = generateLessonHtml({
      ...baseOptions,
      primarySource: {
        title: 'MDN: Closures',
        url: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Closures',
      },
    });
    expect(html).toContain('Primary Source');
    expect(html).toContain('MDN: Closures</a>');
  });

  it('omits primary source block when not provided', () => {
    const html = generateLessonHtml(baseOptions);
    expect(html).not.toContain('Primary Source');
  });

  it('includes related lessons when provided', () => {
    const html = generateLessonHtml({
      ...baseOptions,
      relatedLessons: [
        { slug: '/api/teach/topics/js/lessons/variables', title: 'Variables' },
      ],
    });
    expect(html).toContain('Related Lessons');
    expect(html).toContain('Variables</a>');
  });

  it('includes related references when provided', () => {
    const html = generateLessonHtml({
      ...baseOptions,
      relatedReferences: [
        {
          slug: '/api/teach/topics/js/reference/js-cheatsheet',
          title: 'JS Cheat Sheet',
        },
      ],
    });
    expect(html).toContain('Related Reference Documents');
    expect(html).toContain('JS Cheat Sheet</a>');
  });

  it('escapes HTML in title and topic name', () => {
    const html = generateLessonHtml({
      ...baseOptions,
      title: 'What is <script>?',
      topicName: 'JS & HTML <basics>',
    });
    expect(html).toContain('What is &lt;script&gt;?</h1>');
    expect(html).toContain('JS &amp; HTML &lt;basics&gt;</a>');
  });

  it('uses tufte style by default', () => {
    const html = generateLessonHtml(baseOptions);
    expect(html).toContain('--bg: #fffff8');
  });

  it('uses minimal style when specified', () => {
    const html = generateLessonHtml({ ...baseOptions, style: 'minimal' });
    expect(html).toContain('--bg: #fff');
  });

  it('uses dark style when specified', () => {
    const html = generateLessonHtml({ ...baseOptions, style: 'dark' });
    expect(html).toContain('--bg: #1a1a2e');
  });
});

describe('generateGlossaryHtml', () => {
  it('produces a valid HTML5 document', () => {
    const html = generateGlossaryHtml({
      topicName: 'Yoga',
      description: 'A glossary for yoga practice.',
      terms: [
        { term: 'Asana', definition: 'A physical posture in yoga practice.' },
      ],
    });
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('Yoga — Glossary</title>');
  });

  it('includes the topic description', () => {
    const html = generateGlossaryHtml({
      topicName: 'Yoga',
      description: 'A glossary for yoga practice.',
      terms: [],
    });
    expect(html).toContain('A glossary for yoga practice.');
  });

  it('renders terms as definition list', () => {
    const html = generateGlossaryHtml({
      topicName: 'Yoga',
      description: 'Yoga terms.',
      terms: [
        { term: 'Asana', definition: 'A physical posture.' },
        { term: 'Pranayama', definition: 'Breath control.' },
      ],
    });
    expect(html).toContain('<dt><strong>Asana</strong></dt>');
    expect(html).toContain('<dd>A physical posture.</dd>');
    expect(html).toContain('<dt><strong>Pranayama</strong></dt>');
    expect(html).toContain('<dd>Breath control.</dd>');
  });

  it('renders avoid list for terms', () => {
    const html = generateGlossaryHtml({
      topicName: 'Fitness',
      description: 'Fitness terms.',
      terms: [
        {
          term: 'Hypertrophy',
          definition: 'Muscle growth.',
          avoidList: ['bulking', 'getting big'],
        },
      ],
    });
    expect(html).toContain('Avoid:');
    expect(html).toContain('bulking, getting big');
  });

  it('groups terms by groupHeading', () => {
    const html = generateGlossaryHtml({
      topicName: 'Programming',
      description: 'Programming terms.',
      terms: [
        {
          term: 'Variable',
          definition: 'A named storage location.',
          groupHeading: 'Basics',
        },
        {
          term: 'Closure',
          definition: 'A function with lexical scope.',
          groupHeading: 'Functions',
        },
        {
          term: 'Loop',
          definition: 'A repeating construct.',
          groupHeading: 'Basics',
        },
        { term: 'No Group', definition: 'No group heading.' },
      ],
    });
    expect(html).toContain('<h2>Basics</h2>');
    expect(html).toContain('<h2>Functions</h2>');
  });
});

// ---------------------------------------------------------------------------
// markdownToHtmlSimple tests
// ---------------------------------------------------------------------------

describe('markdownToHtmlSimple', () => {
  it('converts headers', () => {
    expect(markdownToHtmlSimple('# Hello')).toBe('<h1>Hello</h1>');
    expect(markdownToHtmlSimple('## Hello')).toBe('<h2>Hello</h2>');
    expect(markdownToHtmlSimple('### Hello')).toBe('<h3>Hello</h3>');
  });

  it('converts bold and italic', () => {
    expect(markdownToHtmlSimple('**bold**')).toContain('<strong>bold</strong>');
    expect(markdownToHtmlSimple('*italic*')).toContain('<em>italic</em>');
    expect(markdownToHtmlSimple('***both***')).toContain(
      '<strong><em>both</em></strong>'
    );
  });

  it('converts inline code', () => {
    expect(markdownToHtmlSimple('Use `const`')).toBe(
      '<p>Use <code>const</code></p>'
    );
  });

  it('converts links', () => {
    const result = markdownToHtmlSimple('[MDN](https://mdn.io)');
    expect(result).toContain('href="https://mdn.io"');
    expect(result).toContain('>MDN</a>');
    expect(result).toContain('target="_blank"');
  });

  it('converts blockquotes', () => {
    expect(markdownToHtmlSimple('> A quote')).toBe(
      '<blockquote>A quote</blockquote>'
    );
  });

  it('wraps plain text in paragraphs', () => {
    expect(markdownToHtmlSimple('Hello world')).toBe('<p>Hello world</p>');
  });

  it('does not double-wrap existing HTML', () => {
    expect(markdownToHtmlSimple('<h2>Existing</h2>')).toBe('<h2>Existing</h2>');
  });
});

// ---------------------------------------------------------------------------
// Entity schema smoke tests
// ---------------------------------------------------------------------------

describe('Entity definitions', () => {
  it('TeachTopic entity can be imported', async () => {
    const { TeachTopic } = await import('./db-schemas/TeachTopic.js');
    expect(TeachTopic).toBeDefined();
    expect(typeof TeachTopic).toBe('function');
  });

  it('TeachMission entity can be imported', async () => {
    const { TeachMission } = await import('./db-schemas/TeachMission.js');
    expect(TeachMission).toBeDefined();
    expect(typeof TeachMission).toBe('function');
  });

  it('TeachGlossary entity can be imported', async () => {
    const { TeachGlossary } = await import('./db-schemas/TeachGlossary.js');
    expect(TeachGlossary).toBeDefined();
    expect(typeof TeachGlossary).toBe('function');
  });

  it('TeachGlossaryTerm entity can be imported', async () => {
    const { TeachGlossaryTerm } =
      await import('./db-schemas/TeachGlossaryTerm.js');
    expect(TeachGlossaryTerm).toBeDefined();
    expect(typeof TeachGlossaryTerm).toBe('function');
  });

  it('TeachResource entity can be imported', async () => {
    const { TeachResource } = await import('./db-schemas/TeachResource.js');
    expect(TeachResource).toBeDefined();
    expect(typeof TeachResource).toBe('function');
  });

  it('TeachLearningRecord entity can be imported', async () => {
    const { TeachLearningRecord } =
      await import('./db-schemas/TeachLearningRecord.js');
    expect(TeachLearningRecord).toBeDefined();
    expect(typeof TeachLearningRecord).toBe('function');
  });

  it('TeachLesson entity can be imported', async () => {
    const { TeachLesson } = await import('./db-schemas/TeachLesson.js');
    expect(TeachLesson).toBeDefined();
    expect(typeof TeachLesson).toBe('function');
  });

  it('TeachReferenceDocument entity can be imported', async () => {
    const { TeachReferenceDocument } =
      await import('./db-schemas/TeachReferenceDocument.js');
    expect(TeachReferenceDocument).toBeDefined();
    expect(typeof TeachReferenceDocument).toBe('function');
  });

  it('TeachNote entity can be imported', async () => {
    const { TeachNote } = await import('./db-schemas/TeachNote.js');
    expect(TeachNote).toBeDefined();
    expect(typeof TeachNote).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// Plugin metadata tests
// ---------------------------------------------------------------------------

describe('TeachPlugin metadata', () => {
  it('has correct plugin metadata', async () => {
    const { default: TeachPlugin } = await import('./teach.js');
    expect(TeachPlugin.pluginMetadata).toMatchObject({
      id: 'teach',
      name: 'Teach Plugin',
      version: 'LATEST',
      required: false,
    });
  });

  it('declares dependencies on memory, skills, and rest-serve', async () => {
    const { default: TeachPlugin } = await import('./teach.js');
    const depIds = TeachPlugin.pluginMetadata.dependencies?.map(d => d.id);
    expect(depIds).toContain('memory');
    expect(depIds).toContain('skills');
    expect(depIds).toContain('rest-serve');
  });
});
