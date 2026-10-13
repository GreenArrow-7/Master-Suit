/**
 * YOUHAN ONE: the embeddable lead form.
 *
 *   <script src="https://<your app>/embed.js" data-workspace="<workspace>" data-form="<form key>"></script>
 *
 * Frames the workspace's public form (/f/<workspace>/<form key>) where the tag
 * sits on the brokerage's own site. Optional: data-height (pixels, 560 by
 * default) and data-title (the frame's accessible name). Static and CSP-safe:
 * nothing is evaluated and nothing is written as markup.
 */
(function () {
  var tag = document.currentScript;
  if (!tag) return;
  var workspace = tag.getAttribute('data-workspace');
  var form = tag.getAttribute('data-form');
  if (!workspace || !form) return;
  var origin = new URL(tag.src).origin;
  var frame = document.createElement('iframe');
  frame.src = origin + '/f/' + encodeURIComponent(workspace) + '/' + encodeURIComponent(form) + '?embed=1';
  frame.title = tag.getAttribute('data-title') || 'Contact form';
  frame.style.width = '100%';
  frame.style.border = '0';
  // ponytail: a fixed height; a postMessage from the form would size it to its fields.
  frame.style.height = (tag.getAttribute('data-height') || '560') + 'px';
  tag.parentNode.insertBefore(frame, tag.nextSibling);
})();
