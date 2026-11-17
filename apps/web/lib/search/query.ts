// Server only: the four read-only, parameterised search queries behind GET /app/api/search.
import { pageLinks } from "../../components/app-nav.js";
import {
  buildResponse,
  likePattern,
  matchPages,
  PER_GROUP,
  shapeClips,
  shapeIdeas,
  shapePosts,
  type ClipRow,
  type IdeaRow,
  type PostRow,
  type SearchResponse,
} from "./shape.js";

/** Anything with pg's query() (a Pool or a client inside a test transaction). */
export interface Queryable {
  query(sql: string, params?: unknown[]): Promise<{ rows: any[] }>;
}

/** Media label = file name without extension, so the path's last segment is what we match. */
const LABEL_SQL = `regexp_replace(coalesce(m.source_path, ''), '^.*[\\\\/]', '')`;

export const SEARCH_SQL = {
  // Fetch extra rows: several platforms of one clip collapse into one result.
  posts: `select bi.id, bi.media_id, m.source_path, bi.platform, bi.title, bi.caption, bi.status, bi.scheduled_for
            from batch_items bi
            join media m on m.id = bi.media_id
           where bi.status <> 'rejected'
             and (bi.title ilike $1 escape '\\' or bi.caption ilike $1 escape '\\' or ${LABEL_SQL} ilike $1 escape '\\')
           order by bi.scheduled_for desc nulls last, bi.created_at desc
           limit $2`,
  ideas: `(select i.id, 'idea' as kind, i.title as text, i.pillar, i.updated_at as at
             from ideas i
            where i.stage <> 'dropped' and (i.title ilike $1 escape '\\' or i.hook ilike $1 escape '\\')
            order by i.updated_at desc limit $2)
          union all
          (select h.id, 'hook' as kind, h.text, h.pillar, h.created_at as at
             from hooks h
            where h.text ilike $1 escape '\\'
            order by h.created_at desc limit $2)`,
  clips: `select m.id, m.source_path, m.pillar, m.duration_s
            from media m
           where ${LABEL_SQL} ilike $1 escape '\\'
           order by m.created_at desc
           limit $2`,
} as const;

/** Runs the grouped search for an already-cleaned query (see cleanQuery). Never interpolates input into SQL. */
export async function searchAll(db: Queryable, q: string, timeZone: string): Promise<SearchResponse> {
  const like = likePattern(q);
  const [posts, ideas, clips] = await Promise.all([
    db.query(SEARCH_SQL.posts, [like, PER_GROUP * 4]),
    db.query(SEARCH_SQL.ideas, [like, PER_GROUP]),
    db.query(SEARCH_SQL.clips, [like, PER_GROUP]),
  ]);
  return buildResponse(q, {
    pages: matchPages(pageLinks(), q),
    posts: shapePosts(posts.rows as PostRow[], timeZone),
    ideas: shapeIdeas(ideas.rows as IdeaRow[]),
    clips: shapeClips(clips.rows as ClipRow[]),
  });
}
