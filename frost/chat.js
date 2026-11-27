/*
 * Frost — layout, groups and replies.
 *
 * A new message is handled in a MutationObserver: it fires
 * right after the row is inserted into #log, before the frame is painted. So the
 * "does it fit on one line" measurement and layout choice are invisible to the viewer —
 * the message appears in its final form right away, without jumps.
 */

/* everything inside a function: names like log must not clash
   with Streamlabs scripts or the preview page */
(function init() {

    const log = document.getElementById('log');
    if (!log) {
        /* #log isn't in the document yet — wait for load */
        document.addEventListener('DOMContentLoaded', init, { once: true });
        return;
    }

    /* Streamlabs fields arrive as classes on #log (outside Streamlabs — original: nick on top) */
    const layoutMode = () =>
        log.classList.contains('layout-adaptive') ? 'adaptive' :
        log.classList.contains('layout-inline') ? 'inline' : 'stack';
    /* in the original layout (nick on top) messages aren't grouped */
    const groupingOn = () => layoutMode() !== 'stack';

    /* A nick longer than this fraction of the width always goes on top (a guess, can be tuned) */
    const MAX_INLINE_NICK = 0.5;

    /* ---------- replies ---------- */

    const replyTags = new Map();   // message id → reply tags

    function decodeIrcTag(value = '') {
        const escapes = { s: ' ', ':': ';', '\\': '\\', r: '\r', n: '\n' };
        return value.replace(/\\(.)/g, (_, char) => escapes[char] ?? char);
    }

    function removeReplyMention(message, tags) {
        const parentNames = [
            tags['reply-parent-display-name'],
            tags['reply-parent-user-login']
        ].filter(Boolean).map(name => name.toLowerCase());

        const walker = document.createTreeWalker(message, NodeFilter.SHOW_TEXT);
        let node;

        while ((node = walker.nextNode())) {
            if (!node.textContent.trim()) {
                continue;
            }
            const match = node.textContent.match(/^\s*@([^\s]+)(?:\s+|$)/);
            if (match && parentNames.includes(match[1].toLowerCase())) {
                node.textContent = node.textContent.slice(match[0].length);
            }
            break;
        }
    }

    /* Inserts the quote if tags for the row have already arrived. Returns true if inserted. */
    function applyReply(row) {
        const tags = replyTags.get(row.dataset.id);
        const message = row.querySelector('.message');

        if (!tags || !message || message.querySelector('.reply')) {
            return false;
        }

        replyTags.delete(row.dataset.id);
        removeReplyMention(message, tags);

        const reply = document.createElement('span');
        reply.className = 'reply';

        const author = document.createElement('span');
        author.className = 'reply-author';
        author.textContent = tags['reply-parent-display-name'] || '';

        const body = document.createElement('span');
        body.className = 'reply-body';
        body.textContent = decodeIrcTag(tags['reply-parent-msg-body']);

        reply.append(author, body);
        message.prepend(reply);

        row.classList.add('is-reply');
        /* reply with the nick on top; in the inline layout — the quote, with "nick: text" below it */
        row.dataset.lay = layoutMode() === 'inline' ? 'inline' : 'stack';
        return true;
    }

    /* ---------- layout ---------- */

    function measureLayout(row) {
        if (row.classList.contains('is-reply')) {
            return layoutMode() === 'inline' ? 'inline' : 'stack';
        }
        const mode = layoutMode();
        if (mode !== 'adaptive') {
            return mode;
        }

        row.classList.add('is-inline', 'a-measure');

        const width = row.clientWidth;
        const meta = row.querySelector('.meta');
        const fits =
            row.scrollWidth <= width + 1 &&
            (!meta || meta.getBoundingClientRect().width <= width * MAX_INLINE_NICK);

        row.classList.remove('a-measure');
        return fits ? 'inline' : 'stack';
    }

        /* Inline, the quote comes first in the card, above "nick: text";
       otherwise it goes inside .message as usual */
    function placeReply(row) {
        const reply = row.querySelector('.reply');
        const message = row.querySelector('.message');
        if (!reply || !message) {
            return;
        }
        if (row.classList.contains('is-inline')) {
            if (reply.parentNode !== row) {
                row.prepend(reply);
            }
        } else if (reply.parentNode !== message) {
            message.prepend(reply);
        }
    }

    /* ---------- groups ---------- */

    const rows = () => [...log.children].filter(el =>
        el.tagName === 'DIV' &&
        !el.classList.contains('deleted') &&
        !el.classList.contains('gone')
    );

    function regroup() {
        const list = rows();
        const group = groupingOn();

        list.forEach((row, i) => {
            const prev = list[i - 1];
            const cont = group && !!prev &&
                prev.dataset.from === row.dataset.from &&
                !row.classList.contains('is-reply') &&
                !prev.classList.contains('is-reply');

            const next = list[i + 1];
            const hasNext = group && !!next &&
                next.dataset.from === row.dataset.from &&
                !row.classList.contains('is-reply') &&
                !next.classList.contains('is-reply');

            row.classList.toggle('g-cont', cont);
            row.classList.toggle('g-next', hasNext);

            /* the first message of a group (or a single one) gets its layout once */
            if (!cont && !row.dataset.lay) {
                row.dataset.lay = measureLayout(row);
            }
            /* only a single message goes inline: as soon as the viewer
           sends a second one in a row, the nick moves to the top and the messages
           go into one card, each on a new line */
        row.classList.toggle('is-inline', !cont && !hasNext && row.dataset.lay === 'inline');
        placeReply(row);
        });
    }

    /* ---------- events ---------- */

    /* internal classes the script changes itself: ignore them */
    const OWN = /\b(g-cont|g-next|is-inline|a-measure|is-reply|gone)\b/g;
    const strip = s => (s || '').replace(OWN, '').trim().replace(/\s+/g, ' ');

    new MutationObserver(records => {
        let changed = false;

        for (const r of records) {
            if (r.type === 'childList') {
                r.addedNodes.forEach(node => {
                    if (node.nodeType === 1) {
                        applyReply(node);
                    }
                });
                changed = true;
            } else if (r.target.parentNode === log &&
                       strip(r.oldValue) !== strip(r.target.className)) {
                changed = true;   // e.g. Streamlabs marked the message as deleted
            }
        }

        if (changed) {
            regroup();
        }
    }).observe(log, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class'],
        attributeOldValue: true
    });

    /* a message hidden by the timer no longer holds the group:
       the next one becomes first and shows the nick */
    log.addEventListener('animationend', (e) => {
        if (e.animationName === 'frostOut' && e.target.parentNode === log) {
            e.target.classList.add('gone');
            regroup();
        }
    });

    document.addEventListener('onEventReceived', (event) => {
        const detail = event.detail;
        const tags =
            detail?.tags ??
            detail?.event?.tags ??
            detail?.event?.data?.tags;

        if (!tags?.['reply-parent-msg-id'] || !tags.id) {
            return;
        }

        replyTags.set(tags.id, tags);
        if (replyTags.size > 200) {
            replyTags.delete(replyTags.keys().next().value);
        }

        /* the row is already in the chat (event arrived after insertion) — finish now;
           otherwise the MutationObserver inserts the quote */
        const row = log.querySelector(`:scope > div[data-id="${CSS.escape(tags.id)}"]`);
        if (row && applyReply(row)) {
            regroup();
        }
    });

})();
