/**
 * Lesson and reference document HTML template generator.
 *
 * Produces self-contained HTML5 documents with clean, readable typography
 * inspired by Edward Tufte's design principles. Documents include
 * navigation breadcrumbs, citation blocks, and cross-references.
 *
 * Port of Matt Pocock's "teach" skill
 * (https://github.com/mattpocock/skills/tree/main/skills/productivity/teach)
 * adapted for the A.L.I.C.E. Assistant plugin ecosystem.
 */

export type LessonTemplateOptions = {
  /** Human-readable title of the lesson or reference document */
  title: string;
  /** Name of the topic this belongs to */
  topicName: string;
  /** The main HTML body content (already HTML, not markdown) */
  bodyContent: string;
  /** Sequence number for display (e.g., 1, 2, 3...) */
  sequenceNumber: number;
  /** Optional primary source citation */
  primarySource?: {
    title: string;
    url?: string;
  };
  /** Optional links to related lessons: { slug, title } */
  relatedLessons?: Array<{ slug: string; title: string }>;
  /** Optional links to related reference documents: { slug, title } */
  relatedReferences?: Array<{ slug: string; title: string }>;
  /** Optional link to the glossary for this topic */
  glossaryUrl?: string;
  /** CSS style preset: 'tufte' | 'minimal' | 'dark' */
  style?: 'tufte' | 'minimal' | 'dark';
};

const STYLE_PRESETS = {
  tufte: `
    :root { --bg: #fffff8; --text: #1a1a1a; --accent: #b00; --link: #369; --muted: #666; --border: #ccc; }
    body { font-family: 'ETBembo', 'Palatino Linotype', 'Book Antiqua', Palatino, Georgia, serif;
           font-size: 16px; line-height: 1.7; color: var(--text); background: var(--bg);
           max-width: 720px; margin: 2rem auto; padding: 0 1.5rem; }
    h1 { font-size: 1.8rem; margin-bottom: 0.3rem; line-height: 1.2; }
    h2 { font-size: 1.4rem; margin-top: 2rem; }
    h3 { font-size: 1.15rem; margin-top: 1.5rem; }
    p { margin: 0.8rem 0; }
    a { color: var(--link); text-decoration: none; }
    a:hover { text-decoration: underline; }
    blockquote { margin: 1.5rem 0; padding: 0.5rem 1.2rem; border-left: 3px solid var(--accent);
                 background: #f9f6f0; font-style: italic; }
    code { font-family: 'Fira Code', 'Consolas', monospace; font-size: 0.9em;
           background: #f0ece4; padding: 0.15em 0.3em; border-radius: 3px; }
    pre { background: #f5f2ea; padding: 1rem; border-radius: 4px; overflow-x: auto; font-size: 0.9em; }
    pre code { background: none; padding: 0; }
    .breadcrumb { font-size: 0.85rem; color: var(--muted); margin-bottom: 1.5rem; }
    .breadcrumb a { color: var(--muted); }
    .primary-source { margin: 2rem 0; padding: 1rem 1.2rem; border: 1px solid var(--border);
                      border-radius: 4px; background: #faf8f4; }
    .primary-source h3 { margin-top: 0; font-size: 0.95rem; text-transform: uppercase;
                         letter-spacing: 0.05em; color: var(--muted); }
    .related { margin: 2rem 0; }
    .related h3 { font-size: 0.95rem; text-transform: uppercase; letter-spacing: 0.05em;
                  color: var(--muted); }
    .related ul { list-style: none; padding: 0; }
    .related li { padding: 0.25rem 0; }
    .followup-reminder { margin-top: 3rem; padding: 1rem 1.2rem; border: 2px solid var(--accent);
                         border-radius: 4px; background: #fdf5f5; font-weight: 500; }
    .lesson-number { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.1em;
                     color: var(--muted); margin-bottom: 0.3rem; }
    @media print { body { max-width: 100%; margin: 0; } }`,

  minimal: `
    :root { --bg: #fff; --text: #222; --accent: #0055aa; --link: #0066cc;
            --muted: #888; --border: #ddd; }
    body { font-family: -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
           font-size: 15px; line-height: 1.6; color: var(--text); background: var(--bg);
           max-width: 680px; margin: 2rem auto; padding: 0 1.5rem; }
    h1 { font-size: 1.6rem; margin-bottom: 0.4rem; }
    h2 { font-size: 1.3rem; margin-top: 1.8rem; }
    p { margin: 0.7rem 0; }
    a { color: var(--link); }
    blockquote { margin: 1.2rem 0; padding: 0.4rem 1rem; border-left: 3px solid var(--border); }
    code { font-family: 'Consolas', monospace; font-size: 0.88em;
           background: #f5f5f5; padding: 0.1em 0.25em; border-radius: 3px; }
    pre { background: #f8f8f8; padding: 0.8rem; border-radius: 4px; overflow-x: auto; }
    .breadcrumb { font-size: 0.82rem; color: var(--muted); margin-bottom: 1.2rem; }
    .primary-source { margin: 1.5rem 0; padding: 0.8rem 1rem; border: 1px solid var(--border);
                      border-radius: 4px; }
    .primary-source h3 { margin-top: 0; font-size: 0.9rem; color: var(--muted); }
    .related { margin: 1.5rem 0; }
    .related h3 { font-size: 0.9rem; color: var(--muted); }
    .related ul { list-style: none; padding: 0; }
    .followup-reminder { margin-top: 2.5rem; padding: 0.8rem 1rem; border: 1px solid var(--accent);
                         border-radius: 4px; }
    .lesson-number { font-size: 0.75rem; color: var(--muted); text-transform: uppercase;
                     letter-spacing: 0.08em; margin-bottom: 0.2rem; }
    @media print { body { max-width: 100%; margin: 0; } }`,

  dark: `
    :root { --bg: #1a1a2e; --text: #e0e0e0; --accent: #e94560; --link: #4da6ff;
            --muted: #999; --border: #333; }
    body { font-family: 'Fira Sans', -apple-system, 'Segoe UI', Roboto, sans-serif;
           font-size: 15px; line-height: 1.65; color: var(--text); background: var(--bg);
           max-width: 700px; margin: 2rem auto; padding: 0 1.5rem; }
    h1 { font-size: 1.7rem; margin-bottom: 0.3rem; }
    h2 { font-size: 1.35rem; margin-top: 1.8rem; }
    a { color: var(--link); text-decoration: none; }
    a:hover { text-decoration: underline; }
    blockquote { margin: 1.2rem 0; padding: 0.5rem 1rem; border-left: 3px solid var(--accent);
                 background: #16213e; }
    code { font-family: 'Fira Code', monospace; font-size: 0.88em;
           background: #16213e; padding: 0.12em 0.25em; border-radius: 3px; }
    pre { background: #0f3460; padding: 0.8rem; border-radius: 4px; overflow-x: auto; }
    .breadcrumb { font-size: 0.82rem; color: var(--muted); margin-bottom: 1.2rem; }
    .breadcrumb a { color: var(--muted); }
    .primary-source { margin: 1.5rem 0; padding: 0.8rem 1rem; border: 1px solid var(--border);
                      border-radius: 4px; }
    .primary-source h3 { margin-top: 0; font-size: 0.9rem; color: var(--muted); }
    .related { margin: 1.5rem 0; }
    .related h3 { font-size: 0.9rem; color: var(--muted); }
    .related ul { list-style: none; padding: 0; }
    .followup-reminder { margin-top: 2.5rem; padding: 0.8rem 1rem; border: 2px solid var(--accent);
                         border-radius: 4px; background: #1a1a3e; }
    .lesson-number { font-size: 0.75rem; color: var(--muted); text-transform: uppercase;
                     letter-spacing: 0.08em; margin-bottom: 0.2rem; }
    @media print { body { max-width: 100%; margin: 0; background: #fff; color: #000; } }`,
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Generates a self-contained HTML document for a lesson or reference document.
 */
export function generateLessonHtml(options: LessonTemplateOptions): string {
  const {
    title,
    topicName,
    bodyContent,
    sequenceNumber,
    primarySource,
    relatedLessons,
    relatedReferences,
    glossaryUrl,
    style = 'tufte',
  } = options;

  const css = STYLE_PRESETS[style] ?? STYLE_PRESETS.tufte;

  const primarySourceBlock = primarySource
    ? `
    <div class="primary-source">
      <h3>Primary Source</h3>
      <p>${
        primarySource.url
          ? `<a href="${escapeHtml(primarySource.url)}" target="_blank" rel="noopener">${escapeHtml(primarySource.title)}</a>`
          : escapeHtml(primarySource.title)
      }</p>
    </div>`
    : '';

  const relatedLessonsBlock =
    relatedLessons && relatedLessons.length > 0
      ? `
    <div class="related">
      <h3>Related Lessons</h3>
      <ul>
        ${relatedLessons.map(l => `<li><a href="${escapeHtml(l.slug)}">${escapeHtml(l.title)}</a></li>`).join('\n        ')}
      </ul>
    </div>`
      : '';

  const relatedRefsBlock =
    relatedReferences && relatedReferences.length > 0
      ? `
    <div class="related">
      <h3>Related Reference Documents</h3>
      <ul>
        ${relatedReferences.map(r => `<li><a href="${escapeHtml(r.slug)}">${escapeHtml(r.title)}</a></li>`).join('\n        ')}
      </ul>
    </div>`
      : '';

  const glossaryLink = glossaryUrl
    ? `<a href="${escapeHtml(glossaryUrl)}">Glossary</a>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(topicName)} — Lesson ${sequenceNumber}: ${escapeHtml(title)}</title>
  <style>${css}
  </style>
</head>
<body>
  <nav class="breadcrumb">
    <a href="/api/teach/topics">${escapeHtml(topicName)}</a> ›
    Lesson ${sequenceNumber}${glossaryLink ? ` › ${glossaryLink}` : ''}
  </nav>

  <div class="lesson-number">Lesson ${sequenceNumber}</div>
  <h1>${escapeHtml(title)}</h1>

  ${bodyContent}

  ${primarySourceBlock}
  ${relatedLessonsBlock}
  ${relatedRefsBlock}

  <div class="followup-reminder">
    💬 Have questions about this lesson? Ask! Your teacher is here to help with anything that's unclear.
  </div>
</body>
</html>`;
}

/**
 * Generates a self-contained HTML document for a glossary page.
 */
export function generateGlossaryHtml(options: {
  topicName: string;
  description: string;
  terms: Array<{
    term: string;
    definition: string;
    avoidList?: string[];
    groupHeading?: string | null;
  }>;
  style?: 'tufte' | 'minimal' | 'dark';
}): string {
  const { topicName, description, terms, style = 'tufte' } = options;
  const css = STYLE_PRESETS[style] ?? STYLE_PRESETS.tufte;

  // Group terms by groupHeading
  const grouped = new Map<string, Array<(typeof terms)[number]>>();
  for (const term of terms) {
    const group = term.groupHeading ?? 'Terms';
    if (!grouped.has(group)) {
      grouped.set(group, []);
    }
    grouped.get(group)!.push(term);
  }

  const termsHtml = Array.from(grouped.entries())
    .map(([group, groupTerms]) => {
      const heading =
        group !== 'Terms' ? `\n    <h2>${escapeHtml(group)}</h2>` : '';
      const items = groupTerms
        .map(t => {
          const avoid =
            t.avoidList && t.avoidList.length > 0
              ? `\n      <em>Avoid:</em> ${t.avoidList.map(a => escapeHtml(a)).join(', ')}`
              : '';
          return `    <dt><strong>${escapeHtml(t.term)}</strong></dt>
    <dd>${escapeHtml(t.definition)}${avoid}</dd>`;
        })
        .join('\n');
      return `${heading}\n  <dl>\n${items}\n  </dl>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(topicName)} — Glossary</title>
  <style>${css}
    dl { margin: 1rem 0; }
    dt { font-weight: bold; margin-top: 0.8rem; }
    dd { margin: 0.2rem 0 0.5rem 1.5rem; }
  </style>
</head>
<body>
  <nav class="breadcrumb">
    <a href="/api/teach/topics">${escapeHtml(topicName)}</a> ›
    Glossary
  </nav>

  <h1>${escapeHtml(topicName)} — Glossary</h1>
  <p>${escapeHtml(description)}</p>

${termsHtml}
</body>
</html>`;
}
