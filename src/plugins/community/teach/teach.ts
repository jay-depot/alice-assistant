/**
 * Teach Plugin for A.L.I.C.E. Assistant
 *
 * Port of Matt Pocock's "teach" skill
 * (https://github.com/mattpocock/skills/tree/main/skills/productivity/teach),
 * adapted for the A.L.I.C.E. Assistant plugin ecosystem.
 *
 * Instead of workspace files, all teaching state is persisted in the database
 * via the memory plugin. Lessons and reference documents are served as HTML
 * pages through REST endpoints. The teaching workflow is registered as a
 * recallable skill through the skills plugin.
 *
 * Entities: TeachTopic, TeachMission, TeachGlossary, TeachGlossaryTerm,
 *           TeachResource, TeachLearningRecord, TeachLesson,
 *           TeachReferenceDocument, TeachNote
 */

import path from 'node:path';
import { readFile } from 'node:fs/promises';
import Type, { Static } from 'typebox';
import { AlicePlugin } from '../../../lib.js';
import {
  TeachTopic,
  TeachMission,
  TeachGlossary,
  TeachGlossaryTerm,
  TeachResource,
  TeachLearningRecord,
  TeachLesson,
  TeachReferenceDocument,
  TeachNote,
} from './db-schemas/index.js';
import { generateLessonHtml, generateGlossaryHtml } from './lesson-template.js';

// ---------------------------------------------------------------------------
// Plugin config schema
// ---------------------------------------------------------------------------

const TeachPluginConfigSchema = Type.Object({
  defaultTopicSlug: Type.Optional(
    Type.String({
      description:
        'The slug of the topic to treat as default when no topic is specified.',
    })
  ),
  lessonTemplateStyle: Type.Optional(
    Type.String({
      description:
        'CSS style preset for lesson HTML. Options: "tufte", "minimal", "dark".',
    })
  ),
  maxLearningRecordsPerTopic: Type.Optional(
    Type.Number({
      description:
        'Maximum number of learning records allowed per topic. Defaults to 1000.',
    })
  ),
});

type TeachPluginConfig = Static<typeof TeachPluginConfigSchema>;

const DEFAULT_CONFIG: TeachPluginConfig = {
  defaultTopicSlug: undefined,
  lessonTemplateStyle: 'tufte',
  maxLearningRecordsPerTopic: 1000,
};

// ---------------------------------------------------------------------------
// Tool parameter schemas
// ---------------------------------------------------------------------------

// --- create_topic ---
const CreateTopicParametersSchema = Type.Object({
  slug: Type.String({
    description:
      'A URL-safe kebab-case identifier for this topic (e.g. "typescript-generics", "yoga-basics").',
  }),
  name: Type.String({
    description:
      'A human-readable name for this topic (e.g. "TypeScript Generics", "Yoga Basics").',
  }),
});

// --- set_active_topic ---
const SetActiveTopicParametersSchema = Type.Object({
  topicSlug: Type.String({
    description: 'The slug of the topic to set as active.',
  }),
});

// --- list_topics ---
const ListTopicsParametersSchema = Type.Object({});

// --- get_mission ---
const GetMissionParametersSchema = Type.Object({
  topicSlug: Type.Optional(
    Type.String({
      description:
        'The slug of the topic. Defaults to the active topic if not specified.',
    })
  ),
});

// --- set_mission ---
const SetMissionParametersSchema = Type.Object({
  topicSlug: Type.Optional(
    Type.String({
      description:
        'The slug of the topic. Defaults to the active topic if not specified.',
    })
  ),
  why: Type.String({
    description:
      '1-3 sentences: the concrete real-world goal the user is chasing. What changes in their life or work when they have this skill?',
  }),
  successLooksLike: Type.String({
    description:
      'Bullet list of specific, observable things the user will be able to do.',
  }),
  constraints: Type.String({
    description:
      'Time, budget, prior commitments, learning preferences, anything that bounds the approach.',
  }),
  outOfScope: Type.String({
    description:
      'Adjacent topics the user explicitly does not want to chase right now.',
  }),
});

// --- add_glossary_term ---
const AddGlossaryTermParametersSchema = Type.Object({
  topicSlug: Type.Optional(
    Type.String({
      description:
        'The slug of the topic. Defaults to the active topic if not specified.',
    })
  ),
  term: Type.String({
    description: 'The canonical term name.',
  }),
  definition: Type.String({
    description:
      '1-2 sentence tight definition. Define what the term IS, not what it does.',
  }),
  avoidList: Type.Optional(
    Type.String({
      description:
        'JSON array of aliases to avoid, e.g. \'["bulking", "getting big"]\'.',
    })
  ),
  groupHeading: Type.Optional(
    Type.String({
      description:
        'Optional subheading to group this term under (e.g. "Anatomy", "Programming").',
    })
  ),
});

// --- list_glossary_terms ---
const ListGlossaryTermsParametersSchema = Type.Object({
  topicSlug: Type.Optional(
    Type.String({
      description:
        'The slug of the topic. Defaults to the active topic if not specified.',
    })
  ),
});

// --- remove_glossary_term ---
const RemoveGlossaryTermParametersSchema = Type.Object({
  topicSlug: Type.Optional(
    Type.String({
      description:
        'The slug of the topic. Defaults to the active topic if not specified.',
    })
  ),
  term: Type.String({
    description: 'The canonical term name to remove.',
  }),
});

// --- add_resource ---
const AddResourceParametersSchema = Type.Object({
  topicSlug: Type.Optional(
    Type.String({
      description:
        'The slug of the topic. Defaults to the active topic if not specified.',
    })
  ),
  category: Type.Union(
    [Type.Literal('knowledge'), Type.Literal('wisdom'), Type.Literal('gap')],
    {
      description:
        '"knowledge" for informational resources, "wisdom" for communities/practitioners, "gap" for areas where no good resource exists yet.',
    }
  ),
  title: Type.String({
    description:
      'A descriptive title, e.g. "Book: The Science and Practice of Strength Training".',
  }),
  url: Type.Optional(
    Type.String({
      description: 'URL of the resource, if available online.',
    })
  ),
  annotation: Type.String({
    description: 'One line: what it covers and when to reach for it.',
  }),
});

// --- list_resources ---
const ListResourcesParametersSchema = Type.Object({
  topicSlug: Type.Optional(
    Type.String({
      description:
        'The slug of the topic. Defaults to the active topic if not specified.',
    })
  ),
  category: Type.Optional(
    Type.Union(
      [Type.Literal('knowledge'), Type.Literal('wisdom'), Type.Literal('gap')],
      {
        description: 'Filter by resource category.',
      }
    )
  ),
});

// --- remove_resource ---
const RemoveResourceParametersSchema = Type.Object({
  topicSlug: Type.Optional(
    Type.String({
      description:
        'The slug of the topic. Defaults to the active topic if not specified.',
    })
  ),
  resourceId: Type.Number({
    description: 'The ID of the resource to remove.',
  }),
});

// --- create_learning_record ---
const CreateLearningRecordParametersSchema = Type.Object({
  topicSlug: Type.Optional(
    Type.String({
      description:
        'The slug of the topic. Defaults to the active topic if not specified.',
    })
  ),
  title: Type.String({
    description: 'Short title of what was learned or established.',
  }),
  body: Type.String({
    description:
      '1-3 sentences: what was learned (or what prior knowledge was established), and why it matters for future sessions.',
  }),
  evidence: Type.Optional(
    Type.String({
      description:
        'How the user demonstrated the understanding (a question answered, an exercise completed, prior experience cited).',
    })
  ),
  implications: Type.Optional(
    Type.String({
      description: 'What this unlocks or rules out for future sessions.',
    })
  ),
});

// --- list_learning_records ---
const ListLearningRecordsParametersSchema = Type.Object({
  topicSlug: Type.Optional(
    Type.String({
      description:
        'The slug of the topic. Defaults to the active topic if not specified.',
    })
  ),
});

// --- get_learning_record ---
const GetLearningRecordParametersSchema = Type.Object({
  topicSlug: Type.Optional(
    Type.String({
      description:
        'The slug of the topic. Defaults to the active topic if not specified.',
    })
  ),
  sequenceNumber: Type.Number({
    description: 'The sequence number of the learning record (1, 2, 3...).',
  }),
});

// --- supersede_learning_record ---
const SupersedeLearningRecordParametersSchema = Type.Object({
  topicSlug: Type.Optional(
    Type.String({
      description:
        'The slug of the topic. Defaults to the active topic if not specified.',
    })
  ),
  sequenceNumber: Type.Number({
    description: 'The sequence number of the learning record being superseded.',
  }),
  supersededByNumber: Type.Number({
    description: 'The sequence number of the learning record that replaces it.',
  }),
});

// --- create_lesson ---
const CreateLessonParametersSchema = Type.Object({
  topicSlug: Type.Optional(
    Type.String({
      description:
        'The slug of the topic. Defaults to the active topic if not specified.',
    })
  ),
  title: Type.String({
    description: 'A short, descriptive title for the lesson.',
  }),
  slug: Type.String({
    description:
      'A URL-safe kebab-case slug for the lesson (e.g. "intro-to-closures").',
  }),
  bodyMarkdown: Type.String({
    description:
      'The lesson content in markdown format. Will be converted to HTML and wrapped in a beautiful template with navigation, citation block, and followup reminder.',
  }),
  primarySourceTitle: Type.Optional(
    Type.String({
      description: 'Title of the primary source to cite.',
    })
  ),
  primarySourceUrl: Type.Optional(
    Type.String({
      description: 'URL of the primary source to cite.',
    })
  ),
  relatedLessonSlugs: Type.Optional(
    Type.Array(Type.String(), {
      description: 'Slugs of related lessons to link from this lesson.',
    })
  ),
  relatedRefSlugs: Type.Optional(
    Type.Array(Type.String(), {
      description:
        'Slugs of related reference documents to link from this lesson.',
    })
  ),
});

// --- list_lessons ---
const ListLessonsParametersSchema = Type.Object({
  topicSlug: Type.Optional(
    Type.String({
      description:
        'The slug of the topic. Defaults to the active topic if not specified.',
    })
  ),
});

// --- get_lesson_url ---
const GetLessonUrlParametersSchema = Type.Object({
  topicSlug: Type.Optional(
    Type.String({
      description:
        'The slug of the topic. Defaults to the active topic if not specified.',
    })
  ),
  lessonSlug: Type.String({
    description: 'The slug of the lesson.',
  }),
});

// --- create_reference_document ---
const CreateReferenceDocumentParametersSchema = Type.Object({
  topicSlug: Type.Optional(
    Type.String({
      description:
        'The slug of the topic. Defaults to the active topic if not specified.',
    })
  ),
  title: Type.String({
    description: 'Title of the reference document.',
  }),
  slug: Type.String({
    description: 'A URL-safe kebab-case slug for the reference document.',
  }),
  htmlContent: Type.String({
    description:
      'The full HTML content of the reference document. This will be wrapped in a styled template.',
  }),
  category: Type.Union(
    [
      Type.Literal('cheat-sheet'),
      Type.Literal('glossary'),
      Type.Literal('algorithm'),
      Type.Literal('syntax'),
      Type.Literal('other'),
    ],
    {
      description: 'The category of this reference document.',
    }
  ),
});

// --- list_reference_documents ---
const ListReferenceDocumentsParametersSchema = Type.Object({
  topicSlug: Type.Optional(
    Type.String({
      description:
        'The slug of the topic. Defaults to the active topic if not specified.',
    })
  ),
});

// --- get_reference_url ---
const GetReferenceUrlParametersSchema = Type.Object({
  topicSlug: Type.Optional(
    Type.String({
      description:
        'The slug of the topic. Defaults to the active topic if not specified.',
    })
  ),
  refSlug: Type.String({
    description: 'The slug of the reference document.',
  }),
});

// --- add_note ---
const AddNoteParametersSchema = Type.Object({
  topicSlug: Type.Optional(
    Type.String({
      description:
        'The slug of the topic. Defaults to the active topic if not specified.',
    })
  ),
  content: Type.String({
    description:
      'The note content to add. Notes are appended to the existing notes for the topic.',
  }),
});

// --- get_notes ---
const GetNotesParametersSchema = Type.Object({
  topicSlug: Type.Optional(
    Type.String({
      description:
        'The slug of the topic. Defaults to the active topic if not specified.',
    })
  ),
});

// --- get_glossary_url ---
const GetGlossaryUrlParametersSchema = Type.Object({
  topicSlug: Type.Optional(
    Type.String({
      description:
        'The slug of the topic. Defaults to the active topic if not specified.',
    })
  ),
});

// --- delete_topic ---
const DeleteTopicParametersSchema = Type.Object({
  topicSlug: Type.String({
    description: 'The slug of the topic to delete.',
  }),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function markdownToHtmlSimple(markdown: string): string {
  // A simple markdown-to-HTML converter for lesson content.
  // Not a full CommonMark parser — handles the most common constructs
  // that a teaching assistant would use.
  let html = markdown;

  // Headers (must come before other transformations)
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // Bold and italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Links
  html = html.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener">$1</a>'
  );

  // Code blocks (fenced)
  html = html.replace(
    /```(\w*)\n([\s\S]*?)```/g,
    (_match, lang, code) =>
      `<pre><code${lang ? ` class="language-${lang}"` : ''}>${code.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre>`
  );

  // Unordered lists (simple — consecutive lines starting with -)
  html = html.replace(
    /(?:^|\n)((?:- .+\n?)+)/g,
    (_match, listBlock: string) => {
      const items = listBlock
        .trim()
        .split('\n')
        .map(line => line.replace(/^- /, ''))
        .map(item => `<li>${item.trim()}</li>`)
        .join('\n');
      return `\n<ul>\n${items}\n</ul>`;
    }
  );

  // Blockquotes
  html = html.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>');

  // Paragraphs — wrap lines that aren't already inside HTML tags
  html = html
    .split('\n\n')
    .map(block => {
      const trimmed = block.trim();
      if (!trimmed) return '';
      if (trimmed.startsWith('<')) return trimmed;
      return `<p>${trimmed}</p>`;
    })
    .join('\n');

  return html;
}

// ---------------------------------------------------------------------------
// Plugin definition
// ---------------------------------------------------------------------------

const teachPlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'teach',
    name: 'Teach Plugin',
    brandColor: '#2d8cf0',
    description:
      'A stateful, multi-session teaching assistant based on Matt Pocock\'s "teach" skill. ' +
      'Manages teaching topics with missions, glossaries, learning records, lessons, ' +
      'reference documents, and resources. Lessons are served as beautiful HTML pages ' +
      'viewable in a browser. All state is persisted in the database.',
    version: 'LATEST',
    dependencies: [
      { id: 'memory', version: 'LATEST' },
      { id: 'skills', version: 'LATEST' },
      { id: 'rest-serve', version: 'LATEST' },
    ],
    required: false,
  },

  async registerPlugin(pluginInterface) {
    const plugin = await pluginInterface.registerPlugin();
    const config = await plugin.config(TeachPluginConfigSchema, DEFAULT_CONFIG);

    // --- Request dependencies ---
    const memory = plugin.request('memory')!;
    const skills = plugin.request('skills')!;
    const restServe = plugin.request('rest-serve');

    // --- Register database models ---
    memory.registerDatabaseModels([
      TeachTopic,
      TeachMission,
      TeachGlossary,
      TeachGlossaryTerm,
      TeachResource,
      TeachLearningRecord,
      TeachLesson,
      TeachReferenceDocument,
      TeachNote,
    ]);

    const awaitForOrm = memory.onDatabaseReady(async orm => orm);

    // --- Register the teach skill ---
    const skillPath = path.join(import.meta.dirname, 'teach-skill.md');
    try {
      const skillContent = await readFile(skillPath, 'utf-8');
      skills.registerSkill({
        id: 'teach',
        recallWhen:
          'the user asks to learn something, be taught a topic, understand a concept, ' +
          'or requests a lesson on any subject. Also recall when the user wants to continue ' +
          'a previously started learning topic.',
        contents: skillContent,
      });
    } catch (error) {
      plugin.logger.warn(
        `Failed to load teach skill from ${skillPath}: ${error}`
      );
    }

    // --- Helper: resolve topic from slug or active default ---
    async function resolveTopic(
      topicSlug?: string
    ): Promise<{ id: number; slug: string; name: string } | null> {
      const orm = await awaitForOrm;
      const em = orm.em.fork();

      if (topicSlug) {
        return await em.findOne(TeachTopic, { slug: topicSlug });
      }

      // Try the config default
      const defaultSlug = config.getPluginConfig().defaultTopicSlug;
      if (defaultSlug) {
        const found = await em.findOne(TeachTopic, {
          slug: defaultSlug,
          active: true,
        });
        if (found) return found;
      }

      // Fall back to the first active topic
      return await em.findOne(TeachTopic, { active: true });
    }

    // --- Helper: format topic summary ---
    function formatTopicSummary(topic: {
      id: number;
      slug: string;
      name: string;
      active: boolean;
    }): string {
      return `- **${topic.name}** (slug: \`${topic.slug}\`${topic.active ? ', **active**' : ''})`;
    }

    // =========================================================================
    // REST Routes (for serving lessons, references, and glossaries as HTML)
    // =========================================================================

    if (restServe) {
      const app = restServe.express;

      // List topics
      app.get('/api/teach/topics', async (_req, res) => {
        try {
          const orm = await awaitForOrm;
          const em = orm.em.fork();
          const topics = await em.find(
            TeachTopic,
            {},
            { orderBy: { id: 'ASC' } }
          );
          res.json(
            topics.map(t => ({
              id: t.id,
              slug: t.slug,
              name: t.name,
              active: t.active,
            }))
          );
        } catch {
          res.status(500).json({ error: 'Failed to list topics' });
        }
      });

      // Serve a lesson as HTML
      app.get(
        '/api/teach/topics/:topicSlug/lessons/:lessonSlug',
        async (req, res) => {
          try {
            const orm = await awaitForOrm;
            const em = orm.em.fork();
            const topic = await em.findOne(TeachTopic, {
              slug: req.params.topicSlug,
            });
            if (!topic) {
              res.status(404).send('Topic not found');
              return;
            }
            const lesson = await em.findOne(TeachLesson, {
              topic: topic.id,
              slug: req.params.lessonSlug,
            });
            if (!lesson) {
              res.status(404).send('Lesson not found');
              return;
            }

            // Find related lessons and references for the template
            const relatedLessons = await em.find(TeachLesson, {
              topic: topic.id,
              id: { $ne: lesson.id },
            });

            const relatedRefs = await em.find(TeachReferenceDocument, {
              topic: topic.id,
            });

            const style = (config.getPluginConfig().lessonTemplateStyle ??
              'tufte') as 'tufte' | 'minimal' | 'dark';

            const html = generateLessonHtml({
              title: lesson.title,
              topicName: topic.name,
              bodyContent: lesson.htmlContent,
              sequenceNumber: lesson.sequenceNumber,
              primarySource: lesson.primarySourceTitle
                ? {
                    title: lesson.primarySourceTitle,
                    url: lesson.primarySourceUrl ?? undefined,
                  }
                : undefined,
              relatedLessons: relatedLessons.map(l => ({
                slug: `/api/teach/topics/${topic.slug}/lessons/${l.slug}`,
                title: l.title,
              })),
              relatedReferences: relatedRefs.map(r => ({
                slug: `/api/teach/topics/${topic.slug}/reference/${r.slug}`,
                title: r.title,
              })),
              glossaryUrl: `/api/teach/topics/${topic.slug}/glossary`,
              style,
            });

            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.setHeader('Cache-Control', 'no-store');
            res.send(html);
          } catch {
            res.status(500).send('Failed to load lesson');
          }
        }
      );

      // Serve a reference document as HTML
      app.get(
        '/api/teach/topics/:topicSlug/reference/:refSlug',
        async (req, res) => {
          try {
            const orm = await awaitForOrm;
            const em = orm.em.fork();
            const topic = await em.findOne(TeachTopic, {
              slug: req.params.topicSlug,
            });
            if (!topic) {
              res.status(404).send('Topic not found');
              return;
            }
            const ref = await em.findOne(TeachReferenceDocument, {
              topic: topic.id,
              slug: req.params.refSlug,
            });
            if (!ref) {
              res.status(404).send('Reference document not found');
              return;
            }

            const style = (config.getPluginConfig().lessonTemplateStyle ??
              'tufte') as 'tufte' | 'minimal' | 'dark';

            const html = generateLessonHtml({
              title: ref.title,
              topicName: topic.name,
              bodyContent: ref.htmlContent,
              sequenceNumber: 0, // reference docs don't have sequence numbers
              primarySource: undefined,
              glossaryUrl: `/api/teach/topics/${topic.slug}/glossary`,
              style,
            });

            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.setHeader('Cache-Control', 'no-store');
            res.send(html);
          } catch {
            res.status(500).send('Failed to load reference document');
          }
        }
      );

      // Serve the glossary as HTML
      app.get('/api/teach/topics/:topicSlug/glossary', async (req, res) => {
        try {
          const orm = await awaitForOrm;
          const em = orm.em.fork();
          const topic = await em.findOne(TeachTopic, {
            slug: req.params.topicSlug,
          });
          if (!topic) {
            res.status(404).send('Topic not found');
            return;
          }
          const glossary = await em.findOne(TeachGlossary, {
            topic: topic.id,
          });
          const terms = glossary
            ? await em.find(TeachGlossaryTerm, {
                glossary: glossary.id,
              })
            : [];

          const style = (config.getPluginConfig().lessonTemplateStyle ??
            'tufte') as 'tufte' | 'minimal' | 'dark';

          const html = generateGlossaryHtml({
            topicName: topic.name,
            description: glossary?.description ?? `Glossary for ${topic.name}`,
            terms: terms.map(t => ({
              term: t.term,
              definition: t.definition,
              avoidList: t.avoidList ? JSON.parse(t.avoidList) : undefined,
              groupHeading: t.groupHeading,
            })),
            style,
          });

          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          res.send(html);
        } catch {
          res.status(500).send('Failed to load glossary');
        }
      });
    }

    // =========================================================================
    // Tools
    // =========================================================================

    plugin.registerTool({
      name: 'create_topic',
      description:
        'Create a new teaching topic. A topic is the top-level container for everything ' +
        'about one subject — its mission, glossary, resources, learning records, lessons, ' +
        'reference documents, and notes. Use this when the user asks to learn something and ' +
        'no topic exists yet.',
      availableFor: ['chat', 'voice', 'autonomy'],
      systemPromptFragment:
        'The teach plugin allows you to manage multi-session teaching topics. ' +
        'When the user wants to learn something, create a topic and then interview them ' +
        'about their mission — why they want to learn this, what success looks like, and ' +
        'any constraints or out-of-scope areas.',
      parameters: CreateTopicParametersSchema,
      execute: async (args: Static<typeof CreateTopicParametersSchema>) => {
        const orm = await awaitForOrm;
        const em = orm.em.fork();

        // Check for duplicate slug
        const existing = await em.findOne(TeachTopic, { slug: args.slug });
        if (existing) {
          return `A topic with slug "${args.slug}" already exists. Use a different slug or continue with the existing topic.`;
        }

        const now = new Date();
        // If this is the first topic, make it active by default
        const topicCount = await em.count(TeachTopic, {});
        const topic = em.create(TeachTopic, {
          slug: args.slug,
          name: args.name,
          active: topicCount === 0,
          createdAt: now,
          updatedAt: now,
        });
        em.persist(topic);
        await em.flush();

        return `Created teaching topic "${args.name}" (slug: \`${args.slug}\`). ${topicCount === 0 ? 'This topic is now the active topic.' : 'Use teach.set_active_topic to switch to it.'} Next, interview the user about their mission and use teach.set_mission to capture it.`;
      },
    });

    plugin.registerTool({
      name: 'set_active_topic',
      description:
        'Set the active teaching topic. The active topic is used as the default when ' +
        'other teach tools do not specify a topic explicitly.',
      availableFor: ['chat', 'voice', 'autonomy'],
      systemPromptFragment: '',
      parameters: SetActiveTopicParametersSchema,
      execute: async (args: Static<typeof SetActiveTopicParametersSchema>) => {
        const orm = await awaitForOrm;
        const em = orm.em.fork();

        const topic = await em.findOne(TeachTopic, { slug: args.topicSlug });
        if (!topic) {
          return `No topic with slug "${args.topicSlug}" found. Use teach.list_topics to see available topics.`;
        }

        // Deactivate all topics
        const allTopics = await em.find(TeachTopic, {});
        for (const t of allTopics) {
          t.active = false;
        }
        topic.active = true;
        await em.flush();

        return `Active topic is now "${topic.name}" (${topic.slug}).`;
      },
    });

    plugin.registerTool({
      name: 'list_topics',
      description:
        'List all teaching topics. Returns the name, slug, and active status of each topic.',
      availableFor: ['chat', 'voice', 'autonomy'],
      systemPromptFragment: '',
      parameters: ListTopicsParametersSchema,
      execute: async () => {
        const orm = await awaitForOrm;
        const em = orm.em.fork();
        const topics = await em.find(
          TeachTopic,
          {},
          { orderBy: { id: 'ASC' } }
        );

        if (topics.length === 0) {
          return 'No teaching topics exist yet. Use teach.create_topic to create one.';
        }

        return topics.map(formatTopicSummary).join('\n');
      },
    });

    plugin.registerTool({
      name: 'get_mission',
      description:
        'Get the mission for a teaching topic. The mission captures why the user is ' +
        'learning this topic, what success looks like, and any constraints or out-of-scope areas.',
      availableFor: ['chat', 'voice', 'autonomy'],
      systemPromptFragment: '',
      parameters: GetMissionParametersSchema,
      execute: async (args: Static<typeof GetMissionParametersSchema>) => {
        const topic = await resolveTopic(args.topicSlug);
        if (!topic) {
          return args.topicSlug
            ? `No topic with slug "${args.topicSlug}" found.`
            : 'No active topic. Use teach.create_topic to create one, or teach.set_active_topic to switch.';
        }

        const orm = await awaitForOrm;
        const em = orm.em.fork();
        const mission = await em.findOne(TeachMission, { topic: topic.id });

        if (!mission) {
          return `No mission has been set for "${topic.name}" yet. Interview the user about why they want to learn this and use teach.set_mission to capture it.`;
        }

        return [
          `**Mission: ${topic.name}**`,
          '',
          `**Why:** ${mission.why}`,
          '',
          `**Success looks like:**`,
          mission.successLooksLike,
          '',
          `**Constraints:**`,
          mission.constraints,
          '',
          `**Out of scope:**`,
          mission.outOfScope,
        ].join('\n');
      },
    });

    plugin.registerTool({
      name: 'set_mission',
      description:
        'Create or update the mission for a teaching topic. The mission captures why the user ' +
        'is learning this topic, what success looks like, and any constraints. Every teaching ' +
        'decision should trace back to the mission.',
      availableFor: ['chat', 'voice', 'autonomy'],
      systemPromptFragment: '',
      parameters: SetMissionParametersSchema,
      execute: async (args: Static<typeof SetMissionParametersSchema>) => {
        const topic = await resolveTopic(args.topicSlug);
        if (!topic) {
          return args.topicSlug
            ? `No topic with slug "${args.topicSlug}" found.`
            : 'No active topic. Use teach.create_topic to create one first.';
        }

        const orm = await awaitForOrm;
        const em = orm.em.fork();
        const now = new Date();

        let mission = await em.findOne(TeachMission, { topic: topic.id });
        if (mission) {
          mission.why = args.why;
          mission.successLooksLike = args.successLooksLike;
          mission.constraints = args.constraints;
          mission.outOfScope = args.outOfScope;
          mission.updatedAt = now;
        } else {
          mission = em.create(TeachMission, {
            topic: topic.id,
            why: args.why,
            successLooksLike: args.successLooksLike,
            constraints: args.constraints,
            outOfScope: args.outOfScope,
            createdAt: now,
            updatedAt: now,
          });
          em.persist(mission);
        }
        await em.flush();

        return `Mission ${mission!.updatedAt === now && mission!.createdAt !== now ? 'updated' : 'set'} for "${topic.name}". Every lesson should be tied to this mission. You can review it anytime with teach.get_mission.`;
      },
    });

    plugin.registerTool({
      name: 'add_glossary_term',
      description:
        'Add or update a glossary term for a teaching topic. Only add a term when the user ' +
        'has demonstrated understanding of it — the glossary is a record of compressed knowledge, ' +
        'not a dictionary. Be opinionated: pick the best term and list alternatives as "avoid".',
      availableFor: ['chat', 'voice', 'autonomy'],
      systemPromptFragment: '',
      parameters: AddGlossaryTermParametersSchema,
      execute: async (args: Static<typeof AddGlossaryTermParametersSchema>) => {
        const topic = await resolveTopic(args.topicSlug);
        if (!topic) {
          return args.topicSlug
            ? `No topic with slug "${args.topicSlug}" found.`
            : 'No active topic.';
        }

        const orm = await awaitForOrm;
        const em = orm.em.fork();
        const now = new Date();

        // Ensure glossary exists for this topic
        let glossary = await em.findOne(TeachGlossary, { topic: topic.id });
        if (!glossary) {
          glossary = em.create(TeachGlossary, {
            topic: topic.id,
            description: `Glossary for ${topic.name}`,
            createdAt: now,
            updatedAt: now,
          });
          em.persist(glossary);
          await em.flush();
        }

        // Upsert: find existing term or create new
        let term = await em.findOne(TeachGlossaryTerm, {
          glossary: glossary.id,
          term: args.term,
        });

        if (term) {
          term.definition = args.definition;
          if (args.avoidList !== undefined) term.avoidList = args.avoidList;
          if (args.groupHeading !== undefined)
            term.groupHeading = args.groupHeading;
          term.updatedAt = now;
        } else {
          term = em.create(TeachGlossaryTerm, {
            glossary: glossary.id,
            term: args.term,
            definition: args.definition,
            avoidList: args.avoidList ?? '[]',
            groupHeading: args.groupHeading ?? null,
            createdAt: now,
            updatedAt: now,
          });
          em.persist(term);
        }
        await em.flush();

        return `Glossary term "${args.term}" ${term!.updatedAt === now && term!.createdAt !== now ? 'updated' : 'added'} for "${topic.name}".`;
      },
    });

    plugin.registerTool({
      name: 'list_glossary_terms',
      description:
        'List all glossary terms for a teaching topic. The glossary is the canonical ' +
        'language for this topic — once a term is defined here, use it consistently.',
      availableFor: ['chat', 'voice', 'autonomy'],
      systemPromptFragment: '',
      parameters: ListGlossaryTermsParametersSchema,
      execute: async (
        args: Static<typeof ListGlossaryTermsParametersSchema>
      ) => {
        const topic = await resolveTopic(args.topicSlug);
        if (!topic) {
          return args.topicSlug
            ? `No topic with slug "${args.topicSlug}" found.`
            : 'No active topic.';
        }

        const orm = await awaitForOrm;
        const em = orm.em.fork();
        const glossary = await em.findOne(TeachGlossary, { topic: topic.id });

        if (!glossary) {
          return `No glossary for "${topic.name}" yet. Add terms with teach.add_glossary_term.`;
        }

        const terms = await em.find(TeachGlossaryTerm, {
          glossary: glossary.id,
        });

        if (terms.length === 0) {
          return `No glossary terms for "${topic.name}" yet. Add terms with teach.add_glossary_term.`;
        }

        return terms
          .map(t => {
            const avoid =
              t.avoidList && t.avoidList !== '[]'
                ? ` (avoid: ${t.avoidList})`
                : '';
            const group = t.groupHeading ? ` [${t.groupHeading}]` : '';
            return `- **${t.term}**${group}: ${t.definition}${avoid}`;
          })
          .join('\n');
      },
    });

    plugin.registerTool({
      name: 'remove_glossary_term',
      description: 'Remove a glossary term from a teaching topic.',
      availableFor: ['chat', 'voice', 'autonomy'],
      systemPromptFragment: '',
      parameters: RemoveGlossaryTermParametersSchema,
      execute: async (
        args: Static<typeof RemoveGlossaryTermParametersSchema>
      ) => {
        const topic = await resolveTopic(args.topicSlug);
        if (!topic) {
          return args.topicSlug
            ? `No topic with slug "${args.topicSlug}" found.`
            : 'No active topic.';
        }

        const orm = await awaitForOrm;
        const em = orm.em.fork();
        const glossary = await em.findOne(TeachGlossary, { topic: topic.id });

        if (!glossary) {
          return `No glossary for "${topic.name}".`;
        }

        const term = await em.findOne(TeachGlossaryTerm, {
          glossary: glossary.id,
          term: args.term,
        });

        if (!term) {
          return `Term "${args.term}" not found in the glossary for "${topic.name}".`;
        }

        await em.remove(term).flush();
        return `Removed glossary term "${args.term}" from "${topic.name}".`;
      },
    });

    plugin.registerTool({
      name: 'add_resource',
      description:
        'Add a curated resource to a teaching topic. Resources should be high-trust only — ' +
        'prefer primary sources, recognised experts, and peer-reviewed work. ' +
        'Category "knowledge" for informational resources, "wisdom" for communities/practitioners, ' +
        '"gap" for areas where no good resource exists yet.',
      availableFor: ['chat', 'voice', 'autonomy'],
      systemPromptFragment: '',
      parameters: AddResourceParametersSchema,
      execute: async (args: Static<typeof AddResourceParametersSchema>) => {
        const topic = await resolveTopic(args.topicSlug);
        if (!topic) {
          return args.topicSlug
            ? `No topic with slug "${args.topicSlug}" found.`
            : 'No active topic.';
        }

        const orm = await awaitForOrm;
        const em = orm.em.fork();
        const now = new Date();

        const resource = em.create(TeachResource, {
          topic: topic.id,
          category: args.category,
          title: args.title,
          url: args.url ?? null,
          annotation: args.annotation,
          createdAt: now,
          updatedAt: now,
        });
        em.persist(resource);
        await em.flush();

        return `Added ${args.category} resource "${args.title}" to "${topic.name}".`;
      },
    });

    plugin.registerTool({
      name: 'list_resources',
      description:
        'List curated resources for a teaching topic. Optionally filter by category.',
      availableFor: ['chat', 'voice', 'autonomy'],
      systemPromptFragment: '',
      parameters: ListResourcesParametersSchema,
      execute: async (args: Static<typeof ListResourcesParametersSchema>) => {
        const topic = await resolveTopic(args.topicSlug);
        if (!topic) {
          return args.topicSlug
            ? `No topic with slug "${args.topicSlug}" found.`
            : 'No active topic.';
        }

        const orm = await awaitForOrm;
        const em = orm.em.fork();
        const filter: Record<string, unknown> = { topic: topic.id };
        if (args.category) {
          filter.category = args.category;
        }
        const resources = await em.find(TeachResource, filter, {
          orderBy: { id: 'ASC' },
        });

        if (resources.length === 0) {
          return `No resources for "${topic.name}" yet. Add them with teach.add_resource.`;
        }

        return resources
          .map(r => {
            const url = r.url ? ` — ${r.url}` : '';
            return `- [${r.category}] **${r.title}**${url}\n  ${r.annotation}`;
          })
          .join('\n\n');
      },
    });

    plugin.registerTool({
      name: 'remove_resource',
      description: 'Remove a resource from a teaching topic by its ID.',
      availableFor: ['chat', 'voice', 'autonomy'],
      systemPromptFragment: '',
      parameters: RemoveResourceParametersSchema,
      execute: async (args: Static<typeof RemoveResourceParametersSchema>) => {
        const topic = await resolveTopic(args.topicSlug);
        if (!topic) {
          return args.topicSlug
            ? `No topic with slug "${args.topicSlug}" found.`
            : 'No active topic.';
        }

        const orm = await awaitForOrm;
        const em = orm.em.fork();
        const resource = await em.findOne(TeachResource, {
          topic: topic.id,
          id: args.resourceId,
        });

        if (!resource) {
          return `Resource with ID ${args.resourceId} not found in "${topic.name}".`;
        }

        const title = resource.title;
        await em.remove(resource).flush();
        return `Removed resource "${title}" from "${topic.name}".`;
      },
    });

    plugin.registerTool({
      name: 'create_learning_record',
      description:
        'Create a numbered learning record for a teaching topic. Learning records capture ' +
        'non-obvious lessons, key insights, and stated prior knowledge — like ADRs for learning. ' +
        'Create one when the user demonstrates genuine understanding, discloses prior knowledge, ' +
        'corrects a misconception, or the mission shifts.',
      availableFor: ['chat', 'voice', 'autonomy'],
      systemPromptFragment: '',
      parameters: CreateLearningRecordParametersSchema,
      execute: async (
        args: Static<typeof CreateLearningRecordParametersSchema>
      ) => {
        const topic = await resolveTopic(args.topicSlug);
        if (!topic) {
          return args.topicSlug
            ? `No topic with slug "${args.topicSlug}" found.`
            : 'No active topic.';
        }

        const orm = await awaitForOrm;
        const em = orm.em.fork();
        const now = new Date();

        // Auto-increment sequence number
        const existingRecords = await em.find(TeachLearningRecord, {
          topic: topic.id,
        });
        const nextSeq =
          existingRecords.length > 0
            ? Math.max(...existingRecords.map(r => r.sequenceNumber)) + 1
            : 1;

        const maxRecords =
          config.getPluginConfig().maxLearningRecordsPerTopic ?? 1000;
        if (nextSeq > maxRecords) {
          return `Cannot create more learning records for "${topic.name}". Maximum of ${maxRecords} reached.`;
        }

        const record = em.create(TeachLearningRecord, {
          topic: topic.id,
          sequenceNumber: nextSeq,
          title: args.title,
          body: args.body,
          status: 'active',
          evidence: args.evidence ?? null,
          implications: args.implications ?? null,
          createdAt: now,
          updatedAt: now,
        });
        em.persist(record);
        await em.flush();

        let result = `Created learning record LR-${String(nextSeq).padStart(4, '0')} "${args.title}" for "${topic.name}".`;
        if (args.evidence) {
          result += `\nEvidence: ${args.evidence}`;
        }
        if (args.implications) {
          result += `\nImplications: ${args.implications}`;
        }
        return result;
      },
    });

    plugin.registerTool({
      name: 'list_learning_records',
      description:
        'List learning records for a teaching topic. Learning records help determine ' +
        "the user's zone of proximal development — what they've already learned and " +
        'what misconceptions have been corrected.',
      availableFor: ['chat', 'voice', 'autonomy'],
      systemPromptFragment: '',
      parameters: ListLearningRecordsParametersSchema,
      execute: async (
        args: Static<typeof ListLearningRecordsParametersSchema>
      ) => {
        const topic = await resolveTopic(args.topicSlug);
        if (!topic) {
          return args.topicSlug
            ? `No topic with slug "${args.topicSlug}" found.`
            : 'No active topic.';
        }

        const orm = await awaitForOrm;
        const em = orm.em.fork();
        const records = await em.find(
          TeachLearningRecord,
          { topic: topic.id },
          { orderBy: { sequenceNumber: 'ASC' } }
        );

        if (records.length === 0) {
          return `No learning records for "${topic.name}" yet. Create one with teach.create_learning_record when the user demonstrates genuine understanding.`;
        }

        return records
          .map(r => {
            const status = r.status !== 'active' ? ` [${r.status}]` : '';
            return `- **LR-${String(r.sequenceNumber).padStart(4, '0')}**: ${r.title}${status}\n  ${r.body}`;
          })
          .join('\n\n');
      },
    });

    plugin.registerTool({
      name: 'get_learning_record',
      description:
        'Get the full details of a specific learning record by its sequence number.',
      availableFor: ['chat', 'voice', 'autonomy'],
      systemPromptFragment: '',
      parameters: GetLearningRecordParametersSchema,
      execute: async (
        args: Static<typeof GetLearningRecordParametersSchema>
      ) => {
        const topic = await resolveTopic(args.topicSlug);
        if (!topic) {
          return args.topicSlug
            ? `No topic with slug "${args.topicSlug}" found.`
            : 'No active topic.';
        }

        const orm = await awaitForOrm;
        const em = orm.em.fork();
        const record = await em.findOne(TeachLearningRecord, {
          topic: topic.id,
          sequenceNumber: args.sequenceNumber,
        });

        if (!record) {
          return `Learning record LR-${String(args.sequenceNumber).padStart(4, '0')} not found for "${topic.name}".`;
        }

        const lines = [
          `**LR-${String(record.sequenceNumber).padStart(4, '0')}: ${record.title}**`,
          '',
          record.body,
          `Status: ${record.status}`,
        ];
        if (record.evidence) lines.push(`Evidence: ${record.evidence}`);
        if (record.implications)
          lines.push(`Implications: ${record.implications}`);
        return lines.join('\n');
      },
    });

    plugin.registerTool({
      name: 'supersede_learning_record',
      description:
        "Mark a learning record as superseded by a later one. Use when the user's " +
        'understanding has deepened or a previous record was wrong.',
      availableFor: ['chat', 'voice', 'autonomy'],
      systemPromptFragment: '',
      parameters: SupersedeLearningRecordParametersSchema,
      execute: async (
        args: Static<typeof SupersedeLearningRecordParametersSchema>
      ) => {
        const topic = await resolveTopic(args.topicSlug);
        if (!topic) {
          return args.topicSlug
            ? `No topic with slug "${args.topicSlug}" found.`
            : 'No active topic.';
        }

        const orm = await awaitForOrm;
        const em = orm.em.fork();

        const oldRecord = await em.findOne(TeachLearningRecord, {
          topic: topic.id,
          sequenceNumber: args.sequenceNumber,
        });

        if (!oldRecord) {
          return `Learning record LR-${String(args.sequenceNumber).padStart(4, '0')} not found for "${topic.name}".`;
        }

        oldRecord.status = `superseded by LR-${String(args.supersededByNumber).padStart(4, '0')}`;
        oldRecord.updatedAt = new Date();
        await em.flush();

        return `Learning record LR-${String(args.sequenceNumber).padStart(4, '0')} has been superseded by LR-${String(args.supersededByNumber).padStart(4, '0')}.`;
      },
    });

    plugin.registerTool({
      name: 'create_lesson',
      description:
        'Create a new lesson for a teaching topic. A lesson is a self-contained HTML page ' +
        'that teaches one tightly-scoped thing tied to the mission. It should be short, ' +
        'beautiful, and give the user a single tangible win. Include a primary source citation.',
      availableFor: ['chat', 'voice', 'autonomy'],
      systemPromptFragment: '',
      parameters: CreateLessonParametersSchema,
      execute: async (args: Static<typeof CreateLessonParametersSchema>) => {
        const topic = await resolveTopic(args.topicSlug);
        if (!topic) {
          return args.topicSlug
            ? `No topic with slug "${args.topicSlug}" found.`
            : 'No active topic.';
        }

        const orm = await awaitForOrm;
        const em = orm.em.fork();
        const now = new Date();

        // Check for duplicate slug
        const existing = await em.findOne(TeachLesson, {
          topic: topic.id,
          slug: args.slug,
        });
        if (existing) {
          return `A lesson with slug "${args.slug}" already exists in "${topic.name}". Use a different slug or update the existing lesson.`;
        }

        // Auto-increment sequence number
        const existingLessons = await em.find(TeachLesson, {
          topic: topic.id,
        });
        const nextSeq =
          existingLessons.length > 0
            ? Math.max(...existingLessons.map(l => l.sequenceNumber)) + 1
            : 1;

        // Convert markdown to HTML
        const htmlContent = markdownToHtmlSimple(args.bodyMarkdown);

        const lesson = em.create(TeachLesson, {
          topic: topic.id,
          sequenceNumber: nextSeq,
          title: args.title,
          slug: args.slug,
          htmlContent,
          primarySourceTitle: args.primarySourceTitle ?? null,
          primarySourceUrl: args.primarySourceUrl ?? null,
          createdAt: now,
          updatedAt: now,
        });
        em.persist(lesson);
        await em.flush();

        const lessonUrl = `/api/teach/topics/${topic.slug}/lessons/${args.slug}`;
        return `Created lesson ${nextSeq}: "${args.title}" for "${topic.name}".\nView it at: ${lessonUrl}`;
      },
    });

    plugin.registerTool({
      name: 'list_lessons',
      description: 'List all lessons for a teaching topic.',
      availableFor: ['chat', 'voice', 'autonomy'],
      systemPromptFragment: '',
      parameters: ListLessonsParametersSchema,
      execute: async (args: Static<typeof ListLessonsParametersSchema>) => {
        const topic = await resolveTopic(args.topicSlug);
        if (!topic) {
          return args.topicSlug
            ? `No topic with slug "${args.topicSlug}" found.`
            : 'No active topic.';
        }

        const orm = await awaitForOrm;
        const em = orm.em.fork();
        const lessons = await em.find(
          TeachLesson,
          { topic: topic.id },
          { orderBy: { sequenceNumber: 'ASC' } }
        );

        if (lessons.length === 0) {
          return `No lessons for "${topic.name}" yet. Create one with teach.create_lesson.`;
        }

        return lessons
          .map(l => {
            const url = `/api/teach/topics/${topic.slug}/lessons/${l.slug}`;
            return `- **${l.sequenceNumber}. ${l.title}** — [View lesson](${url})`;
          })
          .join('\n');
      },
    });

    plugin.registerTool({
      name: 'get_lesson_url',
      description:
        'Get the URL to view a lesson in the browser. Share this URL with the user ' +
        'so they can open the lesson as a beautiful, self-contained HTML page.',
      availableFor: ['chat', 'voice', 'autonomy'],
      systemPromptFragment: '',
      parameters: GetLessonUrlParametersSchema,
      execute: async (args: Static<typeof GetLessonUrlParametersSchema>) => {
        const topic = await resolveTopic(args.topicSlug);
        if (!topic) {
          return args.topicSlug
            ? `No topic with slug "${args.topicSlug}" found.`
            : 'No active topic.';
        }

        const orm = await awaitForOrm;
        const em = orm.em.fork();
        const lesson = await em.findOne(TeachLesson, {
          topic: topic.id,
          slug: args.lessonSlug,
        });

        if (!lesson) {
          return `Lesson with slug "${args.lessonSlug}" not found in "${topic.name}".`;
        }

        const url = `/api/teach/topics/${topic.slug}/lessons/${lesson.slug}`;
        return `Lesson "${lesson.title}" is available at: ${url}`;
      },
    });

    plugin.registerTool({
      name: 'create_reference_document',
      description:
        'Create a reference document for a teaching topic. Reference documents are ' +
        'compressed materials designed for quick review — cheat sheets, syntax guides, ' +
        'glossaries, algorithms. They should be beautiful and printable.',
      availableFor: ['chat', 'voice', 'autonomy'],
      systemPromptFragment: '',
      parameters: CreateReferenceDocumentParametersSchema,
      execute: async (
        args: Static<typeof CreateReferenceDocumentParametersSchema>
      ) => {
        const topic = await resolveTopic(args.topicSlug);
        if (!topic) {
          return args.topicSlug
            ? `No topic with slug "${args.topicSlug}" found.`
            : 'No active topic.';
        }

        const orm = await awaitForOrm;
        const em = orm.em.fork();
        const now = new Date();

        // Check for duplicate slug
        const existing = await em.findOne(TeachReferenceDocument, {
          topic: topic.id,
          slug: args.slug,
        });
        if (existing) {
          // Update existing reference document
          existing.title = args.title;
          existing.htmlContent = args.htmlContent;
          existing.category = args.category;
          existing.updatedAt = now;
          await em.flush();
          const url = `/api/teach/topics/${topic.slug}/reference/${args.slug}`;
          return `Updated reference document "${args.title}" for "${topic.name}".\nView it at: ${url}`;
        }

        const ref = em.create(TeachReferenceDocument, {
          topic: topic.id,
          title: args.title,
          slug: args.slug,
          htmlContent: args.htmlContent,
          category: args.category,
          createdAt: now,
          updatedAt: now,
        });
        em.persist(ref);
        await em.flush();

        const url = `/api/teach/topics/${topic.slug}/reference/${args.slug}`;
        return `Created reference document "${args.title}" for "${topic.name}".\nView it at: ${url}`;
      },
    });

    plugin.registerTool({
      name: 'list_reference_documents',
      description: 'List all reference documents for a teaching topic.',
      availableFor: ['chat', 'voice', 'autonomy'],
      systemPromptFragment: '',
      parameters: ListReferenceDocumentsParametersSchema,
      execute: async (
        args: Static<typeof ListReferenceDocumentsParametersSchema>
      ) => {
        const topic = await resolveTopic(args.topicSlug);
        if (!topic) {
          return args.topicSlug
            ? `No topic with slug "${args.topicSlug}" found.`
            : 'No active topic.';
        }

        const orm = await awaitForOrm;
        const em = orm.em.fork();
        const refs = await em.find(TeachReferenceDocument, {
          topic: topic.id,
        });

        if (refs.length === 0) {
          return `No reference documents for "${topic.name}" yet. Create one with teach.create_reference_document.`;
        }

        return refs
          .map(r => {
            const url = `/api/teach/topics/${topic.slug}/reference/${r.slug}`;
            return `- **${r.title}** [${r.category}] — [View](${url})`;
          })
          .join('\n');
      },
    });

    plugin.registerTool({
      name: 'get_reference_url',
      description: 'Get the URL to view a reference document in the browser.',
      availableFor: ['chat', 'voice', 'autonomy'],
      systemPromptFragment: '',
      parameters: GetReferenceUrlParametersSchema,
      execute: async (args: Static<typeof GetReferenceUrlParametersSchema>) => {
        const topic = await resolveTopic(args.topicSlug);
        if (!topic) {
          return args.topicSlug
            ? `No topic with slug "${args.topicSlug}" found.`
            : 'No active topic.';
        }

        const orm = await awaitForOrm;
        const em = orm.em.fork();
        const ref = await em.findOne(TeachReferenceDocument, {
          topic: topic.id,
          slug: args.refSlug,
        });

        if (!ref) {
          return `Reference document with slug "${args.refSlug}" not found in "${topic.name}".`;
        }

        const url = `/api/teach/topics/${topic.slug}/reference/${ref.slug}`;
        return `Reference document "${ref.title}" is available at: ${url}`;
      },
    });

    plugin.registerTool({
      name: 'add_note',
      description:
        'Add a note to a teaching topic. Notes are a scratchpad for teacher preferences, ' +
        'working observations, and anything that should inform future sessions.',
      availableFor: ['chat', 'voice', 'autonomy'],
      systemPromptFragment: '',
      parameters: AddNoteParametersSchema,
      execute: async (args: Static<typeof AddNoteParametersSchema>) => {
        const topic = await resolveTopic(args.topicSlug);
        if (!topic) {
          return args.topicSlug
            ? `No topic with slug "${args.topicSlug}" found.`
            : 'No active topic.';
        }

        const orm = await awaitForOrm;
        const em = orm.em.fork();
        const now = new Date();

        const note = em.create(TeachNote, {
          topic: topic.id,
          content: args.content,
          createdAt: now,
          updatedAt: now,
        });
        em.persist(note);
        await em.flush();

        return `Added note to "${topic.name}".`;
      },
    });

    plugin.registerTool({
      name: 'get_notes',
      description: 'Get all notes for a teaching topic.',
      availableFor: ['chat', 'voice', 'autonomy'],
      systemPromptFragment: '',
      parameters: GetNotesParametersSchema,
      execute: async (args: Static<typeof GetNotesParametersSchema>) => {
        const topic = await resolveTopic(args.topicSlug);
        if (!topic) {
          return args.topicSlug
            ? `No topic with slug "${args.topicSlug}" found.`
            : 'No active topic.';
        }

        const orm = await awaitForOrm;
        const em = orm.em.fork();
        const notes = await em.find(
          TeachNote,
          { topic: topic.id },
          {
            orderBy: { id: 'ASC' },
          }
        );

        if (notes.length === 0) {
          return `No notes for "${topic.name}" yet. Add notes with teach.add_note.`;
        }

        return notes.map(n => `- ${n.content}`).join('\n');
      },
    });

    plugin.registerTool({
      name: 'get_glossary_url',
      description:
        'Get the URL to view the glossary for a teaching topic as a beautiful HTML page.',
      availableFor: ['chat', 'voice', 'autonomy'],
      systemPromptFragment: '',
      parameters: GetGlossaryUrlParametersSchema,
      execute: async (args: Static<typeof GetGlossaryUrlParametersSchema>) => {
        const topic = await resolveTopic(args.topicSlug);
        if (!topic) {
          return args.topicSlug
            ? `No topic with slug "${args.topicSlug}" found.`
            : 'No active topic.';
        }

        const url = `/api/teach/topics/${topic.slug}/glossary`;
        return `Glossary for "${topic.name}" is available at: ${url}`;
      },
    });

    plugin.registerTool({
      name: 'delete_topic',
      description:
        'Delete a teaching topic and all associated data (mission, glossary, resources, ' +
        'learning records, lessons, reference documents, notes). This cannot be undone.',
      availableFor: ['chat', 'voice', 'autonomy'],
      systemPromptFragment: '',
      parameters: DeleteTopicParametersSchema,
      execute: async (args: Static<typeof DeleteTopicParametersSchema>) => {
        const orm = await awaitForOrm;
        const em = orm.em.fork();

        const topic = await em.findOne(TeachTopic, { slug: args.topicSlug });
        if (!topic) {
          return `No topic with slug "${args.topicSlug}" found.`;
        }

        const topicName = topic.name;

        // Delete all associated data
        await em.nativeDelete(TeachNote, { topic: topic.id });
        await em.nativeDelete(TeachReferenceDocument, { topic: topic.id });
        await em.nativeDelete(TeachLesson, { topic: topic.id });
        await em.nativeDelete(TeachLearningRecord, { topic: topic.id });
        await em.nativeDelete(TeachResource, { topic: topic.id });

        const glossary = await em.findOne(TeachGlossary, { topic: topic.id });
        if (glossary) {
          await em.nativeDelete(TeachGlossaryTerm, { glossary: glossary.id });
          await em.remove(glossary);
        }

        await em.nativeDelete(TeachMission, { topic: topic.id });
        await em.remove(topic);
        await em.flush();

        return `Deleted topic "${topicName}" and all associated data.`;
      },
    });

    // =========================================================================
    // Header system prompt
    // =========================================================================

    plugin.registerHeaderSystemPrompt({
      name: 'teach',
      weight: 60,
      getPrompt: context => {
        if (context.conversationType === 'startup') {
          return false;
        }

        if (!context.availableTools?.some(tool => tool.startsWith('teach.'))) {
          return false;
        }

        return [
          'The teach plugin is available for multi-session teaching. When the user asks to learn something,',
          'recall the "teach" skill and follow its workflow: create a topic, set a mission, build a glossary,',
          'curate resources, create learning records, and produce beautiful lessons.',
        ].join(' ');
      },
    });
  },
};

export default teachPlugin;
