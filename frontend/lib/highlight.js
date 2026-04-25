// Wrap occurrences of `query` inside `text` in <mark> tags, returning an
// array of strings/elements suitable for direct JSX rendering. Case-
// insensitive and safe against regex metachars in the query.

import React from 'react';

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const highlight = (text, query) => {
  if (!query || !text) return text;
  const safe = escapeRegex(query.trim());
  if (!safe) return text;

  const re = new RegExp(`(${safe})`, 'ig');
  const parts = String(text).split(re);
  return parts.map((part, i) =>
    i % 2 === 1
      ? React.createElement('mark', {
          key: i,
          className: 'bg-amber-300/30 text-amber-100 rounded px-0.5',
        }, part)
      : part
  );
};
