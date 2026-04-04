type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown) {
  return value && typeof value === 'object' ? value as JsonRecord : undefined;
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function getString(value: unknown, fallback = 'unknown') {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function getNumber(value: unknown, fallback = 0) {
  return typeof value === 'number' ? value : fallback;
}

function getBoolean(value: unknown, fallback = false) {
  return typeof value === 'boolean' ? value : fallback;
}

function formatPreview(text: unknown, maxLength = 240) {
  const value = typeof text === 'string' ? text.trim() : '';
  if (!value) {
    return 'No preview available.';
  }

  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`;
}

function formatPostLine(item: unknown) {
  const record = asRecord(item) ?? {};
  return [
    `- ${getString(record.title)} by ${getString(asRecord(record.author)?.name)} in m/${getString(asRecord(record.submolt)?.name, 'unknown')}`,
    `  Upvotes: ${getNumber(record.upvotes)} | Comments: ${getNumber(record.comment_count)} | Created: ${getString(record.created_at)}`,
    `  ${formatPreview(record.content ?? record.content_preview)}`,
    `  Post ID: ${getString(record.id ?? record.post_id)}`,
  ].join('\n');
}

function formatCommentTree(comment: unknown, depth = 0): string[] {
  const record = asRecord(comment) ?? {};
  const prefix = '  '.repeat(depth);
  const author = getString(asRecord(record.author)?.name);
  const lines = [
    `${prefix}- ${author} | Upvotes: ${getNumber(record.upvotes)} | Comment ID: ${getString(record.id)}`,
    `${prefix}  ${formatPreview(record.content, 320)}`,
  ];

  const replies = asArray(record.replies);
  replies.forEach((reply) => lines.push(...formatCommentTree(reply, depth + 1)));
  return lines;
}

export function formatProfile(payload: JsonRecord) {
  const agent = asRecord(payload.agent) ?? payload;
  const owner = asRecord(agent.owner);

  return [
    `Name: ${getString(agent.name)}`,
    `Description: ${getString(agent.description, 'No description set.')}`,
    `Karma: ${getNumber(agent.karma)} | Posts: ${getNumber(agent.posts_count)} | Comments: ${getNumber(agent.comments_count)}`,
    `Followers: ${getNumber(agent.follower_count)} | Following: ${getNumber(agent.following_count)}`,
    `Claimed: ${getBoolean(agent.is_claimed)} | Active: ${getBoolean(agent.is_active)}`,
    `Created: ${getString(agent.created_at)} | Last active: ${getString(agent.last_active)}`,
    owner ? `Owner X: ${getString(owner.x_handle, 'unknown')} (${getString(owner.x_name, 'unknown')})` : 'Owner details: unavailable.',
  ].join('\n');
}

export function formatHome(payload: JsonRecord) {
  const account = asRecord(payload.your_account);
  const actions = asArray(payload.what_to_do_next).map((item) => `- ${getString(item)}`).join('\n');
  const activity = asArray(payload.activity_on_your_posts).map((item) => {
    const record = asRecord(item) ?? {};
    return `- ${getString(record.post_title)} (${getString(record.post_id)}) has ${getNumber(record.new_notification_count)} new notifications. ${formatPreview(record.preview, 120)}`;
  }).join('\n');

  return [
    account ? `Account: ${getString(account.name)} | Karma: ${getNumber(account.karma)} | Unread notifications: ${getNumber(account.unread_notification_count)}` : 'Account summary unavailable.',
    activity ? `Activity on your posts:\n${activity}` : 'No recent activity on your posts.',
    actions ? `Suggested next actions:\n${actions}` : 'No suggested actions were returned.',
  ].join('\n\n');
}

export function formatFeedItems(payload: JsonRecord) {
  const posts = asArray(payload.posts);
  const formattedPosts = posts.length > 0 ? posts.map(formatPostLine).join('\n\n') : 'No posts returned.';
  const cursorSummary = payload.has_more ? `More results are available. Next cursor: ${getString(payload.next_cursor)}` : 'No additional pages reported.';

  return `${formattedPosts}\n\n${cursorSummary}`;
}

export function formatPost(payload: JsonRecord) {
  const post = asRecord(payload.post) ?? payload;
  return [
    `Title: ${getString(post.title)}`,
    `Author: ${getString(asRecord(post.author)?.name)} | Submolt: m/${getString(asRecord(post.submolt)?.name, 'unknown')}`,
    `Upvotes: ${getNumber(post.upvotes)} | Downvotes: ${getNumber(post.downvotes)} | Comments: ${getNumber(post.comment_count)}`,
    `Created: ${getString(post.created_at)} | Post ID: ${getString(post.id)}`,
    '',
    formatPreview(post.content, 40000),
    typeof post.url === 'string' && post.url ? `\nURL: ${post.url}` : '',
  ].filter(Boolean).join('\n');
}

export function formatComments(payload: JsonRecord) {
  const comments = asArray(payload.comments);
  const formatted = comments.length > 0 ? comments.flatMap((comment) => formatCommentTree(comment)).join('\n') : 'No comments returned.';
  const cursorSummary = payload.has_more ? `\n\nMore comment pages are available. Next cursor: ${getString(payload.next_cursor)}` : '';
  return `${formatted}${cursorSummary}`;
}

export function formatSubmoltList(payload: JsonRecord) {
  const submolts = asArray(payload.submolts).length > 0 ? asArray(payload.submolts) : asArray(payload);
  if (submolts.length === 0) {
    return 'No submolts were returned.';
  }

  return submolts.map((item) => {
    const record = asRecord(item) ?? {};
    return `- m/${getString(record.name)} (${getString(record.display_name)}) | Members: ${getNumber(record.member_count)} | Allow crypto: ${getBoolean(record.allow_crypto)}\n  ${getString(record.description, 'No description provided.')}`;
  }).join('\n\n');
}

export function formatSubmolt(payload: JsonRecord) {
  const submolt = asRecord(payload.submolt) ?? payload;
  return [
    `m/${getString(submolt.name)} (${getString(submolt.display_name)})`,
    `Description: ${getString(submolt.description, 'No description provided.')}`,
    `Members: ${getNumber(submolt.member_count)} | Role: ${getString(submolt.your_role, 'member')}`,
    `Allow crypto: ${getBoolean(submolt.allow_crypto)} | Created: ${getString(submolt.created_at)}`,
  ].join('\n');
}

export function formatSearchResults(payload: JsonRecord) {
  const results = asArray(payload.results);
  if (results.length === 0) {
    return 'No matching Moltbook search results were returned.';
  }

  const formatted = results.map((item) => {
    const record = asRecord(item) ?? {};
    const author = getString(asRecord(record.author)?.name);
    const submolt = getString(asRecord(record.submolt)?.name, getString(asRecord(record.post)?.title, 'n/a'));
    return [
      `- ${getString(record.type)} result ${getString(record.id)} by ${author}`,
      `  Similarity: ${getString(record.similarity, 'n/a')} | Submolt/Post: ${submolt}`,
      `  ${record.title ? `Title: ${getString(record.title)}\n  ` : ''}${formatPreview(record.content, 200)}`,
    ].join('');
  }).join('\n\n');

  const cursorSummary = payload.has_more ? `\n\nMore search results are available. Next cursor: ${getString(payload.next_cursor)}` : '';
  return `${formatted}${cursorSummary}`;
}